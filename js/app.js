import { renderAll, renderInventory, renderRequests, initIcons } from './ui.js';
import { loginUser, fetchProducts, createProduct, updateProduct, addStock, deleteProduct, fetchRequests, createRequest, updateRequestStatus, returnRequest, deleteRequest, fetchLogs, fetchRetentionStats, purgeOldData, BASE_URL, fetchLocations, addLocation as apiAddLocation, deleteLocation as apiDeleteLocation } from './api.js';
import { state } from './state.js';

// ──────────────────────────────────────────
// INIT
// ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initIcons();
    checkServerConnection();
    
    // Check for existing session
    const savedUser = sessionStorage.getItem('ss_user');
    if (savedUser) {
        login(savedUser);
    }
});

async function loadAllData() {
    try {
        const [products, requests, logs, locations] = await Promise.all([
            fetchProducts(),
            fetchRequests(),
            fetchLogs(),
            fetchLocations(),
        ]);
        // Mutate in-place so ui.js (which imported the same object) sees the updates
        state.products.splice(0, state.products.length, ...products);
        state.requests.splice(0, state.requests.length, ...requests);
        state.logs.splice(0, state.logs.length, ...logs);
        state.locations.splice(0, state.locations.length, ...locations);
        renderAll();
    } catch (err) {
        console.error('Failed to load data from backend:', err);
    }
}

async function checkServerConnection() {
    const statusEl = document.getElementById('connection-status');
    const textEl = statusEl?.querySelector('.status-text');
    const updateStatus = (online) => {
        if (online) {
            statusEl.className = 'status-indicator status-online';
            if (textEl) textEl.textContent = 'Server Online';
        } else {
            statusEl.className = 'status-indicator status-offline';
            if (textEl) textEl.textContent = 'Server Offline';
        }
    };
    try {
        const res = await fetch(`${BASE_URL}/ping`);
        const contentType = res.headers.get('content-type');
        if (res.ok && contentType && contentType.includes('application/json')) {
            const data = await res.json();
            updateStatus(data.status === 'ok');
        } else {
            throw new Error();
        }
    } catch (err) {
        updateStatus(false);
    }
    // Periodically re-check every 10 seconds
    if (!window._connectionInterval) {
        window._connectionInterval = setInterval(checkServerConnection, 10000);
    }
}

