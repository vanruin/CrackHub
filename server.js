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

// Universal account parser — detects any credential format
const { parseAccounts, addAccountsToFile, getAccountCount, SERVICE_FILES } = require('./backend/accountParser');

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

// ============ PLATFORM LAYER (access keys, balance, tickets) ============

const auth = require('./backend/auth');
const config = require('./backend/config');
const { mountPlatformApi } = require('./backend/routes');

// Live pool sizes (storefront + admin dashboard)
const poolCounters = {
    netflix: getNetflixAccountCount,
    steam: getSteamAccountCount,
    hbo: getHboCookieCount,
    disney: getDisneyAccountCount,
    crunchyroll: getCrunchyrollAccountCount,
    paramount: getParamountAccountCount,
    xbox: getXboxAccountCount,
    moonton: getMoontonAccountCount,
    garena: getGarenaAccountCount,
    capcut: getCapcutAccountCount,
};

// Used to issue replacement accounts when a support ticket is accepted
const generators = {
    netflix: () => getRandomNetflixCookie('smart'),
    steam: () => getRandomSteamAccount(null),
    hbo: () => getRandomHboCookie(),
    disney: () => getRandomDisneyAccount(),
    crunchyroll: () => getRandomCrunchyrollAccount(),
    paramount: () => getRandomParamountAccount(),
    xbox: () => getRandomXboxAccount(),
    moonton: () => getRandomMoontonAccount(),
    garena: () => getRandomGarenaAccount(),
    capcut: () => getRandomCapcutAccount(),
};

// Middleware
app.use(cors());

// Same-origin guard for state-changing API calls: the session cookie is
// SameSite=Lax, and this rejects forged cross-site POSTs before the body is
// even parsed. Requests without an Origin header (curl / X-CrackHub-Key
// clients) are allowed through.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api', (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
        if (new URL(origin).host === req.headers.host) return next();
    } catch (err) { /* malformed Origin header → fall through to 403 */ }
    return res.status(403).json({
        success: false,
        code: 'BAD_ORIGIN',
        error: 'Cross-origin request blocked.',
    });
});

// JSON bodies: only the bulk credential upload needs the huge allowance —
// everything else is capped early so oversized payloads are rejected fast.
const jsonSmall = express.json({ limit: '256kb', strict: true });
const jsonBig = express.json({ limit: '25mb', strict: true });
const jsonReceipt = express.json({ limit: '6mb', strict: true });   // GCash cash-in receipts
app.use((req, res, next) => {
    if (req.path.startsWith('/api/accounts/')) return jsonBig(req, res, next);
    if (req.path === '/api/member/cashin') return jsonReceipt(req, res, next);
    return jsonSmall(req, res, next);
});

// The raw credential pools are never downloadable
app.use('/Acccounts', (req, res) => {
    res.status(403).json({
        success: false,
        error: 'Forbidden — credentials are only served through the generator.',
    });
});

// Every page needs an access key (public/login.html is the only exception)
app.use(auth.protectStaticPages);
app.use(express.static('public'));

// Brand / payment assets (the GCash cash-in QRs live in Assets/prices)
app.use('/assets', express.static(path.join(__dirname, 'Assets')));

// Member / ticket / admin APIs
mountPlatformApi(app, { counters: poolCounters, generators });

// ============ STEAM API ENDPOINTS ============

