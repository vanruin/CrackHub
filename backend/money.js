/**
 * Money + history helpers shared by members, tickets and subscriptions.
 * Amounts are stored as numbers rounded to whole centavos, never negative.
 */

const HISTORY_LIMIT = 200;

function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

/** Usage history (last N entries), kept small. */
function trimHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(-HISTORY_LIMIT);
}

module.exports = { money, trimHistory };
