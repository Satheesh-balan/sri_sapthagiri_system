import { state } from './state.js';

export function initIcons() {
    if (window.lucide) lucide.createIcons();
}

export function renderAll() {
    renderDashboard();
    renderInventory('supreme');
    renderInventory('cri');
    renderInventoryList('supreme', 'supreme-monitor-list');
    renderInventoryList('cri', 'cri-monitor-list');
    renderRequests();
    renderLogs();
    initIcons();
}

function getId(obj) {
    return obj._id || obj.id;
}

function renderDashboard() {
    const criStock = state.products.filter(p => p.category === 'cri').reduce((acc, p) => acc + p.stock, 0);
    const supremeStock = state.products.filter(p => p.category === 'supreme').reduce((acc, p) => acc + p.stock, 0);
    const lowStockItems = state.products.filter(p => p.stock <= (p.lowStockLimit || 10));
    const dispatched = state.requests.filter(r => r.status === 'approved' && isToday(r.date)).length;

    document.getElementById('stat-cri-stock').textContent = criStock;
    document.getElementById('stat-supreme-stock').textContent = supremeStock;
    document.getElementById('stat-low-stock-count').textContent = lowStockItems.length;
    document.getElementById('stat-dispatched').textContent = dispatched;

    const alertBox = document.getElementById('low-stock-alert-box');
    const alertList = document.getElementById('low-stock-list');
    if (alertBox && alertList) {
        if (lowStockItems.length > 0) {
            alertBox.classList.remove('hidden');
            alertList.innerHTML = lowStockItems.map(p => `
                <div style="margin-bottom: 4px;">
                    • <strong>${p.name}</strong> is at ${p.stock} units (Limit: ${p.lowStockLimit || 10})
                </div>
            `).join('');
        } else {
            alertBox.classList.add('hidden');
        }
    }

    const dateEl = document.getElementById('current-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const recent = state.requests.slice(0, 5);
    const tbody = document.getElementById('recent-requests-table');
    if (tbody) {
        tbody.innerHTML = recent.map(r => `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td style="font-size:13px;">${renderItemsSummary(r.items)}</td>
                <td>${r.source}</td>
                <td>${r.dest}</td>
                <td><span class="status-pill status-${r.status}">${r.status}</span></td>
                <td>
                    ${state.currentUser === 'admin' && r.status === 'approved' ? `
                        <button class="glass-btn" style="padding:4px;color:var(--primary);" data-action="print" data-id="${getId(r)}" title="Print">
                            <i data-lucide="printer" size="14"></i>
                        </button>
                    ` : ''}
                    ${state.currentUser === 'admin' ? `
                        <button class="glass-btn" style="padding:4px;color:var(--danger);background:rgba(239,68,68,0.05);" data-action="delete-request" data-id="${getId(r)}" title="Delete">
                            <i data-lucide="trash-2" size="14"></i>
                        </button>
                    ` : (r.status !== 'approved' ? '-' : '')}
                </td>
            </tr>
        `).join('');
    }
}

function renderItemsSummary(items) {
    if (!items || !items.length) return '-';

    const getItemStock = (id) => {
        const p = state.products.find(prod => (prod._id || prod.id) === id);
        return p ? p.stock : 0;
    };

    const first = items[0].productName;
    const firstId = items[0].productId;
    const qty = items[0].qty;
    const sn = items[0].serialNumber;
    const stock = getItemStock(firstId);

    if (items.length === 1) {
        return `
            <div>
                <strong>${first}</strong> (x${qty})
                ${sn ? `<div style="color:var(--primary); font-family:monospace; font-size:11px; margin-top:2px;">SN: ${sn}</div>` : `<div style="color:var(--text-muted); font-size:11px;">Available: ${stock}</div>`}
            </div>
        `;
    }

    const fullList = items.map(it => {
        const s = getItemStock(it.productId);
        return `${it.productName} (x${it.qty})${it.serialNumber ? ` [SN: ${it.serialNumber}]` : ` [Avail: ${s}]`}`;
    }).join('\n');

    return `<span title="${fullList}" style="cursor:help; border-bottom:1px dotted var(--text-muted); font-weight:500;">${first} (x${qty}) +${items.length - 1} more</span>`;
}

export function renderInventory(category) {
    const container = document.getElementById(category + '-inventory');
    if (!container) return;
    const searchEl = document.getElementById(category + '-search');
    const searchTerm = searchEl ? searchEl.value.toLowerCase() : '';
    const prods = state.products.filter(p =>
        p.category === category &&
        (p.name.toLowerCase().includes(searchTerm) ||
            Object.values(p.specs || {}).some(v => String(v).toLowerCase().includes(searchTerm)) ||
            (p.units || []).some(u => u.serialNumber.toLowerCase().includes(searchTerm)))
    );
    container.innerHTML = prods.map(p => `
        <div class="glass product-card ${category}">
            <div class="product-info">
                <div class="flex justify-between items-center mb-2">
                    <h3>${p.name}</h3>
                        <div class="flex gap-1">
                            <button class="glass-btn" style="padding:5px; color:var(--primary);" data-action="view-units" data-id="${getId(p)}" title="View Serial Numbers"><i data-lucide="list" size="14"></i></button>
                            ${state.currentUser === 'admin' ? `
                                <button class="glass-btn" style="padding:5px; background:rgba(16,185,129,0.1); color:var(--secondary);" data-action="add-stock" data-id="${getId(p)}" title="Add Stock"><i data-lucide="plus-circle" size="14"></i></button>
                                <button class="glass-btn" style="padding:5px; color:var(--primary);" data-action="edit" data-id="${getId(p)}" data-category="${category}" title="Edit"><i data-lucide="edit-2" size="14"></i></button>
                                <button class="glass-btn" style="padding:5px; color:var(--danger); background:rgba(239,68,68,0.1);" data-action="delete" data-id="${getId(p)}" title="Delete"><i data-lucide="trash-2" size="14"></i></button>
                            ` : ''}
                        </div>
                </div>
                ${(() => {
            const items = [];
            const model = p.model || p.specs?.model;
            const size = p.size || p.specs?.size;
            const material = p.material || p.specs?.material;
            if (model) items.push({ key: 'Model', val: model });
            if (size) items.push({ key: 'Size', val: size });
            if (material) items.push({ key: 'Material', val: material });

            // Fallback for CRI motors with power/phase
            if (!model && !size && !material && items.length === 0) { 
                Object.entries(p.specs || {}).forEach(([k, v]) => items.push({ key: k, val: v }));
            }
            return items.map(({ key, val }) => `
                        <div class="spec-item">
                            <span style="text-transform:capitalize;">${key}:</span>
                            <span class="spec-value">${val}</span>
                        </div>
                    `).join('');
        })()}
            </div>
            <div class="stock-indicator">
                <div class="stock-main" style="margin-bottom: 12px;">
                    <span class="stat-label">In Stock</span>
                    <span class="stock-level ${p.stock <= (p.lowStockLimit || 10) ? 'text-danger' : 'text-primary'}">${p.stock}</span>
                </div>
                ${(() => {
                    const sns = (p.units || []).map(u => u.serialNumber).filter(s => s && s.trim());
                    if (sns.length === 0) return '';
                    const summary = sns.length > 3 ? `${sns.slice(0, 3).join(', ')} ...` : sns.join(', ');
                    return `
                        <div class="sn-nearby" title="${sns.join(', ')}" style="background: rgba(37, 99, 235, 0.05); border: 1px solid rgba(37, 99, 235, 0.1); border-radius: 8px; padding: 6px 10px;">
                            <span class="sn-label" style="font-size:10px; color: var(--primary); font-weight: 800;">SERIALS:</span>
                            <span class="sn-list" style="font-size:12px; font-weight:600; color: var(--text-main); font-family: monospace;">${summary}</span>
                        </div>
                    `;
                })()}
            </div>
            <div class="location-stock-breakdown">
                ${Object.entries((p.units || []).filter(u => u.status === 'available').reduce((acc, u) => {
            const loc = u.location || 'Main Godown';
            acc[loc] = (acc[loc] || 0) + 1;
            return acc;
        }, {})).map(([loc, count]) => `
                    <span class="loc-pill" title="${loc}">${loc.split(' ')[0]}: ${count}</span>
                `).join('')}
            </div>
        </div>
    `).join('');
    initIcons();
}

function renderInventoryList(category, targetId) {
    const container = document.getElementById(targetId);
    if (!container) return;
    const prods = state.products.filter(p => p.category === category);
    container.innerHTML = prods.map(p => {
        const sns = (p.units || []).map(u => u.serialNumber).filter(s => s && s.trim());
        const snSummary = sns.length > 0 
            ? `<div style="font-size:11px; color:var(--text-muted); margin-top:4px; font-family:monospace;">SN: ${sns.length > 3 ? sns.slice(0, 3).join(', ') + '...' : sns.join(', ')}</div>`
            : '';
            
        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${p.name}</div>
                    ${snSummary}
                </td>
                <td style="color:var(--text-muted);font-size:13px;">
                    ${Object.entries(p.specs || {}).map(([k, v]) => `<span style="text-transform:capitalize;">${k}</span>: ${v}`).join(' | ')}
                </td>
                <td>
                    <span style="font-size:16px;font-weight:700;color:${p.stock <= (p.lowStockLimit || 10) ? 'var(--danger)' : 'var(--primary)'}">
                        ${p.stock} Units
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

export function renderRequests() {
    const tbody = document.getElementById('all-requests-table');
    if (!tbody) return;
    tbody.innerHTML = state.requests.map(r => `
        <tr>
            <td style="font-size:12px;color:var(--text-muted);">#${String(getId(r)).slice(-6)}</td>
            <td>${formatDate(r.date)}</td>
            <td style="font-size:13px;">${renderItemsSummary(r.items)}</td>
            <td>${r.source}</td>
            <td>${r.dest}</td>
            <td>
                <span class="status-pill status-${r.status}" style="display:inline-flex;align-items:center;gap:4px;">
                    <i data-lucide="${r.status === 'approved' ? 'check' : (r.status === 'rejected' ? 'x' : (r.status === 'returned' ? 'rotate-ccw' : 'clock'))}" size="12"></i>
                    ${r.status}
                </span>
            </td>
            <td>
                <div class="flex gap-2" style="justify-content:center;">
                    ${state.currentUser === 'admin' && r.status !== 'returned' ? `
                        <button class="glass-btn" style="padding:6px;color:var(--primary);" data-action="print" data-id="${getId(r)}" title="Print Challan">
                            <i data-lucide="printer" size="16"></i>
                        </button>
                    ` : ''}

                    ${state.currentUser === 'admin' && r.status === 'approved' ? `
                        <button class="glass-btn" style="padding:6px;color:var(--secondary);background:rgba(16,185,129,0.1);" data-action="return" data-id="${getId(r)}" title="Return Stock">
                            <i data-lucide="rotate-ccw" size="16"></i>
                        </button>
                    ` : ''}
                    
                    ${state.currentUser === 'transporter' && r.status === 'pending' ? `
                        <button class="glass-btn" style="padding:6px;background:rgba(16,185,129,0.2);color:#10b981;" data-action="approve" data-id="${getId(r)}" title="Accept">
                            <i data-lucide="check-circle" size="16"></i>
                        </button>
                        <button class="glass-btn" style="padding:6px;background:rgba(239,68,68,0.2);color:#ef4444;" data-action="reject" data-id="${getId(r)}" title="Reject">
                            <i data-lucide="x-circle" size="16"></i>
                        </button>
                    ` : ''}

                    ${state.currentUser === 'admin' && r.status === 'pending' ? `
                        <span style="font-size:11px;color:var(--text-muted);font-style:italic;">Waiting for Transporter</span>
                    ` : ''}

                    ${state.currentUser === 'admin' ? `
                        <button class="glass-btn" style="padding:6px;background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2);" data-action="delete-request" data-id="${getId(r)}" title="Delete Challan">
                            <i data-lucide="trash-2" size="16"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
    initIcons();
}

function renderLogs() {
    const tbody = document.getElementById('logs-table');
    if (!tbody) return;
    tbody.innerHTML = state.logs.map(l => `
        <tr>
            <td style="color:var(--text-muted);font-size:12px;">${new Date(l.timestamp).toLocaleString()}</td>
            <td>${l.type}</td>
            <td>${l.item}</td>
            <td>${l.before}</td>
            <td class="${l.change >= 0 ? 'text-primary' : 'text-danger'}">${l.change > 0 ? '+' : ''}${l.change}</td>
            <td style="font-weight:600;">${l.after}</td>
            <td>${l.user}</td>
        </tr>
    `).join('');
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString();
}

function isToday(iso) {
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString();
}
