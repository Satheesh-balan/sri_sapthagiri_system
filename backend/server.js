const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// ──────────────────────────────────────────
// RETENTION POLICY: 1.5 years in seconds
// ──────────────────────────────────────────
const RETENTION_SECONDS = 18 * 30 * 24 * 60 * 60; // 18 months ≈ 547 days
const RETENTION_MS      = RETENTION_SECONDS * 1000;

app.use(cors());
app.use(express.json());
// MongoDB Connection — Auto-Retry on boot (network may not be ready immediately)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sri_sapthagiri';

async function connectWithRetry(attempt = 1) {
    const MAX_ATTEMPTS = 20; // retry for up to ~2 minutes
    console.log(`📡 Connecting to MongoDB... (attempt ${attempt}/${MAX_ATTEMPTS})`);
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            dbName: 'sri_sapthagiri',
            serverSelectionTimeoutMS: 8000, // wait 8s per attempt
            socketTimeoutMS: 45000,
        });
        console.log('✅ MongoDB Connected Successfully');
        seedDatabase();
    } catch (err) {
        console.error(`❌ MongoDB Connection Failed (attempt ${attempt}): ${err.message}`);
        if (attempt < MAX_ATTEMPTS) {
            console.log(`⏳ Retrying in 6 seconds...`);
            setTimeout(() => connectWithRetry(attempt + 1), 6000);
        } else {
            console.error('🚨 Could not connect to MongoDB after maximum attempts. Server will still run but DB features unavailable.');
        }
    }
}

// Handle MongoDB disconnections (auto-reconnect)
mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    setTimeout(() => connectWithRetry(), 5000);
});
mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB Reconnected');
});

connectWithRetry();