// ──────────────────────────────────────────
// EVENT LISTENERS
// ──────────────────────────────────────────
function setupEventListeners() {
    // Auth — Admin uses inline password panel (prompt() blocked in modules)
    document.getElementById('btn-admin-login')?.addEventListener('click', () => {
        document.getElementById('admin-pass-panel').style.display = 'block';
        document.getElementById('admin-login-error').style.display = 'none';
        document.getElementById('admin-password-input').value = '';
        document.getElementById('admin-password-input').focus();
    });

    document.getElementById('btn-admin-confirm')?.addEventListener('click', async () => {
        const pass = document.getElementById('admin-password-input').value;
        try {
            const result = await loginUser('admin', pass);
            if (result.success) {
                document.getElementById('admin-pass-panel').style.display = 'none';
                login('admin');
            } else {
                document.getElementById('admin-login-error').style.display = 'block';
                document.getElementById('admin-login-error').textContent = '❌ ' + (result.message || 'Incorrect password. Try again.');
            }
        } catch (err) {
            console.error('Login error:', err);
            alert('⚠️ Connection Error: Could not reach the backend server. Please make sure the server is running.');
        }
    });

    document.getElementById('admin-password-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-admin-confirm').click();
    });

    document.getElementById('btn-admin-cancel')?.addEventListener('click', () => {
        document.getElementById('admin-pass-panel').style.display = 'none';
    });

    document.getElementById('btn-transporter-login')?.addEventListener('click', async () => {
        try {
            const result = await loginUser('transporter');
            if (result.success) login('transporter');
        } catch (err) {
            console.error('Login error:', err);
            alert('⚠️ Connection Error: Could not reach the backend server.');
        }
    });

    document.getElementById('btn-logout')?.addEventListener('click', logout);
    document.getElementById('btn-export-csv')?.addEventListener('click', exportLogsToCSV);

    // Retention Panel
    document.getElementById('btn-show-retention')?.addEventListener('click', async () => {
        const panel = document.getElementById('retention-panel');
        panel.classList.remove('hidden');
        // Load live stats from backend
        try {
            const stats = await fetchRetentionStats();
            document.getElementById('ret-total-logs').textContent = stats.logs.total;
            document.getElementById('ret-old-logs').textContent   = stats.logs.old;
            document.getElementById('ret-old-reqs').textContent   = stats.requests.old;
        } catch (e) {
            console.error('Could not load retention stats', e);
        }
        initIcons();
    });

    document.getElementById('btn-hide-retention')?.addEventListener('click', () => {
        document.getElementById('retention-panel').classList.add('hidden');
        document.getElementById('purge-result').classList.add('hidden');
    });

    document.getElementById('btn-manual-purge')?.addEventListener('click', async () => {
        if (!confirm('⚠️ Are you sure? This will permanently delete all logs and challans older than 18 months. This cannot be undone.')) return;
        const btn = document.getElementById('btn-manual-purge');
        btn.textContent = 'Purging...';
        btn.disabled = true;
        try {
            const result = await purgeOldData();
            const resultEl = document.getElementById('purge-result');
            resultEl.classList.remove('hidden');
            resultEl.style.background = 'rgba(16,185,129,0.1)';
            resultEl.style.color = 'var(--secondary)';
            resultEl.textContent = `✅ ${result.message}`;
            await loadAllData();
            // Refresh stats
            const stats = await fetchRetentionStats();
            document.getElementById('ret-total-logs').textContent = stats.logs.total;
            document.getElementById('ret-old-logs').textContent   = stats.logs.old;
            document.getElementById('ret-old-reqs').textContent   = stats.requests.old;
        } catch (e) {
            const resultEl = document.getElementById('purge-result');
            resultEl.classList.remove('hidden');
            resultEl.style.background = 'rgba(239,68,68,0.1)';
            resultEl.style.color = 'var(--danger)';
            resultEl.textContent = '❌ Purge failed. Please try again.';
        }
        btn.innerHTML = '<i data-lucide="trash-2"></i> Purge Old Records';
        btn.disabled = false;
        initIcons();
    });

    loadLocations();

    // Location Manager listeners
    document.getElementById('btn-add-location')?.addEventListener('click', () => addLocation());
    document.getElementById('new-location-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLocation(); });

    // Mobile Menu
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    menuToggle?.addEventListener('click', () => sidebar.classList.toggle('open'));

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const view = e.currentTarget.getAttribute('data-view');
            if (view) {
                showView(view, e.currentTarget);
                if (window.innerWidth <= 1024) sidebar.classList.remove('open');
            }
        });
    });

    // Search
    document.getElementById('supreme-search')?.addEventListener('input', () => renderInventory('supreme'));
    document.getElementById('cri-search')?.addEventListener('input', () => renderInventory('cri'));

    // Expose globals for inline onclick in HTML
    window.openProductModal = openProductModal;
    window.openRequestModal = openRequestModal;
    window.addRequestItemRow = addRequestItemRow;
    window.openSerialManager = openSerialManager;
    window.openModelManager = openModelManager;
    window.openLocationManager = openLocationManager;
    window.addLocation = addLocation;
    window.deleteLocation = deleteLocation;
    window.removeManagerSerial = removeManagerSerial;
    window.closeModal = (id) => document.getElementById(id).style.display = 'none';
    window.refreshAllProductDropdowns = refreshAllProductDropdowns;
    window.toggleDestInput = toggleDestInput;

    // Serial Manager Tab switching
    document.querySelectorAll('.manager-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.manager-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.manager-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('pane-' + tab.dataset.pane).classList.add('active');
        };
    });

    // Manual Add
    document.getElementById('btn-manager-add')?.addEventListener('click', () => addSerialToManager());
    document.getElementById('manager-sn-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSerialToManager(); });

    // Range Gen
    document.getElementById('btn-manager-gen')?.addEventListener('click', () => generateRange());

    // Clear All
    document.getElementById('btn-manager-clear')?.addEventListener('click', () => {
        serialManagerState = [];
        renderManagerSerials();
    });

    // Apply
    document.getElementById('btn-manager-apply')?.addEventListener('click', () => applySerialsToProduct());

    // Autocomplete
    const snInput = document.getElementById('manager-sn-input');
    snInput?.addEventListener('input', async (e) => {
        const val = e.target.value.trim();
        const suggestionsDiv = document.getElementById('manager-suggestions');
        if (val.length < 2) { suggestionsDiv.style.display = 'none'; return; }
        
        try {
            const res = await fetch(`${BASE_URL}/serials/search?q=${val}`);
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const suggestions = await res.json();
                if (suggestions.length > 0) {
                    suggestionsDiv.innerHTML = suggestions.slice(0, 5).map(s => `
                        <div class="suggestion-item" onclick="selectManagerSuggestion('${s.serialNumber}')">${s.serialNumber} <small style="color:var(--text-muted)">(${s.productName})</small></div>
                    `).join('');
                    suggestionsDiv.style.display = 'block';
                } else {
                    suggestionsDiv.style.display = 'none';
                }
            } else {
                suggestionsDiv.style.display = 'none';
            }
        } catch (err) { console.error(err); }
    });
    window.selectManagerSuggestion = (val) => {
        document.getElementById('manager-sn-input').value = val;
        document.getElementById('manager-suggestions').style.display = 'none';
        addSerialToManager();
    };

    // Form Submissions
    document.getElementById('product-form')?.addEventListener('submit', handleProductSubmit);
    document.getElementById('request-form')?.addEventListener('submit', handleRequestSubmit);
    document.getElementById('stock-form')?.addEventListener('submit', handleStockSubmit);

    // Global Action Delegate
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.glass-btn');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const category = btn.getAttribute('data-category');
        if (action === 'edit') openProductModal(category, id);
        if (action === 'delete') handleDeleteProduct(id);
        if (action === 'add-stock') openStockModal(id);
        if (action === 'view-units') openUnitModal(id);
        if (action === 'delete-request') handleDeleteRequest(id);
        if (action === 'approve') handleRequest(id, 'approved');
        if (action === 'reject') handleRequest(id, 'rejected');
        if (action === 'return') handleReturnRequest(id);
        if (action === 'print') printChallan(id);
    });

    // Serial number search
    document.getElementById('btn-serial-search')?.addEventListener('click', handleSerialSearch);
    document.getElementById('serial-search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSerialSearch(); });

    // document.getElementById('req-category')?.addEventListener('change', updateRequestProductList); // Handled dynamically per row now
}

// ──────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────
function login(role) {
    state.currentUser = role;
    sessionStorage.setItem('ss_user', role);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('user-role-name').textContent = role.charAt(0).toUpperCase() + role.slice(1);
    document.body.classList.toggle('role-admin', role === 'admin');
    document.body.classList.toggle('role-transporter', role === 'transporter');
    if (role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.transporter-only').forEach(el => el.classList.add('hidden'));
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.transporter-only').forEach(el => el.classList.remove('hidden'));
    }
    loadAllData();
}

