/**
 * Members — the paid users of the site.
 * A member is identified by an access KEY (issued by the admin) and spends
 * a peso balance; every successful generation is debited from that balance.
 *
 * Stored in backend/data/members.json as { members: [...] }
 */

const crypto = require('crypto');
const store = require('./store');
const { money, trimHistory } = require('./pricing');

const STORE_NAME = 'members';
const TX_LIMIT = 300;

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

// ---------------------------------------------------------------- helpers

function normalizeKey(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function generateKey() {
    const group = () => Array.from({ length: 4 }, () =>
        KEY_ALPHABET[crypto.randomInt(0, KEY_ALPHABET.length)]).join('');
    return `CH-${group()}-${group()}-${group()}`;
}

function nowIso() {
    return new Date().toISOString();
}

function money2(value) {
    return money(value);
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.members) ? data.members : [];
}

async function saveAll(members) {
    // inside the members lock — a locked write() would deadlock here
    await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), members });
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const members = await loadAll();
        const result = await task(members);
        await saveAll(members);
        return result;
    });
}

function pushTx(member, tx) {
    member.transactions = Array.isArray(member.transactions) ? member.transactions : [];
    member.transactions.push({ id: store.newId('TX'), at: nowIso(), ...tx });
    member.transactions = member.transactions.slice(-TX_LIMIT);
}

/** Normalised subscription view — never trusts a stale stored status. */
function subscriptionView(member) {
    const sub = member && member.subscription;
    if (!sub || !sub.expiresAt) {
        return { status: 'none', plan: null, planLabel: '', amount: 0, startedAt: null, expiresAt: null, daysLeft: 0 };
    }
    const expires = new Date(sub.expiresAt).getTime();
    const active = Number.isFinite(expires) && expires > Date.now();
    return {
        status: active ? 'active' : 'expired',
        plan: sub.plan || 'monthly',
        planLabel: sub.planLabel || '',
        amount: money2(sub.amount),
        startedAt: sub.startedAt || null,
        expiresAt: sub.expiresAt || null,
        daysLeft: active ? Math.ceil((expires - Date.now()) / 86400000) : 0,
    };
}

function publicView(member) {
    if (!member) return null;
    return {
        id: member.id,
        name: member.name,
        key: member.key,
        balance: money2(member.balance),
        status: member.status || 'active',
        note: member.note || '',
        subscription: subscriptionView(member),
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        lastUsedAt: member.lastUsedAt || null,
        totalSpent: money2(member.totalSpent),
        totalGenerated: member.totalGenerated || 0,
        generationsByService: member.generationsByService || {},
    };
}

function adminView(member) {
    return {
        ...publicView(member),
        transactions: (member.transactions || []).slice(-40).reverse(),
        usage: trimHistory(member.usage).slice(-15).reverse(),
    };
}


// ---------------------------------------------------------------- queries

async function listMembers({ query = '' } = {}) {
    const members = await loadAll();
    const needle = String(query || '').trim().toLowerCase();
    const filtered = needle
        ? members.filter(m =>
            String(m.name).toLowerCase().includes(needle) ||
            String(m.key).toLowerCase().includes(needle))
        : members;
    return filtered
        .map(adminView)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getMember(id) {
    const members = await loadAll();
    return members.find(m => m.id === id) || null;
}

async function findByKey(rawKey) {
    const key = normalizeKey(rawKey);
    if (!key) return null;
    const members = await loadAll();
    return members.find(m => normalizeKey(m.key) === key) || null;
}

async function keyExists(key) {
    return !!(await findByKey(key));
}

async function stats() {
    const members = await loadAll();
    return {
        members: members.length,
        active: members.filter(m => (m.status || 'active') === 'active').length,
        disabled: members.filter(m => m.status === 'disabled').length,
        balanceOutstanding: money2(members.reduce((sum, m) => sum + money2(m.balance), 0)),
        totalSpent: money2(members.reduce((sum, m) => sum + money2(m.totalSpent), 0)),
        totalGenerated: members.reduce((sum, m) => sum + (m.totalGenerated || 0), 0),
    };
}

// ---------------------------------------------------------------- mutations

async function createMember({ name, key, balance = 0, note = '', status = 'active' } = {}) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Member name is required');
    if (cleanName.length > 60) throw new Error('Member name is too long (max 60 chars)');

    const wantedKey = key ? normalizeKey(key) : generateKey();
    if (!/^[A-Z0-9-]{6,40}$/.test(wantedKey)) {
        throw new Error('Custom key must be 6-40 characters (letters, numbers, dashes)');
    }

    return mutate(async members => {
        if (members.some(m => normalizeKey(m.key) === wantedKey)) {
            throw new Error(`Key ${wantedKey} is already taken`);
        }

        const member = {
            id: store.newId('MBR'),
            name: cleanName,
            key: wantedKey,
            balance: money2(balance),
            status: status === 'disabled' ? 'disabled' : 'active',
            note: String(note || '').trim().slice(0, 300),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            lastUsedAt: null,
            totalSpent: 0,
            totalGenerated: 0,
            generationsByService: {},
            subscription: null,
            transactions: [],
            usage: [],
        };

        pushTx(member, {
            type: 'credit',
            amount: member.balance,
            balanceAfter: member.balance,
            note: 'Initial balance (member created)',
            by: 'admin',
        });

        members.push(member);
        return adminView(member);
    });
}

