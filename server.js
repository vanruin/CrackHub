const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

// Import backends
const { getRandomNetflixCookie, getNetflixAccountCount } = require('./backend/netflix');
const { getRandomCrunchyrollAccount, getCrunchyrollAccountCount } = require('./backend/crunchyroll');
const { getRandomHboCookie, getHboCookieCount } = require('./backend/hbo');
const { getRandomParamountAccount, getParamountAccountCount } = require('./backend/paramount');
const { getRandomDisneyAccount, getDisneyAccountCount } = require('./backend/disney');
const { getRandomGarenaAccount, getGarenaAccountCount } = require('./backend/garena');
const { getRandomMoontonAccount, getMoontonAccountCount } = require('./backend/moonton');
const { getRandomXboxAccount, getXboxAccountCount } = require('./backend/xbox');
const { getRandomCapcutAccount, getCapcutAccountCount } = require('./backend/capcut');

// Steam backend (uses steam.json)
// Steam backend (uses steam.json)
const {
    getRandomSteamAccount,
    getSteamAccountCount,
    addSteamAccount,
    removeSteamAccount,
    getAllAccounts: getAllSteamAccounts,
    loadSteamAccounts,
    searchAccounts,
    getAccountByUsername
} = require('./backend/steam');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ STEAM API ENDPOINTS ============

// Get random Steam account (optionally filtered by game)
app.post('/api/search-accounts', async (req, res) => {
    try {
        const { term } = req.body || {};
        const result = await searchAccounts(term);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a specific account by username (includes password)
app.get('/api/steam-account/:username', async (req, res) => {
    try {
        const result = await getAccountByUsername(req.params.username);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy: get first account matching a game (kept for compatibility)
app.post('/api/get-random-steam-account', async (req, res) => {
    try {
        const game = (req.body && req.body.game) ? req.body.game : null;
        const result = await getRandomSteamAccount(game);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Count
app.get('/api/steam-count', async (req, res) => {
    try {
        const count = await getSteamAccountCount();
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// List all accounts (admin, no passwords)
app.get('/api/steam-accounts', async (req, res) => {
    try {
        const accounts = await getAllSteamAccounts();
        res.json({ success: true, accounts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add account
app.post('/api/steam-accounts', async (req, res) => {
    try {
        const { username, password, games, status } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password required' });
        }
        const result = await addSteamAccount(username, password, games, status);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Remove account by username
app.delete('/api/steam-accounts/:username', async (req, res) => {
    try {
        const result = await removeSteamAccount(req.params.username);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============ OTHER SERVICE ENDPOINTS ============

app.post('/api/get-random-crunchyroll-account', async (req, res) => {
    try {
        const result = await getRandomCrunchyrollAccount();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-hbo-cookie', async (req, res) => {
    console.log('\n🍪 HBO API called');
    try {
        const result = await getRandomHboCookie();
        console.log('✅ Sending HBO cookie');
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-paramount-account', async (req, res) => {
    console.log('\n⭐ Paramount+ API called');
    try {
        const result = await getRandomParamountAccount();
        console.log('✅ Sending Paramount+ account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-disney-account', async (req, res) => {
    console.log('\n✨ Disney+ API called');
    try {
        const result = await getRandomDisneyAccount();
        console.log('✅ Sending Disney+ account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-garena-account', async (req, res) => {
    console.log('\n🎮 Garena API called');
    try {
        const result = await getRandomGarenaAccount();
        console.log('✅ Sending Garena account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-moonton-account', async (req, res) => {
    console.log('\n🏆 Moonton API called');
    try {
        const result = await getRandomMoontonAccount();
        console.log('✅ Sending Moonton account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-netflix-cookie', async (req, res) => {
    console.log('\n🎬 Netflix API called');
    try {
        const method = (req.body && req.body.method) ? req.body.method : 'smart';
        const result = await getRandomNetflixCookie(method);
        console.log('✅ Sending Netflix account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-xbox-account', async (req, res) => {
    console.log('\n🎮 Xbox API called');
    try {
        const result = await getRandomXboxAccount();
        console.log('✅ Sending Xbox account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-capcut-account', async (req, res) => {
    console.log('\n✂️ CapCut API called');
    try {
        const result = await getRandomCapcutAccount();
        console.log('✅ Sending CapCut account:', result.data.email);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ TEST ENDPOINTS ============

app.get('/api/test-netflix', async (req, res) => {
    const count = await getNetflixAccountCount();
    res.json({ service: 'Netflix', accountCount: count });
});

app.get('/api/test-capcut', async (req, res) => {
    const count = await getCapcutAccountCount();
    res.json({ service: 'CapCut', accountCount: count });
});

app.get('/api/test-xbox', async (req, res) => {
    const count = await getXboxAccountCount();
    res.json({ service: 'Xbox', accountCount: count });
});

app.get('/api/test-moonton', async (req, res) => {
    const count = await getMoontonAccountCount();
    res.json({ service: 'Moonton', accountCount: count });
});

app.get('/api/test-garena', async (req, res) => {
    const count = await getGarenaAccountCount();
    res.json({ service: 'Garena', accountCount: count });
});

app.get('/api/test-steam', async (req, res) => {
    const accounts = await loadSteamAccounts();
    res.json({ service: 'Steam', accountCount: accounts.length });
});

app.get('/api/test-crunchyroll', async (req, res) => {
    const count = await getCrunchyrollAccountCount();
    res.json({ service: 'Crunchyroll', accountCount: count });
});

app.get('/api/test-hbo', async (req, res) => {
    const count = await getHboCookieCount();
    res.json({ service: 'HBO Max', cookieCount: count });
});

app.get('/api/test-paramount', async (req, res) => {
    const count = await getParamountAccountCount();
    res.json({ service: 'Paramount+', accountCount: count });
});

app.get('/api/test-disney', async (req, res) => {
    const count = await getDisneyAccountCount();
    res.json({ service: 'Disney+', accountCount: count });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ============ HTML ROUTES ============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'intro.html'));
});
app.get('/netflix', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'netflix.html'));
});
app.get('/steam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'steam.html'));
});
app.get('/crunchyroll', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crunchyroll.html'));
});
app.get('/hbo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'hbo.html'));
});
app.get('/paramount', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'paramount.html'));
});
app.get('/disney', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'disney.html'));
});
app.get('/capcut', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'capcut.html'));
});
app.get('/xbox', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'xbox.html'));
});
app.get('/moonton', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'moonton.html'));
});
app.get('/garena', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'garena.html'));
});

// ============ START SERVER ============

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎮 MULTI-SERVICE ACCOUNT GENERATOR');
    console.log('='.repeat(60));
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`🎬 Netflix: http://localhost:${PORT}/netflix`);
    console.log(`🎮 Steam: http://localhost:${PORT}/steam`);
    console.log(`🍣 Crunchyroll: http://localhost:${PORT}/crunchyroll`);
    console.log(`🍪 HBO Max: http://localhost:${PORT}/hbo`);
    console.log(`⭐ Paramount+: http://localhost:${PORT}/paramount`);
    console.log(`✨ Disney+: http://localhost:${PORT}/disney`);
    console.log('='.repeat(60) + '\n');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`❌ Port ${PORT} is busy, trying port ${PORT + 1}...`);
        app.listen(PORT + 1);
    }
});