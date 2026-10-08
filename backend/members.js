/**
 * Members — the paid users of the site.
 * A member is identified by an access KEY (issued by the admin) and spends
 * a peso balance; every successful generation is debited from that balance.
 *
 * Stored in backend/data/members.json as { members: [...] }
 */

const crypto = require('crypto');
const store = require('./store');
const { money, trimHistory } = require('./money');

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

function publicView(member) {
    if (!member) return null;
    return {
        id: member.id,
        name: member.name,
        key: member.key,
        balance: money2(member.balance),
        status: member.status || 'active',
        note: member.note || '',
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
 * Record a delivered account: usage history + generation stats.
 * The service's current price is debited from the member's balance —
 * a 402 (INSUFFICIENT_FUNDS) is thrown when the balance cannot cover it.
 */
async function recordGeneration(id, { service, price = 0, login = '', label = '', meta = {} } = {}) {
    const charge = money2(price);

    return mutate(async members => {
        const member = members.find(m => m.id === id);
        if (!member) throw new Error('Member not found');

        if (charge > 0) {
            // raw arithmetic first — money() clamps negatives to 0, which would
            // hide an insufficient balance instead of rejecting it.
            const before = Number(member.balance) || 0;
            const after = Math.round((before - charge) * 100) / 100;
            if (after < 0) {
                const err = new Error(`Not enough balance — this costs ₱${charge} but you have ₱${money2(before)}. Cash in first.`);
                err.code = 'INSUFFICIENT_FUNDS';
                err.status = 402;
                throw err;
            }
            member.balance = money2(after);
            member.totalSpent = money2(money2(member.totalSpent) + charge);
            pushTx(member, {
                type: 'debit',
                amount: charge,
                balanceAfter: money2(after),
                note: `Generation — ${service}`,
                by: 'member',
            });
        }

        member.totalGenerated = (member.totalGenerated || 0) + 1;
        member.generationsByService = member.generationsByService || {};
        member.generationsByService[service] = (member.generationsByService[service] || 0) + 1;

        member.updatedAt = nowIso();
        recordUsage(member, { service, price: charge, login, label, meta });

        const last = member.usage[member.usage.length - 1] || {};
        return { recorded: charge, balance: money2(member.balance), usageId: last.id || null };
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
    recordGeneration,
    getUsage,
    getTransactions,
    markUsageTicketed,
    findUsageByTicket,
};



