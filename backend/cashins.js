/**
 * Cash-ins — GCash top-ups paid through the QR codes in Assets/prices.
 *
 * Flow
 *   1. The member picks a denomination (50 / 100 / 500 / 1000) on the store
 *      page and scans the matching QR (Assets/prices/<amount>.PNG) with GCash.
 *   2. They attach their GCash receipt screenshot — it lands here as a
 *      "pending" cash-in request.
 *   3. The admin reviews the receipt in the panel and approves or rejects it.
 *   4. Approval credits the amount to the member's balance.
 *
 * Stored in backend/data/cashins.json as { requests: [...] }
 */

const store = require('./store');
const { money } = require('./money');

const STORE_NAME = 'cashins';
const RECEIPT_LIMIT = 4 * 1024 * 1024;   // data-URL ceiling (~3 MB image)
const REFERENCE_LIMIT = 80;
const NOTE_LIMIT = 500;
const HISTORY_LIMIT = 400;

/** Cash-in denominations — each one has a QR image in Assets/prices. */
const DENOMINATIONS = Object.freeze([50, 100, 500, 1000].map(amount => ({
    amount,
    qr: `/assets/prices/${amount}.PNG`,
})));

const STATUSES = ['pending', 'approved', 'rejected'];
const OPEN_STATES = ['pending'];
const RECEIPT_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

/** Validation failure → HTTP 400 instead of a generic 500. */
function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function nowIso() {
    return new Date().toISOString();
}

function requestId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `CIN-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.requests) ? data.requests : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const requests = await loadAll();
        const result = await task(requests);
        // inside the cashins lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), requests });
        return result;
    });
}

function cleanReceipt(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) throw badRequest('Attach your GCash receipt screenshot');
    if (value.length > RECEIPT_LIMIT) throw badRequest('That receipt image is too large — use a smaller screenshot');
    if (!RECEIPT_RE.test(value)) throw badRequest('The receipt must be an image (PNG, JPG or WEBP)');
    return value;
}

function cleanAmount(raw) {
    const value = money(raw);
    if (!DENOMINATIONS.some(d => d.amount === value)) {
        throw badRequest(`Pick one of the cash-in amounts: ${DENOMINATIONS.map(d => `₱${d.amount}`).join(', ')}`);
    }
    return value;
}

/** Card view for lists — omits the (large) base64 receipt image. */
function summary(request) {
    if (!request) return null;
    return {
        id: request.id,
        memberId: request.memberId,
        memberName: request.memberName,
        memberKey: request.memberKey,
        amount: money(request.amount),
        method: request.method,
        reference: request.reference,
        note: request.note,
        status: request.status,
        adminNote: request.adminNote || '',
        hasReceipt: !!request.receipt,
        creditedTo: request.creditedTo || null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        reviewedAt: request.reviewedAt || null,
        reviewedBy: request.reviewedBy || null,
    };
}

/** Full view including the receipt image (used by the admin review modal). */
function detail(request) {
    const base = summary(request);
    if (!base) return null;
    return { ...base, receipt: request.receipt || null };
}


// ---------------------------------------------------------------- queries

async function listRequests({ status = '', memberId = '', query = '' } = {}) {
    let requests = await loadAll();

    if (status === 'pending') requests = requests.filter(r => r.status === 'pending');
    else if (status && status !== 'all') requests = requests.filter(r => r.status === status);
    if (memberId) requests = requests.filter(r => r.memberId === memberId);

    const needle = String(query || '').trim().toLowerCase();
    if (needle) {
        requests = requests.filter(r =>
            String(r.id).toLowerCase().includes(needle) ||
            String(r.memberName).toLowerCase().includes(needle) ||
            String(r.memberKey).toLowerCase().includes(needle) ||
            String(r.reference).toLowerCase().includes(needle));
    }

    return requests
        .map(summary)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function listForMember(memberId) {
    const requests = await loadAll();
    return requests
        .filter(r => r.memberId === memberId)
        .map(summary)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 20);
}

// ---------------------------------------------------------------- mutations

/** Store a new cash-in request (one pending per member at a time). */
async function createRequest({ member, amount, reference, note, receipt } = {}) {
    if (!member || !member.id) throw badRequest('Member is required');

    const value = cleanAmount(amount);
    const image = cleanReceipt(receipt);
    const cleanReference = String(reference || '').trim().slice(0, REFERENCE_LIMIT);
    const cleanNote = String(note || '').trim().slice(0, NOTE_LIMIT);

    return mutate(async requests => {
        if (requests.some(r => r.memberId === member.id && r.status === 'pending')) {
            const err = new Error('You already have a cash-in under review — please wait for the admin.');
            err.code = 'PENDING_EXISTS';
            err.status = 409;
            throw err;
        }

        const request = {
            id: requestId(),
            memberId: member.id,
            memberName: member.name,
            memberKey: member.key,
            amount: value,
            method: 'gcash',
            reference: cleanReference,
            note: cleanNote,
            receipt: image,
            status: 'pending',
            adminNote: '',
            creditedTo: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            reviewedAt: null,
            reviewedBy: null,
        };

        requests.push(request);
        if (requests.length > HISTORY_LIMIT) requests.splice(0, requests.length - HISTORY_LIMIT);
        return summary(request);
    });
}

/** Admin review — pending | approved | rejected. */
async function setStatus(id, status, { note = '', by = 'admin', creditedTo = null } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status. Use: ${STATUSES.join(', ')}`);

    return mutate(async requests => {
        const request = requests.find(r => r.id === id);
        if (!request) throw new Error('Cash-in request not found');

        request.status = status;
        request.updatedAt = nowIso();
        request.reviewedAt = OPEN_STATES.includes(status) ? null : nowIso();
        request.reviewedBy = OPEN_STATES.includes(status) ? null : by;
        if (note) request.adminNote = String(note).slice(0, NOTE_LIMIT);
        if (creditedTo !== null) request.creditedTo = creditedTo;
        return summary(request);
    });
}

async function counts() {
    const requests = await loadAll();
    return {
        total: requests.length,
        pending: requests.filter(r => r.status === 'pending').length,
        approved: requests.filter(r => r.status === 'approved').length,
        rejected: requests.filter(r => r.status === 'rejected').length,
        approvedTotal: money(requests
            .filter(r => r.status === 'approved')
            .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
    };
}

async function getRequest(id) {
    const requests = await loadAll();
    return detail(requests.find(r => r.id === id) || null);
}

async function pendingForMember(memberId) {
    const requests = await loadAll();
    return requests.filter(r => r.memberId === memberId && r.status === 'pending').length;
}

module.exports = {
    DENOMINATIONS,
    STATUSES,
    OPEN_STATES,
    listRequests,
    listForMember,
    getRequest,
    pendingForMember,
    createRequest,
    setStatus,
    counts,
};
