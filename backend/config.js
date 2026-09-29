/**
 * Runtime configuration — backend/data/config.json
 * Holds the admin key and the HMAC secret used to sign session cookies.
 * Both can be supplied through environment variables instead:
 *   CRACKHUB_ADMIN_KEY=...  CRACKHUB_SECRET=...
 */

const crypto = require('crypto');
const store = require('./store');

const STORE_NAME = 'config';

let cache = null;

function buildAdminKey() {
    const block = () => crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ADMIN-${block()}-${block()}`;
}

async function load() {
    if (cache) return cache;

    let data = await store.read(STORE_NAME, null);
    let created = false;

    if (!data || typeof data !== 'object') {
        data = {};
        created = true;
    }

    if (!data.adminKey) {
        data.adminKey = process.env.CRACKHUB_ADMIN_KEY || buildAdminKey();
        created = true;
    }
    if (!data.secret) {
        data.secret = process.env.CRACKHUB_SECRET || crypto.randomBytes(32).toString('hex');
        created = true;
    }
    if (!data.currency) {
        data.currency = '₱';
        created = true;
    }
    if (!data.siteName) {
        data.siteName = 'CrackHub';
        created = true;
    }

    if (created) await store.write(STORE_NAME, data);
    cache = data;
    return data;
}

async function getAdminKey() {
    return (await load()).adminKey;
}

async function getSecret() {
    return (await load()).secret;
}

async function rotateAdminKey(newKey) {
    const data = await load();
    data.adminKey = (newKey && String(newKey).trim()) || buildAdminKey();
    await store.write(STORE_NAME, data);
    return data.adminKey;
}

module.exports = { load, getAdminKey, getSecret, rotateAdminKey, buildAdminKey };
