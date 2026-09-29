/**
 * Price list (in PHP) per successful generation.
 * Defaults come from catalog.js, overrides live in backend/data/pricing.json.
 */

const store = require('./store');
const { CATALOG, DEFAULT_PRICES, getservice } = require('./catalog');

const STORE_NAME = 'pricing';

const HISTORY_LIMIT = 200;

function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

async function getPricing() {
    const stored = (await store.read(STORE_NAME, null)) || {};
    const merged = { ...DEFAULT_PRICES };
    for (const svc of CATALOG) {
        if (stored[svc.key] !== undefined) merged[svc.key] = money(stored[svc.key]);
    }
    return merged;
}

async function getPrice(service) {
    if (!getservice(service)) return null;
    const prices = await getPricing();
    return prices[String(service).toLowerCase()] ?? 0;
}

async function setPrice(service, price) {
    if (!getservice(service)) throw new Error(`Unknown service: ${service}`);
    const stored = (await store.read(STORE_NAME, null)) || {};
    stored[String(service).toLowerCase()] = money(price);
    await store.write(STORE_NAME, stored);
    return getPricing();
}

async function setPrices(map = {}) {
    const stored = (await store.read(STORE_NAME, null)) || {};
    for (const [service, price] of Object.entries(map)) {
        if (!getservice(service)) continue;
        stored[String(service).toLowerCase()] = money(price);
    }
    await store.write(STORE_NAME, stored);
    return getPricing();
}

/** Full catalog + price + live pool size, ready for the storefront. */
async function getCatalog(poolCounter) {
    const prices = await getPricing();
    return Promise.all(CATALOG.map(async svc => ({
        key: svc.key,
        label: svc.label,
        emoji: svc.emoji,
        color: svc.color,
        path: svc.path,
        credential: svc.credential,
        price: prices[svc.key] ?? svc.defaultPrice,
        available: poolCounter ? await poolCounter(svc.key) : 0,
    })));
}

/** Charged usage history per service (last N entries), kept small. */
function trimHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(-HISTORY_LIMIT);
}

module.exports = { getPricing, getPrice, setPrice, setPrices, getCatalog, money, trimHistory };
