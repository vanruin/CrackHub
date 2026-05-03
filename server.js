const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { getRandomNetflixCookie, getNetflixAccountCount } = require('./backend/netflix');
// Import backends
const { getRandomCrunchyrollAccount, getCrunchyrollAccountCount } = require('./backend/crunchyroll');
const { getRandomHboCookie, getHboCookieCount } = require('./backend/hbo');
const { getRandomParamountAccount, getParamountAccountCount } = require('./backend/paramount');
const { getRandomDisneyAccount, getDisneyAccountCount } = require('./backend/disney');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ STEAM FUNCTIONS ============
async function loadSteamAccounts() {
    try {
        const steamPath = path.join(__dirname, 'public', 'Acccounts', 'steam.txt');
        await fs.access(steamPath);
        const data = await fs.readFile(steamPath, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() && line.includes(':'));
        const accounts = lines.map(line => {
            const [email, password] = line.split(':');
            return { email: email.trim(), password: password.trim() };
        });
        return accounts;
    } catch (error) {
        return [];
    }
}

async function getRandomSteamAccount() {
    const accounts = await loadSteamAccounts();
    if (accounts.length === 0) {
        throw new Error('No Steam accounts found in steam.txt');
    }
    const randomIndex = Math.floor(Math.random() * accounts.length);
    return {
        success: true,
        data: accounts[randomIndex],
        accountsRemaining: accounts.length
    };
}

// ============ API ENDPOINTS ============

// Steam endpoint
app.post('/api/get-random-steam-account', async (req, res) => {
    try {
        const result = await getRandomSteamAccount();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crunchyroll endpoint
app.post('/api/get-random-crunchyroll-account', async (req, res) => {
    try {
        const result = await getRandomCrunchyrollAccount();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// HBO endpoint
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

// Paramount+ endpoint
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

// Disney+ endpoint
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
// Add with other requires
const { getRandomGarenaAccount, getGarenaAccountCount } = require('./backend/garena');

// Add Garena endpoint
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
// Add with other requires
const { getRandomMoontonAccount, getMoontonAccountCount } = require('./backend/moonton');

// Add Moonton endpoint
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
// Netflix endpoint
app.post('/api/get-random-netflix-cookie', async (req, res) => {
    console.log('\n🎬 Netflix API called');
    try {
        const result = await getRandomNetflixCookie();
        console.log('✅ Sending Netflix cookie');
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Add with other requires
const { getRandomXboxAccount, getXboxAccountCount } = require('./backend/xbox');

// Add Xbox endpoint
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
app.get('/api/test-netflix', async (req, res) => {
    const count = await getNetflixAccountCount();
    res.json({ service: 'Netflix', accountCount: count });
});// Add with other requires
const { getRandomCapcutAccount, getCapcutAccountCount } = require('./backend/capcut');

// Add CapCut endpoint
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

// Add test endpoint
app.get('/api/test-capcut', async (req, res) => {
    const count = await getCapcutAccountCount();
    res.json({ service: 'CapCut', accountCount: count });
});

// Add route for HTML page
app.get('/capcut', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'capcut.html'));
});
// Add test endpoint
app.get('/api/test-xbox', async (req, res) => {
    const count = await getXboxAccountCount();
    res.json({ service: 'Xbox', accountCount: count });
});

// Add route for HTML page
app.get('/xbox', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'xbox.html'));
});
// Add test endpoint
app.get('/api/test-moonton', async (req, res) => {
    const count = await getMoontonAccountCount();
    res.json({ service: 'Moonton', accountCount: count });
});

// Add route for HTML page
app.get('/moonton', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'moonton.html'));
});
// Add test endpoint
app.get('/api/test-garena', async (req, res) => {
    const count = await getGarenaAccountCount();
    res.json({ service: 'Garena', accountCount: count });
});

// Add route for HTML page
app.get('/garena', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'garena.html'));
});

// Test endpoints
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

// Serve HTML files
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

// Start server
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