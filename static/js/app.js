// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
let allUpdates = [];
let filteredUpdates = [];
let selectedUpdate = null;

const TWEET_CHAR_LIMIT = 280;

// SVG Progress Ring setup
const progressCircle = document.getElementById('progress-circle');
let ringCircumference = 0;
if (progressCircle) {
    const radius = progressCircle.r.baseVal.value;
    ringCircumference = radius * 2 * Math.PI;
    progressCircle.style.strokeDasharray = `${ringCircumference} ${ringCircumference}`;
    progressCircle.style.strokeDashoffset = ringCircumference;
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Attach event listeners
    document.getElementById('refresh-btn').addEventListener('click', () => fetchUpdates(true));
    document.getElementById('retry-btn').addEventListener('click', () => fetchUpdates(true));
    document.getElementById('close-composer').addEventListener('click', closeComposer);
    document.getElementById('composer-overlay').addEventListener('click', closeComposer);
    document.getElementById('reset-tweet-btn').addEventListener('click', resetTweetText);
    document.getElementById('tweet-btn').addEventListener('click', shareOnTwitter);
    
    // Search elements
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    searchInput.addEventListener('input', handleSearchInput);
    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchClearBtn.style.display = 'none';
        applyFilters();
    });

    // Filter elements
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('.filter-btn');
            targetBtn.classList.add('active');
            applyFilters();
        });
    });

    // Sort element
    document.getElementById('sort-select').addEventListener('change', applyFilters);

    // Composer textarea listener
    document.getElementById('composer-text').addEventListener('input', updateCharCounter);

    // Initial load
    fetchUpdates(false);
});

