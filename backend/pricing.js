/**
 * Per-service pricing — backend/data/pricing.json
 *
 * The admin edits these from the Pricing tab of the dashboard; members see
 * the current price on every store card and each generation is charged at
 * the price that is live when the account is delivered.
 *
 * Stored as { updatedAt, prices: { netflix: 10, steam: 10, ... } }.
 * Missing entries fall back to DEFAULT_PRICE, unknown services are rejected.
 */

const store = require('./store');
const { money } = require('./money');
const { CATALOG } = require('./catalog');

const STORE_NAME = 'pricing';
const DEFAULT_PRICE = 10;   // peso, used until the admin sets a real price
const MAX_PRICE = 100000;

/** Validation failure → HTTP 400 instead of a generic 500. */
function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function defaults() {
    return CATALOG.reduce((acc, svc) => {
        acc[svc.key] = DEFAULT_PRICE;
        return acc;
    }, {});
}

/** Full price map for every catalog service (merged over the defaults). */
async function getAll() {
    const data = await store.read(STORE_NAME, null);
    const stored = data && typeof data.prices === 'object' && data.prices ? data.prices : {};
    const prices = defaults();
    for (const svc of CATALOG) {
        const value = Number(stored[svc.key]);
        if (Number.isFinite(value) && value >= 0) prices[svc.key] = money(value);
    }
    return prices;
}

/** Price of one service — 0 for anything outside the catalog. */
async function priceFor(key) {
    const prices = await getAll();
    const value = prices[String(key || '').toLowerCase()];
    return Number.isFinite(value) ? value : 0;
}

/** Admin edit — patch = { netflix: 15, steam: 5, ... }. Returns the new map. */
async function setPrices(patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw badRequest('No prices provided');
    }
    const known = new Set(CATALOG.map(s => s.key));
    const unknown = Object.keys(patch).filter(k => !known.has(k));
    if (unknown.length) throw badRequest(`Unknown service: ${unknown.join(', ')}`);

    return store.withLock(STORE_NAME, async () => {
        const prices = await getAll();
        for (const [key, raw] of Object.entries(patch)) {
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0) throw badRequest(`Invalid price for ${key}`);
            if (value > MAX_PRICE) throw badRequest(`Price for ${key} is too high (max ₱${MAX_PRICE})`);
            prices[key] = money(value);
        }
        await store.writeAtomic(STORE_NAME, { updatedAt: new Date().toISOString(), prices });
        return prices;
    });
}

/** Editor rows for the admin Pricing tab. */
async function list() {
    const prices = await getAll();
    return CATALOG.map(svc => ({
        key: svc.key,
        label: svc.label,
        emoji: svc.emoji,
        price: prices[svc.key],
    }));
}

module.exports = { DEFAULT_PRICE, MAX_PRICE, getAll, priceFor, setPrices, list };