async function updateMember(id, patch = {}) {
    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        if (patch.name !== undefined) {
            const cleanName = String(patch.name).trim();
            if (!cleanName) throw new Error('Member name cannot be empty');
            member.name = cleanName.slice(0, 60);
        }
        if (patch.note !== undefined) member.note = String(patch.note).slice(0, 300);
        if (patch.status !== undefined) {
            if (!['active', 'disabled'].includes(patch.status)) throw new Error('Invalid status');
            member.status = patch.status;
        }
        if (patch.key !== undefined && normalizeKey(patch.key) !== member.key) {
            const wanted = normalizeKey(patch.key);
            if (!/^[A-Z0-9-]{6,40}$/.test(wanted)) {
                throw new Error('Custom key must be 6-40 characters (letters, numbers, dashes)');
            }
            if (members.some(m => m.id !== id && normalizeKey(m.key) === wanted)) {
                throw new Error(`Key ${wanted} is already taken`);
            }
            member.key = wanted;
        }
        member.updatedAt = nowIso();
        return adminView(member);
    });
}

async function rotateKey(id) {
    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');
        let candidate = generateKey();
        while (members.some(m => normalizeKey(m.key) === candidate)) candidate = generateKey();
        member.key = candidate;
        member.updatedAt = nowIso();
        return adminView(member);
    });
}

async function deleteMember(id) {
    return mutate(async members => {
        const index = members.findIndex(m => m.id === id);
        if (index === -1) throw new Error('Member not found');
        const [removed] = members.splice(index, 1);
        return { id: removed.id, name: removed.name, key: removed.key };
    });
}

/**
 * Admin top-up / adjustment. `action` = "add" | "subtract" | "set".
 */
async function adjustBalance(id, { action = 'add', amount = 0, note = '', by = 'admin' } = {}) {
    const value = money2(amount);
    if (!Number.isFinite(value)) throw new Error('Invalid amount');
    if (value === 0 && action !== 'set') throw new Error('Amount must be greater than 0');

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        const before = money2(member.balance);
        let after = before;
        if (action === 'add') after = money2(before + Math.abs(value));
        else if (action === 'subtract') after = money2(before - Math.abs(value));
        else if (action === 'set') after = money2(value);
        else throw new Error(`Unknown balance action: ${action}`);

        if (after < 0) throw new Error(`Balance cannot go below 0 (current balance: ${before})`);

        member.balance = after;
        member.updatedAt = nowIso();

        const delta = money2(after - before);
        pushTx(member, {
            type: delta >= 0 ? 'credit' : 'debit',
            amount: money2(Math.abs(delta)),
            balanceAfter: after,
            note: String(note || (delta >= 0 ? 'Balance added by admin' : 'Balance removed by admin')).slice(0, 200),
            by,
        });

        return adminView(member);
    });
}

/** Refund a charge — used when a reported account really was dead. */
async function refund(id, { amount, note = '', by = 'admin' } = {}) {
    const value = money2(amount);
    if (value <= 0) throw new Error('Refund amount must be greater than 0');

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');
        const after = money2(money2(member.balance) + value);
        member.balance = after;
        member.totalSpent = money2(Math.max(0, money2(member.totalSpent) - value));
        member.updatedAt = nowIso();
        pushTx(member, {
            type: 'refund',
            amount: value,
            balanceAfter: after,
            note: String(note || 'Refund — account did not work').slice(0, 200),
            by,
        });
        return adminView(member);
    });
}

function recordUsage(member, { service, price, login, label, meta }) {
    member.usage = Array.isArray(member.usage) ? member.usage : [];
    member.usage.push({
        id: store.newId('GEN'),
        service,
        price: money2(price),
        login: String(login || '').slice(0, 160),
        label: String(label || '').slice(0, 160),
        ticketId: null,
        meta: meta && typeof meta === 'object' ? meta : {},
        at: nowIso(),
    });
    member.usage = trimHistory(member.usage);
    member.lastUsedAt = nowIso();
}

/**
 * Debit a successful generation. Throws `code = 'INSUFFICIENT_FUNDS'`
 * (status 402) when the member cannot pay.
 */
async function charge(id, { service, price = 0, login = '', label = '', meta = {} } = {}) {
    const cost = money2(price);

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        if (cost > 0) {
            const before = money2(member.balance);
            if (before < cost) {
                const err = new Error(`Insufficient balance — ₱${cost} required, your balance is ₱${before}. Add balance to continue.`);
                err.code = 'INSUFFICIENT_FUNDS';
                err.status = 402;
                throw err;
            }
            member.balance = money2(before - cost);
            member.totalSpent = money2(money2(member.totalSpent) + cost);
            member.totalGenerated = (member.totalGenerated || 0) + 1;
            member.generationsByService = member.generationsByService || {};
            member.generationsByService[service] = (member.generationsByService[service] || 0) + 1;
        }

        member.updatedAt = nowIso();
        recordUsage(member, { service, price: cost, login, label, meta });

        if (cost > 0) {
            pushTx(member, {
                type: 'debit',
                amount: cost,
                balanceAfter: money2(member.balance),
                note: `${service} generation${login ? ` — ${login}` : ''}`,
                by: 'system',
            });
        }

        const last = member.usage[member.usage.length - 1] || {};
        return { charged: cost, balance: money2(member.balance), usageId: last.id || null };
    });
}

