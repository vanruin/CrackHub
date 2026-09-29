/**
 * Account pool helpers — read the raw credential pools so the admin can see
 * what is inside and so a ticket can be answered with a fresh account.
 */

const fs = require('fs').promises;
const path = require('path');

const { getservice } = require('./catalog');

const ACCOUNTS_DIR = path.join(__dirname, '..', 'public', 'Acccounts');

function poolPath(service) {
    const svc = getservice(service);
    if (!svc) throw new Error(`Unknown service: ${service}`);
    return path.join(ACCOUNTS_DIR, svc.file);
}

function cleanLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
}

function splitEmailPass(line) {
    const head = String(line).split('|')[0].trim();
    const idx = head.search(/[:;\t ]/);
    if (idx === -1) return { account: head, password: '' };
    return { account: head.slice(0, idx).trim(), password: head.slice(idx + 1).trim() };
}

function maskCookie(cookie) {
    const str = String(cookie || '');
    return str.length > 60 ? `${str.slice(0, 40)}…(${str.length} chars)` : str;
}

/**
 * Normalized listing of a pool: [{ account, password, preview }]
 * Passwords are only shown to the admin panel.
 */
async function listPool(service, { limit = 500 } = {}) {
    const svc = getservice(service);
    if (!svc) throw new Error(`Unknown service: ${service}`);

    let raw;
    try {
        raw = await fs.readFile(poolPath(svc.key), 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }

    if (svc.type === 'json') {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            return [];
        }
        const records = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
        return records.slice(0, limit).map((rec, index) => ({
            index,
            account: String(rec.email || rec.username || `record #${index + 1}`),
            password: String(rec.password || ''),
            preview: rec.cookie
                ? maskCookie(rec.cookie)
                : (Array.isArray(rec.games) ? rec.games.slice(0, 4).join(', ') : ''),
        }));
    }

    // hbo stores cookie sets instead of email:pass lines
    if (svc.key === 'hbo') {
        const blocks = String(raw)
            .split(/\n\s*\n/)
            .map(b => b.trim())
            .filter(b => b.length > 10);
        return blocks.slice(0, limit).map((block, index) => ({
            index,
            account: `cookie set #${index + 1}`,
            password: '',
            preview: maskCookie(block.replace(/\s+/g, ' ')),
        }));
    }

    return cleanLines(raw).slice(0, limit).map((line, index) => {
        const { account, password } = splitEmailPass(line);
        return { index, account, password, preview: line.length > 80 ? `${line.slice(0, 80)}…` : line };
    });
}

/** Random pool entry that is NOT the reported one (raw pools only). */
async function pickFromPool(service, excludeAccount = '') {
    const entries = await listPool(service, { limit: 5000 });
    if (!entries.length) throw new Error(`The ${service} pool is empty — add accounts first`);

    const needle = String(excludeAccount || '').trim().toLowerCase();
    const candidates = entries.filter(e => {
        const acc = String(e.account).toLowerCase();
        if (!needle) return true;
        if (acc === needle) return false;
        // hbo cookie sets have synthetic names — the reported one is matched loosely
        return !needle.includes('@') || acc !== needle;
    });

    const pool = candidates.length ? candidates : entries;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    return { account: chosen.account, password: chosen.password, note: chosen.preview, source: 'auto' };
}

/**
 * Build a replacement account for a ticket.
 * Validated services (Netflix) go through their live generator so the member
 * never receives a dead cookie again; raw pools just pick another entry.
 */
async function buildReplacement(service, excludeAccount = '', generators = {}) {
    const svc = getservice(service);
    if (!svc) throw new Error(`Unknown service: ${service}`);

    const generate = generators[svc.key];
    if (svc.validated && typeof generate === 'function') {
        const result = await generate();
        const data = (result && result.data) || {};
        return {
            account: String(data.email || data.username || 'issued session'),
            password: String(data.password || ''),
            note: data.loginUrl ? `Login link: ${data.loginUrl}` : (data.country ? `Country: ${data.country}` : ''),
            extra: {
                loginUrl: data.loginUrl || null,
                token: data.token || null,
                country: data.country || null,
                cookieString: data.cookieString || null,
            },
            source: 'auto',
        };
    }

    const picked = await pickFromPool(svc.key, excludeAccount);
    return { ...picked, extra: {} };
}

/** Pool size per service, using the same loaders the generators use. */
function poolCounter(counters) {
    return async function count(service) {
        const fn = counters[String(service).toLowerCase()];
        if (typeof fn === 'function') {
            try {
                return await fn();
            } catch (err) {
                return 0;
            }
        }
        return 0;
    };
}

module.exports = { listPool, pickFromPool, buildReplacement, poolCounter, splitEmailPass };