// ──────────────────────────────────────────
// SCHEMAS & MODELS
// ──────────────────────────────────────────
const productSchema = new mongoose.Schema({
    category:      { type: String, enum: ['supreme', 'cri'], required: true },
    name:          { type: String, required: true },
    model:         { type: String, default: '' },
    size:          { type: String, default: '' },
    material:      { type: String, default: '' },
    specs:         { type: mongoose.Schema.Types.Mixed, default: {} },
    stock:         { type: Number, default: 0 },
    lowStockLimit: { type: Number, default: 10 },
    stockHistory: [{
        before:    Number,
        added:     Number,
        after:     Number,
        location:  String,
        type:      { type: String, enum: ['inflow', 'adjustment', 'initial'], default: 'inflow' },
        timestamp: { type: Date, default: Date.now }
    }],
    units: [{
        serialNumber: { type: String },
        status: { type: String, enum: ['available', 'sold', 'in-transit', 'dispatched'], default: 'available' },
        location: { type: String, default: 'Main Godown' },
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Compound index — unique serial numbers within the collection
productSchema.index({ 'units.serialNumber': 1 }, { unique: false, sparse: true });

const requestSchema = new mongoose.Schema({
    date:        { type: Date, default: Date.now },
    items: [{
        productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        productName: String,
        qty:         Number,
        category:    String,
        serialNumber: String
    }],
    source:      String,
    dest:        String,
    status:      { type: String, enum: ['pending', 'approved', 'rejected', 'returned'], default: 'pending' },
}, { timestamps: true });

// TTL index → MongoDB auto-deletes requests older than 18 months
requestSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const logSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    type:      String,
    item:      String,
    before:    Number,
    change:    Number,
    after:     Number,
    user:      String,
}, { timestamps: true });

// TTL index → MongoDB auto-deletes logs older than 18 months
logSchema.index({ timestamp: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const locationSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);
const Request = mongoose.model('Request', requestSchema);
const Log     = mongoose.model('Log', logSchema);
const Location = mongoose.model('Location', locationSchema);

// ──────────────────────────────────────────
// SEED DEFAULT DATA
// ──────────────────────────────────────────
async function seedDatabase() {
    const pCount = await Product.countDocuments();
    if (pCount === 0) {
        await Product.insertMany([
            { category: 'supreme', name: '4-Inch PVC Pipe', specs: { model: 'S-400', size: '4"', material: 'PVC' }, stock: 150, lowStockLimit: 20 },
            { category: 'supreme', name: '2-Inch GI Pipe',  specs: { model: 'G-200', size: '2"', material: 'GI'  }, stock: 85,  lowStockLimit: 15 },
            { category: 'cri', name: '1.5HP Jet Pump',   specs: { model: 'Jet-X1', power: '1.5HP', phase: 'Single' }, stock: 42, lowStockLimit: 10 },
            { category: 'cri', name: '5HP Submersible',  specs: { model: 'Sub-X5', power: '5HP',   phase: 'Three'  }, stock: 12, lowStockLimit: 5  },
        ]);
        console.log('🌱 Database seeded with default products');
    }

    const lCount = await Location.countDocuments();
    if (lCount === 0) {
        await Location.insertMany([
            { name: 'Main Godown' },
            { name: 'North Godown' },
            { name: 'South Godown' }
        ]);
        console.log('🌱 Database seeded with default locations');
    }
}

// ──────────────────────────────────────────
// ROUTES: AUTH
// ──────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
    const { role, password } = req.body;
    if (role === 'admin') {
        if (password === (process.env.ADMIN_PASSWORD || '12345678'))
            return res.json({ success: true, role: 'admin' });
        return res.status(401).json({ success: false, message: 'Invalid Admin Password' });
    }
    if (role === 'transporter')
        return res.json({ success: true, role: 'transporter' });
    return res.status(400).json({ success: false, message: 'Invalid role' });
});

// ──────────────────────────────────────────
// ROUTES: PRODUCTS
// ──────────────────────────────────────────
app.get('/api/products', async (req, res) => {
    try { res.json(await Product.find().sort({ createdAt: -1 })); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
    try {
        const productData = { ...req.body };
        const { serialNumbers, location } = productData;
        const snList = (serialNumbers || []).filter(s => s && s.trim());

        // Auto-calculate stock from serial count if serials are provided
        if (snList.length > 0) {
            productData.stock = snList.length;
        } else {
            // Otherwise use the provided stock (manual entry)
            productData.stock = parseInt(productData.stock) || 0;
        }
        // Client-side dedup guard — also check server-side
        const uniqueSet = [...new Set(snList)];
        if (uniqueSet.length !== snList.length) {
            return res.status(400).json({ error: 'Duplicate serial numbers found in your input. Each serial number must be unique.' });
        }
        // Check for conflicts across the entire database
        if (snList.length > 0) {
            const conflict = await Product.findOne({ 'units.serialNumber': { $in: snList } });
            if (conflict) {
                const conflicting = conflict.units.filter(u => snList.includes(u.serialNumber)).map(u => u.serialNumber);
                return res.status(400).json({ error: `Serial numbers already exist in the system: ${conflicting.join(', ')}` });
            }
        }

        // Normalize specs from top-level model/size/material fields
        productData.specs = {
            model: productData.model || '',
            size: productData.size || '',
            material: productData.material || '',
        };

        if (productData.stock > 0) {
            productData.stockHistory = [{
                before: 0,
                added: productData.stock,
                after: productData.stock,
                location: location || 'Main Godown',
                type: 'initial',
                timestamp: new Date()
            }];

            if (snList.length === 0) {
                // Generate blank units for any product if no serials provided (e.g. pipes or bulk items)
                productData.units = Array(productData.stock).fill(0).map(() => ({
                    serialNumber: '',
                    status: 'available',
                    location: location || 'Main Godown'
                }));
            } else {
                productData.units = snList.map(sn => ({
                    serialNumber: sn.trim(),
                    status: 'available',
                    location: location || 'Main Godown'
                }));
            }
        }
        delete productData.serialNumbers;
        const product = await new Product(productData).save();
        await Log.create({ type: 'Product Added', item: product.name, before: 0, change: product.stock, after: product.stock, user: req.headers['x-user'] || 'admin' });
        res.status(201).json(product);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        
        const oldStock = product.stock;
        const newStock = parseInt(req.body.stock);
        const nameChanged = req.body.name && req.body.name !== product.name;
        
        // Update basic fields
        if (req.body.name) product.name = req.body.name;
        if (req.body.model) product.model = req.body.model;
        if (req.body.size) product.size = req.body.size;
        if (req.body.material) product.material = req.body.material;
        if (req.body.lowStockLimit !== undefined) product.lowStockLimit = parseInt(req.body.lowStockLimit);
        
        // Build specs for compatibility
        product.specs = {
            model: product.model || '',
            size: product.size || '',
            material: product.material || '',
        };

        // Sync units if stock changed
        if (!isNaN(newStock) && newStock !== oldStock) {
            if (newStock > oldStock) {
                const diff = newStock - oldStock;
                // Add blank units to match the new stock count
                for (let i = 0; i < diff; i++) {
                    product.units.push({
                        serialNumber: '',
                        status: 'available',
                        location: 'Main Godown'
                    });
                }
                product.stockHistory.push({
                    before: oldStock,
                    added: diff,
                    after: newStock,
                    type: 'adjustment',
                    timestamp: new Date()
                });
                product.stock = newStock;
            } else {
                const diff = oldStock - newStock;
                // Remove 'available' units to match reduction
                let removed = 0;
                for (let i = product.units.length - 1; i >= 0 && removed < diff; i--) {
                    if (product.units[i].status === 'available') {
                        product.units.splice(i, 1);
                        removed++;
                    }
                }
                // Update stock count to actual remaining units
                product.stock = product.units.length;
            }

            await Log.create({ 
                type: 'Inventory Adjustment', 
                item: product.name, 
                before: oldStock, 
                change: newStock - oldStock, 
                after: newStock, 
                user: req.headers['x-user'] || 'admin' 
            });
        }

        await product.save();
        res.json(product);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.patch('/api/products/:id/add-stock', async (req, res) => {
    try {
        const { qty, serialNumbers, location } = req.body;
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const before = product.stock;
        product.stock += qty;
        
        // Add to history
        product.stockHistory.push({
            before,
            added: qty,
            after: product.stock,
            location: location || 'Main Godown',
            type: 'inflow',
            timestamp: new Date()
        });

        // Add units
        if (!serialNumbers || serialNumbers.length === 0) {
            // Add blank units if no serials provided
            for (let i = 0; i < qty; i++) {
                product.units.push({
                    serialNumber: '',
                    status: 'available',
                    location: location || 'Main Godown'
                });
            }
        } else if (serialNumbers && Array.isArray(serialNumbers)) {
            serialNumbers.forEach(sn => {
                product.units.push({ 
                    serialNumber: sn, 
                    status: 'available', 
                    location: location || 'Main Godown' 
                });
            });
        }

        await product.save();
        await Log.create({ type: 'Stock Inflow', item: product.name, before, change: qty, after: product.stock, user: req.headers['x-user'] || 'admin' });
        res.json(product);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        await Log.create({ type: 'Product Deleted', item: product.name, before: product.stock, change: -product.stock, after: 0, user: req.headers['x-user'] || 'admin' });
        res.json({ message: 'Product deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────
// ROUTES: REQUESTS (CHALLANS)
// ──────────────────────────────────────────
app.get('/api/requests', async (req, res) => {
    try { res.json(await Request.find().sort({ createdAt: -1 })); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests', async (req, res) => {
    try {
        const { items, source, dest } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one product is required for a challan.' });
        }

        const processedItems = [];
        
        // Validation & Deduction Pass
        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) return res.status(404).json({ error: `Product not found: ${item.productId}` });

            // --- AUTO-REBALANCING & REPAIR SYSTEM ---
            let availableInRequested = product.units.filter(u => 
                u.status === 'available' && 
                u.location.trim().toLowerCase() === source.trim().toLowerCase()
            );

            if (availableInRequested.length < item.qty && product.stock >= item.qty) {
                console.log(`[Auto-Balance] Moving units for ${product.name} to ${source} to fulfill request.`);
                let moved = 0;
                const needed = item.qty - availableInRequested.length;
                for (let unit of product.units) {
                    if (unit.status === 'available' && unit.location.trim().toLowerCase() !== source.trim().toLowerCase()) {
                        unit.location = source;
                        moved++;
                        if (moved === needed) break;
                    }
                }
                if (moved < needed && product.units.length < product.stock) {
                    const remaining = needed - moved;
                    for (let i = 0; i < remaining; i++) {
                        product.units.push({ serialNumber: '', status: 'available', location: source });
                    }
                }
                await product.save();
                availableInRequested = product.units.filter(u => u.status === 'available' && u.location.trim().toLowerCase() === source.trim().toLowerCase());
            }
            
            if (availableInRequested.length < item.qty) {
                return res.status(400).json({ error: `Insufficient stock for ${product.name} in ${source}! (Available: ${availableInRequested.length}, Total: ${product.stock})` });
            }

            // Deduct Stock
            const beforeValue = product.stock;
            product.stock -= item.qty;
            let dispatchedCount = 0;
            for (let unit of product.units) {
                const isTargetUnit = item.serialNumber 
                    ? (unit.serialNumber === item.serialNumber)
                    : (unit.status === 'available' && unit.location.trim().toLowerCase() === source.trim().toLowerCase());

                if (isTargetUnit && unit.status === 'available' && unit.location.trim().toLowerCase() === source.trim().toLowerCase()) {
                    unit.status = 'in-transit';
                    dispatchedCount++;
                    if (dispatchedCount === item.qty) break;
                }
            }
            await product.save();
            await Log.create({ 
                type: 'Transportation Requested', 
                item: product.name, 
                before: beforeValue, 
                change: -item.qty, 
                after: product.stock, 
                user: req.headers['x-user'] || 'admin' 
            });

            processedItems.push({
                productId: product._id,
                productName: product.name,
                qty: item.qty,
                category: product.category,
                serialNumber: item.serialNumber || ''
            });
        }

        const request = await Request.create({
            items: processedItems,
            source,
            dest,
            status: 'pending'
        });
        res.status(201).json(request);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/requests/:id/revert', async (req, res) => {
    console.log(`[Revert] Processing revert for challan: ${req.params.id}`);
    try {
        const request = await Request.findById(req.params.id);
        if (!request) return res.status(404).json({ error: 'Challan not found' });
        
        // Allow reverting if rejected OR approved
        if (request.status !== 'rejected' && request.status !== 'approved') {
            return res.status(400).json({ error: 'Only rejected or approved challans can be returned.' });
        }

        for (let item of request.items) {
            const product = await Product.findById(item.productId);
            if (!product) continue;

            let revertedCount = 0;
            for (let unit of product.units) {
                const isTargetUnit = item.serialNumber 
                    ? (unit.serialNumber === item.serialNumber)
                    : (unit.status === 'in-transit' && unit.location.trim().toLowerCase() === request.source.trim().toLowerCase());

                if (isTargetUnit && unit.status === 'in-transit') {
                    unit.status = 'available';
                    revertedCount++;
                    if (revertedCount === item.qty) break;
                }
            }
            product.stock += item.qty;
            await product.save();
        }

        request.status = 'returned';
        await request.save();

        await Log.create({ 
            type: 'Challan Returned', 
            item: `Challan #${String(request._id).slice(-6)}`, 
            user: req.headers['x-user'] || 'admin' 
        });

        res.json(request);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const request = await Request.findById(req.params.id);
        if (!request) return res.status(404).json({ error: 'Request not found' });
        
        // Stock is now handled during creation (moved to in-transit)
        // Approval simply confirms the status.
        
        request.status = status;
        await request.save();
        res.json(request);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/requests/:id', async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.id);
        if (!request) return res.status(404).json({ error: 'Challan not found' });
        await Log.create({ 
            type: 'Challan Deleted', 
            item: `Challan #${String(request._id).slice(-6)}`, 
            user: req.headers['x-user'] || 'admin' 
        });
        res.json({ message: 'Challan deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────
// ROUTES: LOCATIONS
// ──────────────────────────────────────────
app.get('/api/locations', async (req, res) => {
    try { res.json(await Location.find().sort({ name: 1 })); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/locations', async (req, res) => {
    try {
        const location = new Location({ name: req.body.name });
        await location.save();
        res.status(201).json(location);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/locations/:name', async (req, res) => {
    try {
        await Location.findOneAndDelete({ name: req.params.name });
        res.json({ message: 'Location deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────
// ROUTES: LOGS
// ──────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
    try { res.json(await Log.find().sort({ timestamp: -1 })); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────
// ROUTES: SERIAL NUMBER SEARCH
// ──────────────────────────────────────────
app.get('/api/serials/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.json([]);
        const products = await Product.find({ 'units.serialNumber': { $regex: q, $options: 'i' } });
        const results = [];
        products.forEach(p => {
            p.units.filter(u => u.serialNumber && u.serialNumber.toLowerCase().includes(q.toLowerCase())).forEach(u => {
                results.push({
                    serialNumber: u.serialNumber,
                    status: u.status,
                    location: u.location,
                    productId: p._id,
                    productName: p.name,
                    model: p.model || p.specs?.model || '',
                    category: p.category,
                    registeredOn: u.timestamp
                });
            });
        });
        res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────
// ROUTES: DATA RETENTION
// ──────────────────────────────────────────

// GET: retention stats (how many records are old and would be deleted)
app.get('/api/retention/stats', async (req, res) => {
    try {
        const cutoff  = new Date(Date.now() - RETENTION_MS);
        const oldLogs = await Log.countDocuments({ timestamp: { $lt: cutoff } });
        const oldReqs = await Request.countDocuments({ createdAt: { $lt: cutoff } });
        const totalLogs = await Log.countDocuments();
        const totalReqs = await Request.countDocuments();
        res.json({
            retentionMonths: 18,
            cutoffDate: cutoff.toISOString(),
            logs:     { total: totalLogs, old: oldLogs },
            requests: { total: totalReqs, old: oldReqs },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE: manual purge of records older than 18 months
app.delete('/api/retention/purge', async (req, res) => {
    try {
        const cutoff     = new Date(Date.now() - RETENTION_MS);
        const logsResult = await Log.deleteMany({ timestamp: { $lt: cutoff } });
        const reqsResult = await Request.deleteMany({ createdAt: { $lt: cutoff } });
        await Log.create({
            type: 'Manual Data Purge',
            item: `Deleted ${logsResult.deletedCount} logs + ${reqsResult.deletedCount} challans older than 18 months`,
            before: logsResult.deletedCount + reqsResult.deletedCount,
            change: -(logsResult.deletedCount + reqsResult.deletedCount),
            after: 0,
            user: req.headers['x-user'] || 'admin',
        });
        res.json({
            success: true,
            deletedLogs:     logsResult.deletedCount,
            deletedRequests: reqsResult.deletedCount,
            message: `Purged ${logsResult.deletedCount} log entries and ${reqsResult.deletedCount} challans older than 18 months.`,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ping endpoint for health check
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok' });
});

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

// 404 Handler for API
app.use('/api', (req, res) => {
    res.status(404).json({ error: `API Route not found: ${req.method} ${req.originalUrl}` });
});

// Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Sri Sapthagiri Server running on http://localhost:${PORT}`);
    console.log(`🗂️  Data Retention Policy: 18 months (auto-purge via MongoDB TTL)`);
});

module.exports = app;
