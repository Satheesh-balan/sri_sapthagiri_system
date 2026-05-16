// API client — all fetch calls go through here
// Dynamic BASE_URL detection
export const BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5001/api'
    : '/api';

function getUser() {
    return sessionStorage.getItem('ss_user') || 'guest';
}

function headers() {
    return { 'Content-Type': 'application/json', 'x-user': getUser() };
}

// Helper to handle responses and avoid "Unexpected token <" errors
async function handleResponse(res) {
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server Error (${res.status})`);
        return data;
    } else {
        // Not JSON — probably a 404 HTML page or server error
        const text = await res.text();
        console.error('Non-JSON Response:', text);
        throw new Error(`Server returned an unexpected response (HTML). Check if the backend is running correctly.`);
    }
}

// ──────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────
export async function loginUser(role, password = '') {
    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ role, password }),
    });
    return handleResponse(res);
}

// ──────────────────────────────────────────
// PRODUCTS
// ──────────────────────────────────────────
export async function fetchProducts() {
    const res = await fetch(`${BASE_URL}/products`);
    return handleResponse(res);
}

export async function createProduct(data) {
    const res = await fetch(`${BASE_URL}/products`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function updateProduct(id, data) {
    const res = await fetch(`${BASE_URL}/products/${id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function addStock(id, qty, serialNumbers = [], location = 'Main Godown') {
    const res = await fetch(`${BASE_URL}/products/${id}/add-stock`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ qty, serialNumbers, location }),
    });
    return handleResponse(res);
}

export async function deleteProduct(id) {
    const res = await fetch(`${BASE_URL}/products/${id}`, {
        method: 'DELETE',
        headers: headers(),
    });
    return handleResponse(res);
}

// ──────────────────────────────────────────
// REQUESTS (CHALLANS)
// ──────────────────────────────────────────
export async function fetchRequests() {
    const res = await fetch(`${BASE_URL}/requests`);
    return handleResponse(res);
}

export async function createRequest(data) {
    const res = await fetch(`${BASE_URL}/requests`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function updateRequestStatus(id, status) {
    const res = await fetch(`${BASE_URL}/requests/${id}/status`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ status }),
    });
    return handleResponse(res);
}

export async function returnRequest(id) {
    const res = await fetch(`${BASE_URL}/requests/${id}/revert`, {
        method: 'POST',
        headers: headers(),
    });
    return handleResponse(res);
}

export async function deleteRequest(id) {
    const res = await fetch(`${BASE_URL}/requests/${id}`, {
        method: 'DELETE',
        headers: headers(),
    });
    return handleResponse(res);
}

// ──────────────────────────────────────────
// LOGS
// ──────────────────────────────────────────
export async function fetchLogs() {
    const res = await fetch(`${BASE_URL}/logs`);
    return handleResponse(res);
}

// ──────────────────────────────────────────
// LOCATIONS
// ──────────────────────────────────────────
export async function fetchLocations() {
    const res = await fetch(`${BASE_URL}/locations`);
    return handleResponse(res);
}

export async function addLocation(name) {
    const res = await fetch(`${BASE_URL}/locations`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name }),
    });
    return handleResponse(res);
}

export async function deleteLocation(name) {
    const res = await fetch(`${BASE_URL}/locations/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: headers(),
    });
    return handleResponse(res);
}

// ──────────────────────────────────────────
// DATA RETENTION
// ──────────────────────────────────────────
export async function fetchRetentionStats() {
    const res = await fetch(`${BASE_URL}/retention/stats`);
    return handleResponse(res);
}

export async function purgeOldData() {
    const res = await fetch(`${BASE_URL}/retention/purge`, {
        method: 'DELETE',
        headers: headers(),
    });
    return handleResponse(res);
}