function logout() {
    state.currentUser = null;
    sessionStorage.removeItem('ss_user');
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
}

// ──────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────
function showView(viewId, navItem) {
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId + '-view').classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    navItem.classList.add('active');
    renderAll();
}

// ──────────────────────────────────────────
// PRODUCT MODAL
// ──────────────────────────────────────────
function openProductModal(category, id = null) {
    if (state.currentUser !== 'admin') { alert('Access Denied: Admin privileges required.'); return; }
    
    // Secondary password check for Edit
    if (id) {
        const pass = prompt('Enter Admin Password to EDIT this product:');
        if (pass !== '12345678') {
            if (pass !== null) alert('❌ Incorrect password. Access denied.');
            return;
        }
    }
    const modal = document.getElementById('product-modal');
    document.getElementById('prod-category').value = category;
    document.getElementById('prod-id').value = id || '';
    document.getElementById('product-form-error').style.display = 'none';
    // Clear all field errors
    ['err-name','err-model','err-serials','err-stock','err-low-limit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
    ['prod-name','prod-model','prod-size','prod-material','prod-serials','prod-low-limit'].forEach(id => {
        document.getElementById(id)?.classList.remove('invalid');
    });

    if (id) {
        const p = state.products.find(x => x._id === id || x.id === id);
        document.getElementById('prod-name').value = p?.name || '';
        document.getElementById('prod-model').value = p?.model || p?.specs?.model || '';
        document.getElementById('prod-size').value = p?.size || p?.specs?.size || '';
        document.getElementById('prod-material').value = p?.material || p?.specs?.material || '';
        document.getElementById('prod-stock').value = p?.stock || '';
        document.getElementById('prod-low-limit').value = p?.lowStockLimit || 10;
        document.getElementById('modal-title').textContent = 'Edit Product';
        // Hide serial fields on edit (serials managed via Add Stock)
        document.getElementById('prod-serial-group').style.display = 'none';
        document.getElementById('prod-stock-group').style.display = 'block';
        document.getElementById('prod-stock').readOnly = false;
        document.getElementById('prod-stock').style.background = '';
        document.getElementById('prod-stock').style.color = '';
        document.getElementById('prod-stock-hint').style.display = 'none';
    } else {
        document.getElementById('product-form').reset();
        document.getElementById('prod-low-limit').value = 10;
        document.getElementById('prod-stock').value = '';
        document.getElementById('prod-stock').readOnly = false;
        document.getElementById('prod-stock').style.background = '';
        document.getElementById('prod-stock').style.color = '';
        document.getElementById('prod-stock-hint').style.display = 'none';
        document.getElementById('modal-title').textContent = 'Add New Product';
        const isSupreme = category === 'supreme';
        document.getElementById('prod-serial-group').style.display = isSupreme ? 'none' : 'block';
        document.getElementById('prod-stock-group').style.display = 'block';
        // Reset serial count badge
        const badge = document.getElementById('serial-count-badge');
        if (badge) { badge.textContent = '0 entered'; badge.classList.remove('has-count'); }
        // Wire live serial counter
        const textarea = document.getElementById('prod-serials');
        textarea.oninput = () => {
            const val = textarea.value;
            const sns = val.split(/[\s,]+/).filter(s => s);
            const badge = document.getElementById('serial-count-badge');
            document.getElementById('prod-stock').value = sns.length || '';
            if (badge) {
                badge.textContent = `${sns.length} entered`;
                badge.classList.toggle('has-count', sns.length > 0);
            }
            
            // Update integrated list
            const searchVal = document.getElementById('modal-serials-search')?.value.toLowerCase() || '';
            renderModalSerialChips(sns, searchVal);
            document.getElementById('modal-serials-list-wrapper').style.display = sns.length > 0 ? 'block' : 'none';

            // Clear errors on change
            document.getElementById('err-serials').textContent = '';
            textarea.classList.remove('invalid');
        };

        const modalSearchInput = document.getElementById('modal-serials-search');
        if (modalSearchInput) {
            modalSearchInput.value = ''; // Reset search
            modalSearchInput.oninput = (e) => {
                const sns = textarea.value.split(/[\s,]+/).filter(s => s);
                renderModalSerialChips(sns, e.target.value.toLowerCase());
            };
        }
    }

    modal.style.display = 'flex';
    if (window.gsap) gsap.from('#product-modal .modal-content', { scale: 0.88, opacity: 0, duration: 0.25, ease: 'power2.out' });
    initIcons();
}


// ──────────────────────────────────────────
// PRODUCT FORM SUBMIT
// ──────────────────────────────────────────
async function handleProductSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const category = document.getElementById('prod-category').value;
    const name = document.getElementById('prod-name').value.trim();
    const model = document.getElementById('prod-model')?.value.trim() || '';
    const size = document.getElementById('prod-size')?.value.trim() || '';
    const material = document.getElementById('prod-material')?.value.trim() || '';
    const location = document.getElementById('prod-location').value;
    const stock = parseInt(document.getElementById('prod-stock').value) || 0;
    const lowStockLimit = parseInt(document.getElementById('prod-low-limit').value) || 10;

    // Build specs for backward compat
    const specs = { model, size, material };

    // Clear all errors
    const clearErrors = () => {
        ['err-name','err-model','err-serials','err-stock','err-low-limit'].forEach(eid => {
            const el = document.getElementById(eid);
            if (el) el.textContent = '';
        });
        ['prod-name','prod-model','prod-serials'].forEach(eid => {
            document.getElementById(eid)?.classList.remove('invalid');
        });
        document.getElementById('product-form-error').style.display = 'none';
    };
    clearErrors();

    const showError = (fieldId, errId, msg) => {
        const field = document.getElementById(fieldId);
        const errEl = document.getElementById(errId);
        if (field) field.classList.add('invalid');
        if (errEl) errEl.textContent = msg;
    };

    let hasError = false;

    if (!name) { showError('prod-name', 'err-name', 'Product name is required.'); hasError = true; }
    if (lowStockLimit < 0) {
        document.getElementById('err-low-limit').textContent = 'Alert limit cannot be negative.';
        hasError = true;
    }

    try {
        if (id) {
            if (hasError) return;
            await updateProduct(id, { name, model, size, material, stock, lowStockLimit, specs });
        } else {
            const serialRaw = document.getElementById('prod-serials').value;
            const serialNumbers = serialRaw.split(/[\s,]+/).map(s => s.trim()).filter(s => s);

            // Client-side unique check
            const unique = new Set(serialNumbers);
            if (unique.size !== serialNumbers.length) {
                showError('prod-serials', 'err-serials', 'You have duplicate serial numbers in your list. Please remove them.');
                hasError = true;
            }
            if (hasError) return;

            await createProduct({ category, name, model, size, material, specs, stock, lowStockLimit, serialNumbers, location });
        }
        document.getElementById('product-modal').style.display = 'none';
        await loadAllData();
    } catch (err) {
        const errBox = document.getElementById('product-form-error');
        errBox.textContent = '⚠️ ' + (err.message || 'Could not save product. Please try again.');
        errBox.style.display = 'block';
        errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ──────────────────────────────────────────
// ADD STOCK MODAL
// ──────────────────────────────────────────
function openStockModal(id) {
    if (state.currentUser !== 'admin') { alert('Access Denied: Admin privileges required.'); return; }
    const modal = document.getElementById('stock-modal');
    const product = state.products.find(p => (p._id || p.id) == id);
    if (!product) return;

    document.getElementById('stock-form').reset();
    document.getElementById('stock-prod-id').value = id;
    document.getElementById('stock-serials').value = '';
    
    // Set Product Info
    document.getElementById('stock-modal-prod-name').textContent = product.name;
    document.getElementById('stock-modal-prod-meta').textContent = 
        Object.entries(product.specs || {}).map(([k, v]) => `${k}: ${v}`).join(' | ');

    // Hide serial numbers for pipes (supreme)
    const isSupreme = product.category === 'supreme';
    const serialGroup = document.getElementById('stock-serials-group');
    if (serialGroup) serialGroup.style.display = isSupreme ? 'none' : 'block';

    modal.style.display = 'flex';
    if (window.gsap) gsap.from('#stock-modal .modal-content', { scale: 0.8, opacity: 0, duration: 0.3 });
    initIcons();
}

async function handleStockSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('stock-prod-id').value;
    const qty = parseInt(document.getElementById('stock-add-qty').value);
    const location = document.getElementById('stock-location').value;
    const serialRaw = document.getElementById('stock-serials').value;
    const serialNumbers = serialRaw.split(/[\n,]+/).map(s => s.trim()).filter(s => s);

    if (serialNumbers.length > 0 && serialNumbers.length !== qty) {
        alert(`Error: You entered ${serialNumbers.length} serial numbers but specified quantity to add as ${qty}.`);
        return;
    }

    try {
        const updated = await addStock(id, qty, serialNumbers, location);
        alert(`✅ Successfully added ${qty} units to ${updated.name} at ${location}`);
        document.getElementById('stock-modal').style.display = 'none';
        await loadAllData();
    } catch (err) {
        alert('Error adding stock: ' + err.message);
    }
}

// ──────────────────────────────────────────
// UNIT MODAL
// ──────────────────────────────────────────
function openUnitModal(id) {
    const modal = document.getElementById('unit-modal');
    const product = state.products.find(p => (p._id || p.id) == id);
    if (!product) return;

    document.getElementById('unit-modal-prod-name').textContent = product.name;
    const modelStr = product.model || product.specs?.model || '';
    const sizeStr = product.size || product.specs?.size || '';
    const metaParts = [modelStr, sizeStr].filter(Boolean);
    document.getElementById('unit-modal-prod-meta').textContent = metaParts.join(' | ') || 'No specs';
    
    // Render Units
    const tbody = document.getElementById('unit-list-table');
    const units = (product.units || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const statusIcon = { available: '🟢', sold: '🔴', 'in-transit': '🟡', dispatched: '⬛' };

    const isSupreme = product.category === 'supreme';
    const titleEl = document.getElementById('unit-list-title');
    const sectionEl = document.getElementById('unit-list-section');
    if (titleEl) titleEl.style.display = isSupreme ? 'none' : 'block';
    if (sectionEl) sectionEl.style.display = isSupreme ? 'none' : 'block';

    if (units.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No units registered yet. Add stock to register serial numbers.</td></tr>`;
    } else {
        tbody.innerHTML = units.map(u => `
            <tr>
                <td style="font-family:monospace; font-weight:600; color:var(--primary);">${u.serialNumber || '—'}</td>
                <td>
                    <span class="unit-status-pill unit-${u.status}">
                        ${statusIcon[u.status] || ''} ${u.status.toUpperCase()}
                    </span>
                </td>
                <td><span class="location-badge">${u.location || 'Main Godown'}</span></td>
                <td style="color:var(--text-muted); font-size:12px;">${new Date(u.timestamp).toLocaleString()}</td>
            </tr>
        `).join('');
    }

    // Render History (Moved to Unit Modal)
    const history = (product.stockHistory || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const summaryContainer = document.getElementById('stock-summary-container');
    if (summaryContainer) {
        const totalInflow = history.reduce((acc, curr) => acc + (curr.added || 0), 0);
        const lastEntry = history.length > 0 ? new Date(history[0].timestamp).toLocaleDateString() : 'N/A';
        summaryContainer.innerHTML = `
            <div class="stock-summary-card">
                <div class="summary-stat">
                    <span class="label">Total Inflow</span>
                    <span class="value">${totalInflow}</span>
                </div>
                <div class="summary-stat">
                    <span class="label">Current Stock</span>
                    <span class="value">${product.stock}</span>
                </div>
                <div class="summary-stat">
                    <span class="label">Last Update</span>
                    <span class="value">${lastEntry}</span>
                </div>
            </div>
        `;
    }
    
    const historyTbody = document.getElementById('stock-history-table');
    
    if (history.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">No historical entries found.</td></tr>`;
    } else {
        historyTbody.innerHTML = history.map((h, index) => `
            <tr class="history-row ${index === 0 ? 'latest-entry' : ''}">
                <td class="stock-history-date">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <i data-lucide="${h.type === 'inflow' ? 'arrow-up-circle' : (h.type === 'adjustment' ? 'settings' : 'play-circle')}" size="14" style="color:${h.type === 'inflow' ? 'var(--secondary)' : 'var(--text-muted)'}"></i>
                        <div>
                            ${new Date(h.timestamp).toLocaleDateString()} <br>
                            <span style="font-size:10px; opacity:0.7;">${new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                </td>
                <td style="color:var(--text-muted);">${h.before}</td>
                <td class="stock-history-qty">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span>+${h.added}</span>
                        <span class="history-type-badge badge-${h.type || 'inflow'}">${h.type || 'inflow'}</span>
                    </div>
                </td>
                <td style="font-weight:600; color:var(--primary);">${h.after}</td>
            </tr>
        `).join('');
    }

    modal.style.display = 'flex';
    if (window.gsap) gsap.from('#unit-modal .modal-content', { scale: 0.88, opacity: 0, duration: 0.25 });
    initIcons();
}

// ──────────────────────────────────────────
// DELETE PRODUCT
// ──────────────────────────────────────────
async function handleDeleteProduct(id) {
    if (state.currentUser !== 'admin') { alert('Access Denied: Admin privileges required.'); return; }
    
    const pass = prompt('Enter Admin Password to DELETE this product:');
    if (pass !== '12345678') {
        if (pass !== null) alert('❌ Incorrect password. Access denied.');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
        await deleteProduct(id);
        await loadAllData();
    } catch (err) {
        alert('Error deleting product: ' + err.message);
    }
}

async function handleDeleteRequest(id) {
    if (!confirm('Are you sure you want to delete this transport challan? This will not revert stock changes if already approved.')) return;
    try {
        await deleteRequest(id);
        await loadAllData();
    } catch (err) {
        alert('Error deleting challan: ' + err.message);
    }
}

// ──────────────────────────────────────────
// SERIAL NUMBER SEARCH
// ──────────────────────────────────────────
async function handleSerialSearch() {
    const q = (document.getElementById('serial-search-input')?.value || '').trim();
    const container = document.getElementById('serial-search-results');
    if (!q) { container.style.display = 'none'; return; }

    container.style.display = 'block';
    container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Searching...</div>';

    try {
        const res = await fetch(`${BASE_URL}/serials/search?q=${encodeURIComponent(q)}`);
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned an unexpected response (HTML).');
        }
        const results = await res.json();

        if (!results.length) {
            container.innerHTML = `<div style="color:var(--text-muted); font-size:13px; padding:8px 0;">No unit found with serial number matching "<strong>${q}</strong>".</div>`;
            return;
        }

        const statusIcon = { available: '🟢', sold: '🔴', 'in-transit': '🟡', dispatched: '⬛' };
        container.innerHTML = results.map(r => `
            <div class="serial-result-card">
                <div style="flex:1;">
                    <div class="serial-mono">${r.serialNumber}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${r.productName}${r.model ? ` · ${r.model}` : ''} · <strong>${r.category?.toUpperCase()}</strong></div>
                </div>
                <div style="text-align:right;">
                    <span class="unit-status-pill unit-${r.status}">${statusIcon[r.status] || ''} ${r.status?.toUpperCase()}</span>
                    <div class="location-badge" style="margin-top:4px; display:inline-block;">${r.location}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div style="color:var(--danger); font-size:13px;">Search failed: ${err.message}</div>`;
    }
}

// ──────────────────────────────────────────
// REQUEST MODAL (CHALLAN)
// ──────────────────────────────────────────
function toggleDestInput() {
    const type = document.getElementById('req-dest-type').value;
    const container = document.getElementById('dest-container');
    const label = document.getElementById('lbl-dest-name');
    
        const locs = state.locations.map(l => l.name);
        
        if (type === 'godown') {
            label.textContent = 'Godown Name';
            container.innerHTML = `
                <select id="req-dest" class="form-control" required>
                    ${locs.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
                </select>
            `;
    } else {
        label.textContent = 'Store Name';
        container.innerHTML = `
            <input type="text" id="req-dest" class="form-control" placeholder="e.g. City Retail Branch" required>
        `;
    }
}

function openRequestModal() {
    const modal = document.getElementById('request-modal');
    document.getElementById('request-form').reset();
    
    // Reset destination type to store
    document.getElementById('req-dest-type').value = 'store';
    toggleDestInput();
    
    // Populate source godowns
    const sourceSelect = document.getElementById('req-source');
    if (sourceSelect) {
        const locs = state.locations.map(l => l.name);
        sourceSelect.innerHTML = locs.map(loc => `<option value="${loc}">${loc}</option>`).join('');
    }
    
    // Clear and init items container
    const container = document.getElementById('request-items-container');
    container.innerHTML = '';
    addRequestItemRow(); // Add first row
    
    modal.style.display = 'flex';
    if (window.gsap) gsap.from('#request-modal .modal-content', { scale: 0.8, opacity: 0, duration: 0.3 });
    initIcons();
}

function addRequestItemRow() {
    const container = document.getElementById('request-items-container');
    const rowId = 'row-' + Date.now();
    const row = document.createElement('div');
    row.className = 'glass-row mb-4';
    row.id = rowId;
    row.style.padding = '12px; border:1px solid var(--border-light); border-radius:12px; background:#fff;';
    
    row.innerHTML = `
        <div style="display:grid; grid-template-columns: 140px 1fr 80px 40px; gap:12px; align-items:end;">
            <div class="form-group" style="margin:0;">
                <label style="font-size:11px;">Category</label>
                <select class="form-control req-item-category" style="padding:6px; font-size:13px;" required>
                    <option value="">Select</option>
                    <option value="all">All Products</option>
                    <option value="supreme">Supreme</option>
                    <option value="cri">CRI</option>
                </select>
            </div>
            <div class="form-group" style="margin:0;">
                <label style="font-size:11px;">Product</label>
                <input type="text" class="form-control req-item-product-search" list="${rowId}-list" placeholder="Search or type product..." style="padding:6px; font-size:13px;" required>
                <datalist id="${rowId}-list"></datalist>
            </div>
            <div class="form-group" style="margin:0;">
                <label style="font-size:11px;">Qty</label>
                <input type="number" class="form-control req-item-qty" min="1" value="1" style="padding:6px; font-size:13px;" required>
            </div>
            <button type="button" class="glass-btn" style="padding:8px; color:var(--danger); border-color:var(--danger); background:transparent;" onclick="document.getElementById('${rowId}').remove()">
                <i data-lucide="trash-2" size="14"></i>
            </button>
        </div>
    `;
    
    container.appendChild(row);
    
    // Wire category change for this row
    const catSelect = row.querySelector('.req-item-category');
    const prodInput = row.querySelector('.req-item-product-search');
    const prodList = row.querySelector('datalist');
    
    catSelect.onchange = () => {
        prodInput.value = '';
        prodList.innerHTML = '';
        if (catSelect.value) {
            const filtered = catSelect.value === 'all' 
                ? state.products 
                : state.products.filter(p => p.category === catSelect.value);
            
            filtered.forEach(p => {
                const model = p.model || p.specs?.model || '';
                const sourceLoc = document.getElementById('req-source').value;
                const availableUnits = (p.units || []).filter(u => u.location === sourceLoc && u.status === 'available');
                
                // 1. Units with serial numbers get individual lines
                const withSN = availableUnits.filter(u => u.serialNumber && u.serialNumber.trim());
                // 2. Units without serial numbers (blank) get a single bulk line
                const withoutSN = availableUnits.filter(u => !u.serialNumber || !u.serialNumber.trim());

                withSN.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = `${p.name} ${model ? `[${model}]` : ''} (Avail: 1) SN: ${u.serialNumber}`;
                    opt.setAttribute('data-id', p._id || p.id);
                    opt.setAttribute('data-sn', u.serialNumber);
                    prodList.appendChild(opt);
                });

                if (withoutSN.length > 0 || (withSN.length === 0 && p.category === 'supreme')) {
                    const opt = document.createElement('option');
                    opt.value = `${p.name} ${model ? `[${model}]` : ''} (Avail: ${withoutSN.length})`;
                    opt.setAttribute('data-id', p._id || p.id);
                    prodList.appendChild(opt);
                }
            });
        }
    };
    
    initIcons();
}

