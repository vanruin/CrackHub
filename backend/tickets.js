/**
 * Support tickets — a member reports an account that does not work, the admin
 * replies and/or replaces it with a fresh one (optionally refunding the charge).
 *
 * Stored in backend/data/tickets.json as { tickets: [...] }
 */

const store = require('./store');
const { money } = require('./money');

const STORE_NAME = 'tickets';
const MESSAGE_LIMIT = 50;

const STATUSES = ['open', 'in_review', 'replaced', 'rejected', 'closed'];
const OPEN_STATES = ['open', 'in_review'];

function nowIso() {
    return new Date().toISOString();
}

function ticketId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `TCK-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.tickets) ? data.tickets : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const tickets = await loadAll();
        const result = await task(tickets);
        // inside the tickets lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), tickets });
        return result;
    });
}

function pushMessage(ticket, from, text) {
    ticket.messages = Array.isArray(ticket.messages) ? ticket.messages : [];
    ticket.messages.push({ id: store.newId('MSG'), from, text: String(text).trim().slice(0, 1000), at: nowIso() });
    ticket.messages = ticket.messages.slice(-MESSAGE_LIMIT);
}

function summary(ticket) {
    return {
        id: ticket.id,
        memberId: ticket.memberId,
        memberName: ticket.memberName,
        memberKey: ticket.memberKey,
        service: ticket.service,
        serviceLabel: ticket.serviceLabel,
        account: ticket.account,
        usageId: ticket.usageId || null,
        charged: money(ticket.charged),
        reason: ticket.reason,
        status: ticket.status,
        refunded: !!ticket.refunded,
        refundAmount: money(ticket.refundAmount),
        replacement: ticket.replacement || null,
        adminNote: ticket.adminNote || '',
        messages: (ticket.messages || []).slice(-MESSAGE_LIMIT),
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt || null,
    };
}

// ---------------------------------------------------------------- queries

async function listTickets({ status = '', memberId = '', query = '' } = {}) {
    let tickets = await loadAll();

    if (status === 'open') tickets = tickets.filter(t => OPEN_STATES.includes(t.status));
    else if (status && status !== 'all') tickets = tickets.filter(t => t.status === status);
    if (memberId) tickets = tickets.filter(t => t.memberId === memberId);

    const needle = String(query || '').trim().toLowerCase();
    if (needle) {
        tickets = tickets.filter(t =>
            String(t.id).toLowerCase().includes(needle) ||
            String(t.account).toLowerCase().includes(needle) ||
            String(t.memberName).toLowerCase().includes(needle) ||
            String(t.memberKey).toLowerCase().includes(needle) ||
            String(t.service).toLowerCase().includes(needle));
    }

    return tickets
        .map(summary)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getTicket(id) {
    const tickets = await loadAll();
    const found = tickets.find(t => t.id === id);
    return found ? summary(found) : null;
}

async function getTicketForMember(id, memberId) {
    const ticket = await getTicket(id);
    if (!ticket || ticket.memberId !== memberId) return null;
    return ticket;
}

async function counts() {
    const tickets = await loadAll();
    return {
        total: tickets.length,
        open: tickets.filter(t => OPEN_STATES.includes(t.status)).length,
        replaced: tickets.filter(t => t.status === 'replaced').length,
        closed: tickets.filter(t => ['rejected', 'closed'].includes(t.status)).length,
    };
}

// ---------------------------------------------------------------- mutations

async function createTicket({ member, service, serviceLabel, account, reason, usageId = null, charged = 0 }) {
    const cleanAccount = String(account || '').trim().slice(0, 200);
    const cleanReason = String(reason || '').trim();

    if (!cleanAccount) throw new Error('The account (email / username) that failed is required');
    if (cleanReason.length < 5) throw new Error('Please describe the problem (at least 5 characters)');

    return mutate(async tickets => {
        // do not let the same account be reported over and over
        const duplicate = tickets.find(t =>
            t.memberId === member.id &&
            t.service === service &&
            String(t.account).toLowerCase() === cleanAccount.toLowerCase() &&
            OPEN_STATES.includes(t.status));
        if (duplicate) {
            const err = new Error(`You already reported this account in ticket ${duplicate.id} — please wait for the admin`);
            err.status = 409;
            throw err;
        }

        const ticket = {
            id: ticketId(),
            memberId: member.id,
            memberName: member.name,
            memberKey: member.key,
            service,
            serviceLabel: serviceLabel || service,
            account: cleanAccount,
            usageId,
            charged: money(charged),
            reason: cleanReason.slice(0, 1000),
            status: 'open',
            refunded: false,
            refundAmount: 0,
            replacement: null,
            adminNote: '',
            messages: [],
            createdAt: nowIso(),
            updatedAt: nowIso(),
            resolvedAt: null,
        };

        pushMessage(ticket, 'member', cleanReason.slice(0, 1000));
        tickets.push(ticket);
        return summary(ticket);
    });
}

async function setStatus(id, status, { note = '' } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status. Use: ${STATUSES.join(', ')}`);
    return mutate(async tickets => {
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) throw new Error('Ticket not found');
        ticket.status = status;
        ticket.updatedAt = nowIso();
        ticket.resolvedAt = OPEN_STATES.includes(status) ? null : (ticket.resolvedAt || nowIso());
        if (note) {
            ticket.adminNote = String(note).slice(0, 1000);
            pushMessage(ticket, 'admin', note);
        }
        return summary(ticket);
    });
}

