import os
import time
import urllib.request
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, request
from bs4 import BeautifulSoup
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for convenience

# Simple in-memory cache
cache = {
    "data": None,
    "last_fetched": 0,
    "ttl": 300  # 5 minutes in seconds
}

def parse_feed_xml(xml_data):
    """
    Parses the BigQuery Release Notes Atom XML feed.
    Extracts individual updates (Features, Issues, etc.) from the content of entries.
    """
    root = ET.fromstring(xml_data)
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    
    updates = []
    entries = root.findall('atom:entry', ns)
    
    for entry in entries:
        # Title of the entry is the date (e.g., "June 15, 2026")
        date_str = entry.find('atom:title', ns).text if entry.find('atom:title', ns) is not None else "Unknown Date"
        entry_id = entry.find('atom:id', ns).text if entry.find('atom:id', ns) is not None else ""
        updated_raw = entry.find('atom:updated', ns).text if entry.find('atom:updated', ns) is not None else ""
        
        # Link extraction
        links = entry.findall('atom:link', ns)
        url_str = ""
        for link in links:
            if link.attrib.get('rel') == 'alternate':
                url_str = link.attrib.get('href', '')
                break
        if not url_str and links:
            url_str = links[0].attrib.get('href', '')
            
        content_elem = entry.find('atom:content', ns)
        if content_elem is None or not content_elem.text:
            continue
            
        html_content = content_elem.text
        soup = BeautifulSoup(html_content, 'html.parser')
        
        headers = soup.find_all('h3')
        
        # If there are no h3 tags inside the content, wrap the whole content as one General update
        if not headers:
            text_content = soup.get_text().strip()
            # Clean up white space
            text_content = " ".join(text_content.split())
            updates.append({
                'id': entry_id,
                'date': date_str,
                'updated_raw': updated_raw,
                'type': 'General',
                'html': html_content.strip(),
                'text': text_content,
                'url': url_str
            })
            continue
            
        for idx, h3 in enumerate(headers):
            update_type = h3.get_text().strip()
            sibling_htmls = []
            sibling_texts = []
            
            # Walk sibling elements until the next h3
            curr = h3.next_sibling
            while curr and curr.name != 'h3':
                if curr.name:
                    sibling_htmls.append(str(curr))
                    sibling_texts.append(curr.get_text().strip())
                curr = curr.next_sibling
                
            combined_html = "".join(sibling_htmls).strip()
            # Clean up text content
            combined_text = " ".join(t for t in sibling_texts if t)
            combined_text = " ".join(combined_text.split())
            
            # Generate a unique ID for this sub-update
            sub_id = f"{entry_id}#item-{idx}" if entry_id else f"{date_str}#item-{idx}"
            
            updates.append({
                'id': sub_id,
                'date': date_str,
                'updated_raw': updated_raw,
                'type': update_type,
                'html': combined_html,
                'text': combined_text,
                'url': url_str
            })
            
    return updates

def fetch_release_notes():
    """
    Fetches the Atom feed from Google Cloud documentation.
    """
    url = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AntigravityFeedReader/1.0'}
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.read()

@app.route('/')
def home():
    """
    Serve the main index page.
    """
    return render_template('index.html')

@app.route('/api/updates')
def get_updates():
    """
    API endpoint that returns the list of parsed BigQuery updates.
    Supports '?refresh=true' query parameter to bypass the cache.
    """
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    now = time.time()
    
    # Check cache validity
    if not force_refresh and cache["data"] is not None and (now - cache["last_fetched"]) < cache["ttl"]:
        return jsonify({
            "status": "success",
            "source": "cache",
            "last_fetched": cache["last_fetched"],
            "updates": cache["data"]
        })
        
    try:
        xml_data = fetch_release_notes()
        parsed_updates = parse_feed_xml(xml_data)
        
        # Update cache
        cache["data"] = parsed_updates
        cache["last_fetched"] = now
        
        return jsonify({
            "status": "success",
            "source": "network",
            "last_fetched": now,
            "updates": parsed_updates
        })
    except Exception as e:
        # If network fetch fails but we have cached data, fallback to cache
        if cache["data"] is not None:
            return jsonify({
                "status": "warning",
                "message": f"Failed to fetch fresh data: {str(e)}. Displaying cached data.",
                "source": "cache_fallback",
                "last_fetched": cache["last_fetched"],
                "updates": cache["data"]
            })
        return jsonify({
            "status": "error",
            "message": f"Failed to retrieve release notes: {str(e)}"
        }), 500

if __name__ == '__main__':
    # Run the server on port 5000
    app.run(debug=True, host='127.0.0.1', port=5000)