function refreshAllProductDropdowns() {
    const rows = document.querySelectorAll('#request-items-container .glass-row');
    rows.forEach(row => {
        const catSelect = row.querySelector('.req-item-category');
        if (catSelect && catSelect.value) {
            catSelect.dispatchEvent(new Event('change'));
        }
    });
}

async function handleRequestSubmit(e) {
    e.preventDefault();
    const rows = document.querySelectorAll('#request-items-container .glass-row');
    const items = [];
    
    rows.forEach(row => {
        const input = row.querySelector('.req-item-product-search');
        const list = row.querySelector('datalist');
        const option = Array.from(list.options).find(opt => opt.value === input.value);
        const productId = option ? option.getAttribute('data-id') : null;
        const serialNumber = option ? option.getAttribute('data-sn') : null;
        
        const qty = parseInt(row.querySelector('.req-item-qty').value);
        if (productId && qty > 0) {
            items.push({ productId, qty, serialNumber });
        }
    });

    if (items.length === 0) {
        alert('Please add at least one product to the challan.');
        return;
    }

    const source = document.getElementById('req-source').value;
    const dest = document.getElementById('req-dest').value;
    
    try {
        await createRequest({ items, source, dest });
        document.getElementById('request-modal').style.display = 'none';
        await loadAllData();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ──────────────────────────────────────────
// HANDLE APPROVE / REJECT
// ──────────────────────────────────────────
async function handleRequest(id, status) {
    if (state.currentUser === 'admin' && status === 'approved') { 
        alert('Action Blocked: Only the Transporter can accept/approve this challan.'); 
        return; 
    }

    const confirmMsg = status === 'approved' 
        ? 'Are you sure you want to ACCEPT this transport challan? This will officially move the stock to in-transit.' 
        : 'Are you sure you want to REJECT this transport challan?';

    if (!confirm(confirmMsg)) return;
    try {
        await updateRequestStatus(id, status);
        await loadAllData();
        if (status === 'approved') {
            alert('✅ Challan accepted and stock moved. It is now ready for Admin to print.');
        } else if (status === 'rejected') {
            alert('❌ Challan rejected.');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function handleReturnRequest(id) {
    if (!confirm('Are you sure you want to RETURN this challan? This will move the units back from "in-transit" to "available" at the source location.')) return;
    try {
        await returnRequest(id);
        await loadAllData();
        alert('✅ Challan returned successfully. Stock has been restored.');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ──────────────────────────────────────────
// EXPORT CSV
// ──────────────────────────────────────────
function exportLogsToCSV() {
    if (!state.logs.length) { alert('No logs available to export.'); return; }
    const headers = ['Timestamp', 'Type', 'Item', 'Before', 'Change', 'After', 'User'];
    const rows = state.logs.map(l => [
        new Date(l.timestamp).toLocaleString(), l.type, l.item, l.before, l.change, l.after, l.user
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `sri_sapthagiri_logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ──────────────────────────────────────────
// PRINT CHALLAN
// ──────────────────────────────────────────
function printChallan(id) {
    const req = state.requests.find(r => (r._id || r.id) == id);
    if (!req) { alert('Challan data not found.'); return; }
    
    const printWindow = window.open('', '_blank');
    const items = req.items || [{ category: req.category, productName: req.productName, qty: req.qty }];
    
    printWindow.document.write(`
        <html><head><title>Transport Challan #${req._id || req.id}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');
            @page { size: 80mm auto; margin: 0; }
            body { 
                font-family: 'Inter', sans-serif; 
                width: 72mm; 
                margin: 0 auto; 
                padding: 5mm 0; 
                color: #000; 
                font-size: 11px; 
                line-height: 1.3;
            }
            .shop-header { text-align: center; margin-bottom: 10px; }
            .shop-name { font-size: 14px; font-weight: 800; margin-bottom: 2px; text-transform: uppercase; }
            .shop-info { font-size: 10px; font-weight: 400; }
            .divider { border-top: 1px dashed #000; margin: 8px 0; }
            .challan-meta { margin-bottom: 10px; font-size: 10px; }
            .challan-meta div { display: flex; justify-content: space-between; }
            table { width: 100%; border-collapse: collapse; margin-top: 5px; }
            th { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: left; padding: 4px 0; font-size: 10px; text-transform: uppercase; }
            td { padding: 6px 0; font-size: 10px; vertical-align: top; border-bottom: 0.5px solid #eee; }
            .qty-col { text-align: right; }
            .footer { margin-top: 20px; text-align: center; font-size: 10px; font-style: italic; }
            .sign-section { margin-top: 30px; display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .sign-box { border-top: 1px solid #000; padding-top: 4px; width: 30mm; text-align: center; }
        </style></head><body>
        <div class="shop-header">
            <div class="shop-name">SRISAPTHAGIRIELECTRICALS&HARDWARES</div>
            <div class="shop-info">
                123, Nethaji Road, TIRUPATI-517501.<br>
                Ph: 2229091, 7680848620, (M)9848048620
            </div>
        </div>
        <div class="divider"></div>
        <div class="challan-meta">
            <div><span><strong>Date:</strong> ${new Date(req.date).toLocaleDateString()}</span><span><strong>ID:</strong> ${req._id?.slice(-6) || req.id?.slice(-6)}</span></div>
            <div><span><strong>From:</strong> ${req.source}</span></div>
            <div><span><strong>To:</strong> ${req.dest}</span></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width: 60%;">Description</th>
                    <th style="width: 20%;">UOM</th>
                    <th class="qty-col" style="width: 20%;">Qty</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => {
                    const uom = item.category === 'supreme' ? 'LENGTH' : 'NOS';
                    return `
                    <tr>
                        <td>${item.productName}${item.serialNumber ? `<br><span style="font-size:8px; color:#555;">SN: ${item.serialNumber}</span>` : ''}</td>
                        <td>${uom}</td>
                        <td class="qty-col">${item.qty}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
        <div class="divider"></div>
        <div class="sign-section">
            <div class="sign-box">Transporter</div>
            <div class="sign-box">Authorized</div>
        </div>
        <div class="footer">Thank You! Visit Again</div>
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body></html>
    `);
    printWindow.document.close();
}
// ──────────────────────────────────────────
// SERIAL NUMBER MANAGER
// ──────────────────────────────────────────
let serialManagerState = [];

function openSerialManager() {
    const mainSerials = document.getElementById('prod-serials').value;
    serialManagerState = mainSerials.split(/[\s,]+/).filter(s => s);
    
    renderManagerSerials();
    
    document.getElementById('serial-manager-modal').style.display = 'flex';
    initIcons();
}

function renderManagerSerials() {
    const container = document.getElementById('manager-chips');
    const countEl = document.getElementById('manager-count');
    
    if (!container) return;
    
    container.innerHTML = serialManagerState.map((sn, index) => `
        <div class="sn-tag">
            ${sn}
            <i data-lucide="x-circle" onclick="removeManagerSerial(${index})" style="width:14px; height:14px;"></i>
        </div>
    `).join('');

    document.getElementById('prod-stock').value = serialManagerState.length;
    countEl.textContent = serialManagerState.length;
    initIcons();
}

function removeManagerSerial(index) {
    serialManagerState.splice(index, 1);
    renderManagerSerials();
}

function addSerialToManager() {
    const input = document.getElementById('manager-sn-input');
    const val = input.value.trim();
    if (!val) return;
    
    if (val.includes(' ') || val.includes(',')) {
        alert('Each serial number must be a single word (no spaces or commas).');
        return;
    }
    
    if (serialManagerState.includes(val)) {
        alert('Serial number already added to this list.');
        return;
    }
    
    serialManagerState.push(val);
    input.value = '';
    renderManagerSerials();
}

function generateRange() {
    const prefix = document.getElementById('range-prefix').value.trim();
    const startNum = parseInt(document.getElementById('range-start').value);
    const count = parseInt(document.getElementById('range-count').value);
    
    if (isNaN(startNum) || isNaN(count) || count < 1) {
        alert('Please enter a valid start number and count.');
        return;
    }
    
    if (count > 500) {
        alert('Maximum 500 serials can be generated at once.');
        return;
    }
    
    for (let i = 0; i < count; i++) {
        const sn = prefix + (startNum + i);
        if (!serialManagerState.includes(sn)) {
            serialManagerState.push(sn);
        }
    }
    
    renderManagerSerials();
}

function applySerialsToProduct() {
    const input = document.getElementById('prod-serials');
    input.value = serialManagerState.join(', ');
    
    // Trigger input event to update main form badges/counters
    input.dispatchEvent(new Event('input'));
    
    document.getElementById('serial-manager-modal').style.display = 'none';
}

function renderModalSerialChips(serials, filter = '') {
    const container = document.getElementById('modal-serials-chips');
    if (!container) return;
    
    const filtered = filter ? serials.filter(s => s.toLowerCase().includes(filter)) : serials;
    
    container.innerHTML = filtered.map(sn => `
        <div class="sn-tag" style="font-size:11px; padding:4px 10px;">
            ${sn}
            <i data-lucide="x-circle" onclick="removeModalSerialChip('${sn}')" style="width:12px; height:12px;"></i>
        </div>
    `).join('') || (filter ? '<div style="font-size:11px; color:var(--text-muted); padding:8px;">No matches found</div>' : '');
    
    initIcons();
}

function removeModalSerialChip(snToRemove) {
    const textarea = document.getElementById('prod-serials');
    const sns = textarea.value.split(/[\s,]+/).filter(s => s);
    const updated = sns.filter(s => s !== snToRemove);
    textarea.value = updated.join(', ');
    textarea.dispatchEvent(new Event('input'));
}

async function syncLocationDropdowns() {
    const locs = state.locations.map(l => l.name);
    const dropdowns = ['prod-location', 'req-source', 'stock-location'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const current = el.value;
            el.innerHTML = locs.map(l => `<option value="${l}">${l}</option>`).join('');
            if (locs.includes(current)) el.value = current;
        }
    });
}

function renderLocationList() {
    const list = document.getElementById('location-list');
    if (!list) return;
    list.innerHTML = state.locations.map(loc => `
        <div class="flex justify-between items-center glass-row" style="padding:10px; border:1px solid var(--border-light); border-radius:12px; background:rgba(255,255,255,0.4); margin-bottom:4px;">
            <span style="font-weight:600;">${loc.name}</span>
            <button class="glass-btn" style="padding:6px; color:var(--danger); background:rgba(239,68,68,0.05);" onclick="deleteLocation('${loc.name}')">
                <i data-lucide="trash-2" size="16"></i>
            </button>
        </div>
    `).join('') || '<div style="text-align:center; color:var(--text-muted); font-size:13px; padding:20px;">No locations added yet.</div>';
    initIcons();
}

function openModelManager() {
    const category = document.getElementById('prod-category')?.value;
    if (!category) {
        alert('Please select a category (Supreme or CRI) first.');
        return;
    }
    const datalist = document.getElementById('model-suggestions');
    if (!datalist) return;
    const models = [...new Set(state.products
        .filter(p => p.category === category)
        .map(p => p.model || p.specs?.model)
        .filter(Boolean)
    )];
    datalist.innerHTML = models.map(m => `<option value="${m}">`).join('');
    document.getElementById('prod-model').focus();
}

async function loadLocations() {
    try {
        const locations = await fetchLocations();
        state.locations.splice(0, state.locations.length, ...locations);
        syncLocationDropdowns();
    } catch (e) { console.error("Error loading locations", e); }
}

async function addLocation() {
    const input = document.getElementById('new-location-input');
    const name = input.value.trim();
    if (!name) return;
    if (state.locations.some(l => l.name === name)) {
        alert('Location already exists.');
        return;
    }
    try {
        await apiAddLocation(name);
        input.value = '';
        await loadAllData();
        renderLocationList();
    } catch (err) {
        alert('Error adding location: ' + err.message);
    }
}

async function deleteLocation(name) {
    if (state.locations.length <= 1) {
        alert('You must have at least one location in the system.');
        return;
    }
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
        await apiDeleteLocation(name);
        await loadAllData();
        renderLocationList();
    } catch (err) {
        alert('Error deleting location: ' + err.message);
    }
}

function openLocationManager() {
    renderLocationList();
    document.getElementById('location-manager-modal').style.display = 'flex';
    if (window.gsap) gsap.from('#location-manager-modal .modal-content', { scale: 0.88, opacity: 0, duration: 0.25 });
}