/**
 * Debit a generation BEFORE the generator runs (race-safe balance gate).
 * Runs inside the store lock, so two parallel requests can never spend past
 * the balance. Only the transaction is written here — the usage entry is
 * added by recordGeneration() once an account was actually delivered, and
 * refund() reverses the debit when generation fails.
 */
async function debit(id, { service, price = 0, note = '' } = {}) {
    const cost = money2(price);

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        if (cost > 0) {
            const before = money2(member.balance);
            if (before < cost) {
                const err = new Error(`Insufficient balance — ₱${cost} required, your balance is ₱${before}. Add balance to continue.`);
                err.code = 'INSUFFICIENT_FUNDS';
                err.status = 402;
                throw err;
            }
            member.balance = money2(before - cost);
            member.totalSpent = money2(money2(member.totalSpent) + cost);
            pushTx(member, {
                type: 'debit',
                amount: cost,
                balanceAfter: money2(member.balance),
                note: String(note || `${service} generation`).slice(0, 200),
                by: 'system',
            });
        }

        member.updatedAt = nowIso();
        return { charged: cost, balance: money2(member.balance) };
    });
}

/**
 * Settle a debit() taken by billable(): record the delivered account in the
 * usage history and count it against the member's generation stats.
 */
async function recordGeneration(id, { service, price = 0, login = '', label = '', meta = {} } = {}) {
    const cost = money2(price);

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        if (cost > 0) {
            member.totalGenerated = (member.totalGenerated || 0) + 1;
            member.generationsByService = member.generationsByService || {};
            member.generationsByService[service] = (member.generationsByService[service] || 0) + 1;
        }

        member.updatedAt = nowIso();
        recordUsage(member, { service, price: cost, login, label, meta });

        const last = member.usage[member.usage.length - 1] || {};
        return { recorded: cost, balance: money2(member.balance), usageId: last.id || null };
    });
}

async function getUsage(id) {
    const member = await getMember(id);
    if (!member) return [];
    return trimHistory(member.usage).slice().reverse();
}

async function getTransactions(id) {
    const member = await getMember(id);
    if (!member) return [];
    return (member.transactions || []).slice().reverse();
}

/** Flag a usage entry as ticketed so the same account is not reported twice. */
async function markUsageTicketed(memberId, usageId, ticketId) {
    return mutate(async members => {
        const member = members.find(m => m.id === memberId);
        if (!member) return null;
        const entry = (member.usage || []).find(u => u.id === usageId);
        if (!entry) return null;
        entry.ticketId = ticketId;
        return { usageId, ticketId };
    });
}

async function findUsageByTicket(memberId, usageId) {
    const member = await getMember(memberId);
    if (!member) return null;
    return (member.usage || []).find(u => u.id === usageId) || null;
}

/**
 * Activate or extend a member's subscription. Renewing early extends from the
 * later of "now" and the current expiry, so paid days are never lost.
 */
async function activateSubscription(id, { days = 30, amount = 0, plan = 'monthly', planLabel = '', note = '', by = 'admin' } = {}) {
    const span = Math.max(1, Math.floor(Number(days) || 30));

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        const now = Date.now();
        const currentExpiry = member.subscription && member.subscription.expiresAt
            ? new Date(member.subscription.expiresAt).getTime()
            : 0;
        const extending = Number.isFinite(currentExpiry) && currentExpiry > now;
        const base = extending ? currentExpiry : now;

        member.subscription = {
            plan,
            planLabel: String(planLabel || '').slice(0, 40),
            amount: money2(amount),
            startedAt: extending && member.subscription.startedAt ? member.subscription.startedAt : nowIso(),
            expiresAt: new Date(base + span * 86400000).toISOString(),
            updatedAt: nowIso(),
        };
        member.updatedAt = nowIso();

        pushTx(member, {
            type: 'subscription',
            amount: money2(amount),
            balanceAfter: money2(member.balance),
            note: String(note || `Subscription activated — ${span} day(s)`).slice(0, 200),
            by,
        });

        return publicView(member);
    });
}

module.exports = {
    generateKey,
    normalizeKey,
    publicView,
    adminView,
    listMembers,
    getMember,
    findByKey,
    keyExists,
    stats,
    createMember,
    updateMember,
    rotateKey,
    deleteMember,
    adjustBalance,
    refund,
    charge,
    debit,
    recordGeneration,
    getUsage,
    getTransactions,
    markUsageTicketed,
    findUsageByTicket,
    activateSubscription,
};



