/**
 * Subscriptions — the PHP 500 / month CrackHub membership.
 *
 * Flow
 *   1. A member whose plan is missing or expired is shown the payment QR
 *      (Assets/crack.jpg) and uploads a proof-of-payment receipt.
 *   2. The receipt lands here as a "pending" request.
 *   3. The admin verifies the receipt in the panel and approves or rejects it.
 *   4. Approval activates/extends the member's subscription (PLAN.days).
 *
 * Stored in backend/data/subscriptions.json as { requests: [...] }
 */

const store = require('./store');
const { money } = require('./money');

const STORE_NAME = 'subscriptions';
const RECEIPT_LIMIT = 4 * 1024 * 1024;   // data-URL ceiling (~3 MB image)
const REFERENCE_LIMIT = 80;
const NOTE_LIMIT = 500;
const HISTORY_LIMIT = 400;

/** 500 pesos per month — the single source of truth for the plan. */
const PLAN = Object.freeze({
    key: 'monthly',
    label: 'CrackHub Premium',
    amount: 500,
    days: 30,
    currency: '₱',
    period: 'per month',
});

const STATUSES = ['pending', 'approved', 'rejected'];
const OPEN_STATES = ['pending'];
const RECEIPT_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

function nowIso() {
    return new Date().toISOString();
}

function requestId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `SUB-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.requests) ? data.requests : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const requests = await loadAll();
        const result = await task(requests);
        // inside the subscriptions lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), requests });
        return result;
    });
}

function cleanReceipt(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) throw new Error('Attach a screenshot of your payment receipt');
    if (value.length > RECEIPT_LIMIT) throw new Error('That receipt image is too large — use a smaller screenshot');
    if (!RECEIPT_RE.test(value)) throw new Error('The receipt must be an image (PNG, JPG or WEBP)');
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
        plan: request.plan,
        planLabel: request.planLabel,
        amount: money(request.amount),
        method: request.method,
        reference: request.reference,
        note: request.note,
        status: request.status,
        adminNote: request.adminNote || '',
        hasReceipt: !!request.receipt,
        startsAt: request.startsAt || null,
        expiresAt: request.expiresAt || null,
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

/** Store a new proof-of-payment request (one pending per member at a time). */
async function createRequest({ member, amount, method, reference, note, receipt } = {}) {
    if (!member || !member.id) throw new Error('Member is required');

    const image = cleanReceipt(receipt);
    const value = money(amount === undefined || amount === '' ? PLAN.amount : amount);
    if (!(value > 0)) throw new Error('Enter the amount you paid');

    const cleanMethod = String(method || 'gcash').trim().toLowerCase().slice(0, 24) || 'gcash';
    const cleanReference = String(reference || '').trim().slice(0, REFERENCE_LIMIT);
    const cleanNote = String(note || '').trim().slice(0, NOTE_LIMIT);

    return mutate(async requests => {
        if (requests.some(r => r.memberId === member.id && r.status === 'pending')) {
            const err = new Error('You already have a receipt under review — please wait for the admin.');
            err.code = 'PENDING_EXISTS';
            err.status = 409;
            throw err;
        }

        const request = {
            id: requestId(),
            memberId: member.id,
            memberName: member.name,
            memberKey: member.key,
            plan: PLAN.key,
            planLabel: PLAN.label,
            amount: value,
            method: cleanMethod,
            reference: cleanReference,
            note: cleanNote,
            receipt: image,
            status: 'pending',
            adminNote: '',
            startsAt: null,
            expiresAt: null,
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
async function setStatus(id, status, { note = '', by = 'admin', startsAt = null, expiresAt = null } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status. Use: ${STATUSES.join(', ')}`);

    return mutate(async requests => {
        const request = requests.find(r => r.id === id);
        if (!request) throw new Error('Subscription request not found');

        request.status = status;
        request.updatedAt = nowIso();
        request.reviewedAt = OPEN_STATES.includes(status) ? null : nowIso();
        request.reviewedBy = OPEN_STATES.includes(status) ? null : by;
        if (note) request.adminNote = String(note).slice(0, NOTE_LIMIT);
        if (startsAt) request.startsAt = startsAt;
        if (expiresAt) request.expiresAt = expiresAt;
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
    PLAN,
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

