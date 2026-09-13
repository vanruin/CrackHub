const fsp  = require('fs').promises;
const path = require('path');

// Path to the accounts file
const STEAM_JSON = path.join(__dirname, '..', 'public', 'Acccounts', 'Steam.json');

// ---------- helpers ----------
async function loadSteamAccounts() {
    try {
        const raw = await fsp.readFile(STEAM_JSON, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (parsed.accounts || []);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function saveSteamAccounts(accounts) {
    await fsp.writeFile(STEAM_JSON, JSON.stringify(accounts, null, 2), 'utf-8');
}

async function getSteamAccountCount() {
    const accounts = await loadSteamAccounts();
    return accounts.length;
}

/**
 * Normalize the `games` field of an account into an array of strings.
 * Accepts: array, comma-separated string, or undefined.
 */
function normalizeGames(games) {
    if (Array.isArray(games)) return games.map(g => String(g).trim()).filter(Boolean);
    if (typeof games === 'string') {
        return games.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Search accounts by game name (case-insensitive substring match).
 * If term is empty → returns ALL accounts.
 * Returns: { success, term, count, accounts: [{ username, games }] }
 */
async function searchAccounts(term) {
    const accounts = await loadSteamAccounts();
    const needle = String(term || '').trim().toLowerCase();

    if (!needle) {
        return {
            success: true,
            term: '',
            count: accounts.length,
            accounts: accounts.map(a => ({
                username: a.username,
                games: normalizeGames(a.games)
            }))
        };
    }

    const matches = accounts.filter(acc => {
        const games = normalizeGames(acc.games);
        return games.some(g => g.toLowerCase().includes(needle));
    });

    return {
        success: true,
        term,
        count: matches.length,
        accounts: matches.map(a => ({
            username: a.username,
            games: normalizeGames(a.games)
        }))
    };
}

/**
 * Get a single account by username (returns password too).
 * Returns: { success, data?, error? }
 */
async function getAccountByUsername(username) {
    const accounts = await loadSteamAccounts();
    const found = accounts.find(a => a.username === username);
    if (!found) {
        return { success: false, error: `Account "${username}" not found` };
    }
    return { success: true, data: found };
}

/**
 * Get a specific account that has the searched game (deterministic: first match).
 * Kept for compatibility with the old generate flow.
 */
async function getRandomSteamAccount(gameFilter = null) {
    const accounts = await loadSteamAccounts();

    if (accounts.length === 0) {
        return { success: false, error: 'No accounts available' };
    }

    if (!gameFilter || !String(gameFilter).trim()) {
        return {
            success: true,
            data: accounts[0],
            totalAccounts: accounts.length,
            accountsRemaining: accounts.length,
            filter: 'none'
        };
    }

    const needle = String(gameFilter).trim().toLowerCase();
    const matches = accounts.filter(acc => {
        const games = normalizeGames(acc.games);
        return games.some(g => g.toLowerCase().includes(needle));
    });

    if (matches.length === 0) {
        return {
            success: false,
            error: `No accounts found with "${gameFilter}"`,
            totalAccounts: accounts.length,
            accountsRemaining: 0,
            filter: gameFilter
        };
    }

    return {
        success: true,
        data: matches[0],
        totalAccounts: accounts.length,
        accountsRemaining: matches.length,
        filter: gameFilter
    };
}

async function addSteamAccount(username, password, games = [], status = 'active') {
    if (!username || !password) {
        return { success: false, error: 'username and password required' };
    }

    const accounts = await loadSteamAccounts();

    if (accounts.some(a => a.username === username)) {
        return { success: false, error: 'Account already exists' };
    }

    const gamesArr = normalizeGames(games);
    accounts.push({ username, password, games: gamesArr, status });
    await saveSteamAccounts(accounts);

    return { success: true, message: `Added ${username}`, total: accounts.length };
}

async function removeSteamAccount(username) {
    const accounts = await loadSteamAccounts();
    const before = accounts.length;
    const filtered = accounts.filter(a => a.username !== username);

    if (filtered.length === before) {
        return { success: false, error: `Account "${username}" not found` };
    }

    await saveSteamAccounts(filtered);
    return { success: true, message: `Removed ${username}`, total: filtered.length };
}

async function getAllAccounts() {
    const accounts = await loadSteamAccounts();
    return accounts.map(({ username, games, status }) => ({
        username,
        games: normalizeGames(games),
        status: status || 'active'
    }));
}

// ---------- exports ----------
module.exports = {
    loadSteamAccounts,
    getSteamAccountCount,
    searchAccounts,
    getAccountByUsername,
    getRandomSteamAccount,
    addSteamAccount,
    removeSteamAccount,
    getAllAccounts
};