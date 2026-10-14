/**
 * Inquiries — what a member sends from the "Inquire" button on a showcase
 * slide. The admin reads them in the Inquiries tab, replies and closes them.
 *
 * Stored in backend/data/inquiries.json as { inquiries: [...] }
 */

const store = require('./store');

const STORE_NAME = 'inquiries';
const MESSAGE_LIMIT = 1000;
const HISTORY_LIMIT = 500;

const STATUSES = ['new', 'replied', 'closed'];
const OPEN_STATES = ['new', 'replied'];

function nowIso() {
    return new Date().toISOString();
}

function inquiryId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `INQ-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.inquiries) ? data.inquiries : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const inquiries = await loadAll();
        const result = await task(inquiries);
        // inside the inquiries lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), inquiries });
        return result;
    });
}

function pushMessage(inquiry, from, text) {
    inquiry.messages = Array.isArray(inquiry.messages) ? inquiry.messages : [];
    inquiry.messages.push({
        id: store.newId('MSG'),
        from,
        text: String(text).trim().slice(0, MESSAGE_LIMIT),
        at: nowIso(),
    });
    inquiry.messages = inquiry.messages.slice(-MESSAGE_LIMIT);
}

/** Card view for the admin — everything except nothing; the thread is small. */
function summary(inquiry) {
    if (!inquiry) return null;
    return {
        id: inquiry.id,
        slideId: inquiry.slideId,
        slideTitle: inquiry.slideTitle,
        slidePrice: inquiry.slidePrice,
        memberId: inquiry.memberId,
        memberName: inquiry.memberName,
        memberKey: inquiry.memberKey,
        message: inquiry.message,
        status: inquiry.status,
        messages: inquiry.messages || [],
        createdAt: inquiry.createdAt,
        updatedAt: inquiry.updatedAt,
        resolvedAt: inquiry.resolvedAt || null,
    };
}

/** Member view — hides the internal member identifier. */
function summaryForMember(inquiry) {
    if (!inquiry) return null;
    const { memberId, memberKey, ...rest } = summary(inquiry);
    return rest;
}

// ---------------------------------------------------------------- queries

async function listInquiries({ status = '', query = '', memberId = '' } = {}) {
    let list = await loadAll();

    if (status === 'open') list = list.filter(i => OPEN_STATES.includes(i.status));
    else if (status && status !== 'all') list = list.filter(i => i.status === status);
    if (memberId) list = list.filter(i => i.memberId === memberId);

    const needle = String(query || '').trim().toLowerCase();
    if (needle) {
        list = list.filter(i =>
            String(i.id).toLowerCase().includes(needle) ||
            String(i.slideTitle).toLowerCase().includes(needle) ||
            String(i.memberName).toLowerCase().includes(needle) ||
            String(i.memberKey).toLowerCase().includes(needle) ||
            String(i.message).toLowerCase().includes(needle));
    }

    return list
        .map(summary)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getInquiry(id) {
    const list = await loadAll();
    return summary(list.find(i => i.id === id) || null);
}

async function counts() {
    const list = await loadAll();
    return {
        total: list.length,
        new: list.filter(i => i.status === 'new').length,
        open: list.filter(i => OPEN_STATES.includes(i.status)).length,
        replied: list.filter(i => i.status === 'replied').length,
        closed: list.filter(i => i.status === 'closed').length,
    };
}

// ---------------------------------------------------------------- mutations

/** Member sends an inquiry about a showcase slide. */
async function createInquiry({ member, slide, message } = {}) {
    if (!member || !member.id) throw badRequest('Member is required');
    if (!slide || !slide.id) throw badRequest('That listing is no longer available');

    const clean = String(message || '').trim().slice(0, MESSAGE_LIMIT);
    if (!clean) throw badRequest('Write a short message with your inquiry');

    return mutate(async inquiries => {
        const inquiry = {
            id: inquiryId(),
            slideId: slide.id,
            slideTitle: slide.title,
            slidePrice: slide.price,
            memberId: member.id,
            memberName: member.name,
            memberKey: member.key,
            message: clean,
            messages: [],
            status: 'new',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            resolvedAt: null,
        };
        pushMessage(inquiry, 'member', clean);
        inquiries.push(inquiry);
        if (inquiries.length > HISTORY_LIMIT) inquiries.splice(0, inquiries.length - HISTORY_LIMIT);
        return summaryForMember(inquiry);
    });
}

/** Admin reply — flips the inquiry to "replied". */
async function reply(id, { text } = {}) {
    const clean = String(text || '').trim();
    if (!clean) throw badRequest('Message cannot be empty');

    return mutate(async inquiries => {
        const inquiry = inquiries.find(i => i.id === id);
        if (!inquiry) throw new Error('Inquiry not found');
        pushMessage(inquiry, 'admin', clean);
        inquiry.status = 'replied';
        inquiry.resolvedAt = null;
        inquiry.updatedAt = nowIso();
        return summary(inquiry);
    });
}

/** Admin status change — new | replied | closed. */
async function setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status. Use: ${STATUSES.join(', ')}`);

    return mutate(async inquiries => {
        const inquiry = inquiries.find(i => i.id === id);
        if (!inquiry) throw new Error('Inquiry not found');
        inquiry.status = status;
        inquiry.updatedAt = nowIso();
        inquiry.resolvedAt = OPEN_STATES.includes(status) ? null : (inquiry.resolvedAt || nowIso());
        return summary(inquiry);
    });
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

module.exports = {
    STATUSES,
    OPEN_STATES,
    summaryForMember,
    listInquiries,
    getInquiry,
    counts,
    createInquiry,
    reply,
    setStatus,
};