// ==========================================================================
// API CALLS
// ==========================================================================
async function fetchUpdates(forceRefresh = false) {
    const refreshBtn = document.getElementById('refresh-btn');
    const spinner = document.getElementById('spinner');
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const emptyState = document.getElementById('empty-state');
    const updatesContainer = document.getElementById('updates-container');

    // UI Feedback for loading
    if (forceRefresh) {
        spinner.classList.add('spinning');
        refreshBtn.disabled = true;
    } else {
        loadingState.style.display = 'flex';
        updatesContainer.style.display = 'none';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
    }

    try {
        const url = `/api/updates${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'error') {
            throw new Error(data.message);
        }

        allUpdates = data.updates || [];
        
        // Show success toast on manual refresh
        if (forceRefresh) {
            showToast('Updates refreshed successfully!', 'success');
        }
        
        // Update header stats
        updateHeaderStats();
        
        // Render
        applyFilters();
        
    } catch (error) {
        console.error('Error fetching updates:', error);
        
        // If we already have data loaded, don't show full-screen error state, just toast
        if (allUpdates.length > 0) {
            showToast(`Refresh failed: ${error.message}`, 'error');
        } else {
            document.getElementById('error-message').textContent = error.message;
            errorState.style.display = 'flex';
            loadingState.style.display = 'none';
            updatesContainer.style.display = 'none';
        }
    } finally {
        // Stop loading UI
        spinner.classList.remove('spinning');
        refreshBtn.disabled = false;
        loadingState.style.display = 'none';
    }
}

// ==========================================================================
// CORE DOM RENDERING
// ==========================================================================
function renderCards(updates) {
    const container = document.getElementById('updates-container');
    const emptyState = document.getElementById('empty-state');
    
    container.innerHTML = '';
    
    if (updates.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    
    container.style.display = 'grid';
    emptyState.style.display = 'none';
    
    updates.forEach(item => {
        const card = document.createElement('article');
        card.className = 'update-card';
        if (selectedUpdate && selectedUpdate.id === item.id) {
            card.classList.add('selected');
        }
        
        // Match badge class
        let badgeClass = 'badge-other';
        const typeLower = item.type.toLowerCase();
        if (typeLower.includes('feature')) badgeClass = 'badge-feature';
        else if (typeLower.includes('issue') || typeLower.includes('bug')) badgeClass = 'badge-issue';
        
        card.innerHTML = `
            <div class="card-header">
                <span class="badge ${badgeClass}">${escapeHtml(item.type)}</span>
                <span class="card-date">${escapeHtml(item.date)}</span>
            </div>
            <div class="card-body">
                ${item.html}
            </div>
            <div class="card-footer">
                <span class="card-origin">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    <span>Official Release Notes</span>
                </span>
                <div class="action-indicator">
                    <i class="fa-brands fa-x-twitter"></i>
                </div>
            </div>
        `;
        
        // Card click handler
        card.addEventListener('click', (e) => {
            // Prevent drawer opening if user clicks an actual link in the card description (although we disabled them in CSS pointer-events)
            if (e.target.tagName === 'A') return;
            
            selectCard(item, card);
        });
        
        container.appendChild(card);
    });
}

function updateHeaderStats() {
    const total = allUpdates.length;
    const features = allUpdates.filter(u => u.type.toLowerCase().includes('feature')).length;
    const issues = allUpdates.filter(u => u.type.toLowerCase().includes('issue') || u.type.toLowerCase().includes('bug')).length;
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-features').textContent = features;
    document.getElementById('stat-issues').textContent = issues;
}

// ==========================================================================
// FILTERING & SORTING LOGIC
// ==========================================================================
function applyFilters() {
    const searchQuery = document.getElementById('search-input').value.toLowerCase().strip();
    
    // Get active filter type
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    const filterType = activeFilterBtn ? activeFilterBtn.getAttribute('data-type') : 'All';
    
    // Get sort order
    const sortOrder = document.getElementById('sort-select').value;
    
    filteredUpdates = allUpdates.filter(item => {
        // 1. Search Query Match
        const textMatch = item.text.toLowerCase().includes(searchQuery);
        const dateMatch = item.date.toLowerCase().includes(searchQuery);
        const typeMatch = item.type.toLowerCase().includes(searchQuery);
        const searchMatches = textMatch || dateMatch || typeMatch;
        
        // 2. Type Filter Match
        let typeMatches = false;
        if (filterType === 'All') {
            typeMatches = true;
        } else if (filterType === 'Feature') {
            typeMatches = item.type.toLowerCase().includes('feature');
        } else if (filterType === 'Issue') {
            typeMatches = item.type.toLowerCase().includes('issue') || item.type.toLowerCase().includes('bug');
        } else { // Other
            const isFeature = item.type.toLowerCase().includes('feature');
            const isIssue = item.type.toLowerCase().includes('issue') || item.type.toLowerCase().includes('bug');
            typeMatches = !isFeature && !isIssue;
        }
        
        return searchMatches && typeMatches;
    });
    
    // 3. Sorting
    filteredUpdates.sort((a, b) => {
        // Safely parse timestamps
        const timeA = a.updated_raw ? new Date(a.updated_raw).getTime() : 0;
        const timeB = b.updated_raw ? new Date(b.updated_raw).getTime() : 0;
        
        if (sortOrder === 'newest') {
            return timeB - timeA;
        } else {
            return timeA - timeB;
        }
    });
    
    renderCards(filteredUpdates);
}

function handleSearchInput(e) {
    const searchClearBtn = document.getElementById('search-clear-btn');
    if (e.target.value.length > 0) {
        searchClearBtn.style.display = 'block';
    } else {
        searchClearBtn.style.display = 'none';
    }
    applyFilters();
}

// Helper: polyfill strip if not present
String.prototype.strip = function() {
    return this.replace(/^\s+|\s+$/g, '');
};

// ==========================================================================
// TWEET COMPOSER DRAWER LOGIC
// ==========================================================================
function selectCard(update, cardElement) {
    // Deselect previously selected card
    const selectedCards = document.querySelectorAll('.update-card.selected');
    selectedCards.forEach(c => c.classList.remove('selected'));
    
    // Select current card
    cardElement.classList.add('selected');
    selectedUpdate = update;
    
    // Open Drawer
    openComposer();
}

function openComposer() {
    if (!selectedUpdate) return;
    
    const panel = document.getElementById('composer-panel');
    const overlay = document.getElementById('composer-overlay');
    
    // Fill content preview
    document.getElementById('preview-date').textContent = selectedUpdate.date;
    document.getElementById('preview-html').innerHTML = selectedUpdate.html;
    
    const badge = document.getElementById('preview-badge');
    badge.textContent = selectedUpdate.type;
    badge.className = 'badge'; // Reset
    
    const typeLower = selectedUpdate.type.toLowerCase();
    if (typeLower.includes('feature')) badge.classList.add('badge-feature');
    else if (typeLower.includes('issue') || typeLower.includes('bug')) badge.classList.add('badge-issue');
    else badge.classList.add('badge-other');
    
    // Generate default tweet text
    resetTweetText();
    
    // Show drawer
    panel.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // Lock background scroll
}

function closeComposer() {
    const panel = document.getElementById('composer-panel');
    const overlay = document.getElementById('composer-overlay');
    
    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // Unlock scroll
    
    // Remove selection highlight in grid
    const selectedCards = document.querySelectorAll('.update-card.selected');
    selectedCards.forEach(c => c.classList.remove('selected'));
    selectedUpdate = null;
}

function generateDefaultTweet(update) {
    const dateStr = update.date;
    const typeStr = update.type;
    const descText = update.text;
    const urlStr = update.url;
    
    // Structure:
    // BigQuery Update (Date) - Type:
    // {Description}
    // Read more: {URL}
    // #BigQuery #GoogleCloud
    
    const prefix = `BigQuery Update (${dateStr}) - ${typeStr}:\n\n`;
    const suffix = `\n\nRead more: ${urlStr}\n#BigQuery #GoogleCloud`;
    
    const allowedDescLength = TWEET_CHAR_LIMIT - prefix.length - suffix.length;
    
    let finalDesc = descText;
    if (descText.length > allowedDescLength) {
        // Truncate to fit perfectly
        finalDesc = descText.substring(0, allowedDescLength - 3) + '...';
    }
    
    return `${prefix}${finalDesc}${suffix}`;
}

function resetTweetText() {
    if (!selectedUpdate) return;
    
    const defaultTweet = generateDefaultTweet(selectedUpdate);
    const textarea = document.getElementById('composer-text');
    textarea.value = defaultTweet;
    
    updateCharCounter();
}

function updateCharCounter() {
    const textarea = document.getElementById('composer-text');
    const counter = document.getElementById('char-counter');
    const tweetBtn = document.getElementById('tweet-btn');
    
    const len = textarea.value.length;
    const remaining = TWEET_CHAR_LIMIT - len;
    
    counter.textContent = remaining;
    
    // Visual indicators based on length
    counter.className = 'char-counter';
    if (remaining <= 40 && remaining >= 0) {
        counter.classList.add('warning');
    } else if (remaining < 0) {
        counter.classList.add('danger');
    }
    
    // Progress Ring updates
    if (progressCircle) {
        const percent = Math.min(100, (len / TWEET_CHAR_LIMIT) * 100);
        const offset = ringCircumference - (percent / 100 * ringCircumference);
        progressCircle.style.strokeDashoffset = Math.max(0, offset);
        
        // Progress ring color changes
        if (remaining < 0) {
            progressCircle.style.stroke = 'var(--color-issue)';
        } else if (remaining <= 40) {
            progressCircle.style.stroke = 'var(--color-other)';
        } else {
            progressCircle.style.stroke = 'var(--color-twitter)';
        }
    }
    
    // Enable/disable Post button
    if (len === 0 || remaining < 0) {
        tweetBtn.disabled = true;
    } else {
        tweetBtn.disabled = false;
    }
}

function shareOnTwitter() {
    const text = document.getElementById('composer-text').value;
    if (!text || text.length > TWEET_CHAR_LIMIT) return;
    
    const encodedText = encodeURIComponent(text);
    const xUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
    
    showToast('Opening X/Twitter...', 'success');
    
    // Open in a new tab
    window.open(xUrl, '_blank', 'noopener,noreferrer');
}

// ==========================================================================
// NOTIFICATION TOAST SYSTEM
// ==========================================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    else if (type === 'error') iconClass = 'fa-triangle-exclamation';
    else if (type === 'warning') iconClass = 'fa-circle-exclamation';
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass} toast-icon"></i>
        <span>${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    
    // Trigger slide-in transition
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove toast after 4s
    setTimeout(() => {
        toast.classList.remove('show');
        // Remove from DOM after transition finishes
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