// Get random Steam account (optionally filtered by game)
app.post('/api/search-accounts', auth.requireMember, async (req, res) => {
    try {
        const { term } = req.body || {};
        const result = await searchAccounts(term);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a specific account by username (includes password)
app.get('/api/steam-account/:username', auth.requireMember, auth.generation('steam'), async (req, res) => {
    try {
        const result = await getAccountByUsername(req.params.username);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy: get first account matching a game (kept for compatibility)
app.post('/api/get-random-steam-account', auth.requireMember, auth.generation('steam'), async (req, res) => {
    try {
        const game = (req.body && req.body.game) ? req.body.game : null;
        const result = await getRandomSteamAccount(game);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Count
app.get('/api/steam-count', auth.requireMember, async (req, res) => {
    try {
        const count = await getSteamAccountCount();
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// List all accounts (admin, no passwords)
app.get('/api/steam-accounts', auth.requireAdmin, async (req, res) => {
    try {
        const accounts = await getAllSteamAccounts();
        res.json({ success: true, accounts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add account
app.post('/api/steam-accounts', auth.requireAdmin, async (req, res) => {
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
app.delete('/api/steam-accounts/:username', auth.requireAdmin, async (req, res) => {
    try {
        const result = await removeSteamAccount(req.params.username);
        res.json(result);
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============ UNIVERSAL ACCOUNT PARSER ENDPOINTS ============

/**
 * Parse raw account text and detect the format — no file writes.
 * Body: { text: "...", service?: string }
 */
app.post('/api/accounts/parse', auth.requireMember, (req, res) => {
    try {
        const { text, service } = req.body || {};
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, error: 'No text provided' });
        }

        const result = parseAccounts(text);

        if (result.count === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid accounts could be parsed from the provided text',
                format: result.format,
            });
        }

        const serviceInfo = service && SERVICE_FILES[service]
            ? { name: service, fileType: SERVICE_FILES[service].type }
            : null;

        res.json({
            success: true,
            format: result.format,
            count: result.count,
            service: serviceInfo,
            accounts: result.accounts,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Parse text, then append accounts to the target service file.
 * Body: { text: "...", service: string, overwrite?: boolean }
 */
app.post('/api/accounts/add', auth.requireAdmin, async (req, res) => {
    try {
        const { text, service } = req.body || {};
        if (!service || !SERVICE_FILES[service]) {
            return res.status(400).json({
                success: false,
                error: `Invalid or missing service. Valid: ${Object.keys(SERVICE_FILES).join(', ')}`,
            });
        }
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, error: 'No text provided' });
        }

        const parsed = parseAccounts(text);
        if (parsed.count === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid accounts detected in the provided text',
                format: parsed.format,
            });
        }

        const writeResult = await addAccountsToFile(service, parsed.accounts);

        res.json({
            success: true,
            format: parsed.format,
            service,
            added: writeResult.added,
            updated: writeResult.updated,
            duplicates: writeResult.duplicates,
            totalInPool: await getAccountCount(service),
            sample: parsed.accounts.slice(0, 5),
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get account counts for all supported services.
 */
app.get('/api/account-counts', auth.requireMember, async (req, res) => {
    try {
        const counts = {};
        for (const [svc, cfg] of Object.entries(SERVICE_FILES)) {
            counts[svc] = await getAccountCount(svc);
        }
        counts.netflix = await getNetflixAccountCount();
        counts.hbo = await getHboCookieCount();
        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ OTHER SERVICE ENDPOINTS ============

app.post('/api/get-random-crunchyroll-account', auth.requireMember, auth.generation('crunchyroll'), async (req, res) => {
    try {
        const result = await getRandomCrunchyrollAccount();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-random-hbo-cookie', auth.requireMember, auth.generation('hbo'), async (req, res) => {
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

app.post('/api/get-random-paramount-account', auth.requireMember, auth.generation('paramount'), async (req, res) => {
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

app.post('/api/get-random-disney-account', auth.requireMember, auth.generation('disney'), async (req, res) => {
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

app.post('/api/get-random-garena-account', auth.requireMember, auth.generation('garena'), async (req, res) => {
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

app.post('/api/get-random-moonton-account', auth.requireMember, auth.generation('moonton'), async (req, res) => {
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

app.post('/api/get-random-netflix-cookie', auth.requireMember, auth.generation('netflix'), async (req, res) => {
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

app.post('/api/get-random-xbox-account', auth.requireMember, auth.generation('xbox'), async (req, res) => {
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

app.post('/api/get-random-capcut-account', auth.requireMember, auth.generation('capcut'), async (req, res) => {
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

// Pool sizes are visible to signed-in members only.
// (Mounted as plain middleware: app.use('/api/test-') would be segment-bound
//  and app.use(/regex/) is mangled by path-to-regexp for group-less regexes.)
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/test-')) return next();
    return auth.requireMember(req, res, next);
});

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

// Public — the only page reachable without an access key
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Members — need a valid access key cookie (or admin session)
app.get('/', auth.requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});
app.get('/home', auth.requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});
app.get('/support', auth.requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'support.html'));
});
app.get('/guidelines', auth.requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'guidelines.html'));
});

// Staff area — dashboard + the bulk credential tools.
// NOTE: the short `/admin` alias was removed on purpose so the admin URL is
// never advertised. /admin.html stays behind the staff-key page guard, and
// /admin-login is the only public staff page.
app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});
app.get('/tools', auth.requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'intro.html'));
});

// Service pages — same guard as the .html files served from /public
const SERVICE_PAGES = [
    'netflix', 'steam', 'crunchyroll', 'hbo', 'paramount',
    'disney', 'capcut', 'xbox', 'moonton', 'garena',
];
for (const page of SERVICE_PAGES) {
    app.get(`/${page}`, auth.requireMemberPage, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', `${page}.html`));
    });
}

// ============ START SERVER ============

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎮 CRACKHUB — KEY GATED ACCOUNT GENERATOR');
    console.log('='.repeat(60));
    console.log(`🚀 Server:   http://localhost:${PORT}`);
    console.log(`🔑 Login:    http://localhost:${PORT}/login`);
    console.log(`🛍️  Store:    http://localhost:${PORT}/`);
    console.log(`🛡️  Admin:    http://localhost:${PORT}/admin.html`);
    console.log(`🧾 Support:  http://localhost:${PORT}/support`);
    console.log('='.repeat(60));
    // Print the admin key once so the operator can sign in for the first time
    // (the same value also lives in backend/data/config.json).
    config.getAdminKey()
        .then(key => console.log(`🔐 ADMIN KEY: ${key}\n`))
        .catch(err => console.error('⚠️  Could not read the admin key:', err.message));
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`❌ Port ${PORT} is busy, trying port ${PORT + 1}...`);
        app.listen(PORT + 1);
    }
});