/** Post a message. `from` = 'admin' | 'member'. */
async function reply(id, { from = 'member', text, status } = {}) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('Message cannot be empty');

    return mutate(async tickets => {
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) throw new Error('Ticket not found');
        pushMessage(ticket, from, clean);
        ticket.updatedAt = nowIso();
        if (from === 'member' && ticket.status === 'closed') ticket.status = 'open';
        if (status && STATUSES.includes(status)) {
            ticket.status = status;
            ticket.resolvedAt = OPEN_STATES.includes(status) ? null : (ticket.resolvedAt || nowIso());
        }
        return summary(ticket);
    });
}

/**
 * Store the replacement account on the ticket.
 * `replacement` = { account, password, note, extra, source: 'auto' | 'manual' }
 */
async function applyReplacement(id, { replacement, note = '', refundAmount = 0 }) {
    const account = String((replacement && replacement.account) || '').trim();
    if (!account) throw new Error('A replacement account is required');

    return mutate(async tickets => {
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) throw new Error('Ticket not found');

        ticket.replacement = {
            account,
            password: String(replacement.password || '').slice(0, 200),
            note: String(replacement.note || '').slice(0, 500),
            source: replacement.source === 'manual' ? 'manual' : 'auto',
            extra: replacement.extra && typeof replacement.extra === 'object' ? replacement.extra : {},
            at: nowIso(),
        };
        ticket.status = 'replaced';
        ticket.resolvedAt = nowIso();
        ticket.updatedAt = nowIso();

        if (note) {
            ticket.adminNote = String(note).slice(0, 1000);
            pushMessage(ticket, 'admin', note);
        } else {
            pushMessage(ticket, 'admin', `Replacement account issued: ${account}`);
        }
        if (Number(refundAmount) > 0) ticket.refundAmount = money(refundAmount);
        return summary(ticket);
    });
}

async function markRefunded(id, amount) {
    return mutate(async tickets => {
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) throw new Error('Ticket not found');
        ticket.refunded = true;
        ticket.refundAmount = money(amount);
        ticket.updatedAt = nowIso();
        pushMessage(ticket, 'admin', `Refunded ₱${money(amount)} to the member balance.`);
        return summary(ticket);
    });
}

module.exports = {
    STATUSES,
    OPEN_STATES,
    listTickets,
    getTicket,
    getTicketForMember,
    counts,
    createTicket,
    setStatus,
    reply,
    applyReplacement,
    markRefunded,
};

