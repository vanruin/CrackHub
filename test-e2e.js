/**
 * End-to-end smoke test for the pricing + cash-in flow.
 * Run with the server up:  node test-e2e.js [BASE_URL]
 * Exits non-zero on the first failed assertion.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8099';
const RECEIPT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let failures = 0;
function check(label, cond, extra) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

function cookieOf(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    return (raw || []).filter(Boolean).map(c => String(c).split(';')[0]).join('; ');
}

async function call(method, url, { body, cookie } = {}) {
    const res = await fetch(BASE + url, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (err) { /* non-JSON */ }
    return { status: res.status, data, cookie: cookieOf(res) };
}

(async () => {
    console.log(`E2E against ${BASE}`);

    // ---------------------------------------------------------- admin login
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', 'data', 'config.json'), 'utf8'));
    const adminLogin = await call('POST', '/api/auth/login', { body: { key: cfg.adminKey, portal: 'admin' } });
    check('admin login', adminLogin.status === 200 && adminLogin.data.success, adminLogin.data);
    const admin = adminLogin.cookie;
    check('admin cookie issued', /ch_access=/.test(admin));

    // ---------------------------------------------------------- public prices
    const services = await call('GET', '/api/services');
    check('GET /api/services', services.status === 200);
    const list = (services.data && services.data.services) || [];
    check('10 services listed', list.length === 10, list.length);
    check('every service carries a numeric price', list.every(s => Number.isFinite(Number(s.price))), list.map(s => [s.key, s.price]));

    // ---------------------------------------------------------- pricing admin
    const pricing = await call('GET', '/api/admin/pricing', { cookie: admin });
    check('GET /api/admin/pricing', pricing.status === 200 && (pricing.data.prices || []).length === 10, pricing.data);
    check('default price is 10', pricing.data.prices.every(p => p.price === 10), pricing.data.prices);

    const saved = await call('POST', '/api/admin/pricing', { cookie: admin, body: { prices: { netflix: 42 } } });
    check('POST /api/admin/pricing saves', saved.status === 200, saved.data);
    check('netflix price now 42', saved.data.prices.find(p => p.key === 'netflix').price === 42);

    const badPrice = await call('POST', '/api/admin/pricing', { cookie: admin, body: { prices: { nosuch: 5 } } });
    check('unknown service rejected', badPrice.status === 400, badPrice.status);

    const memberPrice = await call('GET', '/api/services');
    check('member sees edited price', memberPrice.data.services.find(s => s.key === 'netflix').price === 42);

    // ---------------------------------------------------------- create member
    const created = await call('POST', '/api/admin/members', { cookie: admin, body: { name: 'Cashin Tester', balance: 0 } });
    check('member created', created.status === 201, created.data);
    const memberKey = created.data.member.key;
    const memberId = created.data.member.id;

    const memberLogin = await call('POST', '/api/auth/login', { body: { key: memberKey, portal: 'member' } });
    check('member login', memberLogin.status === 200 && memberLogin.data.success, memberLogin.data);
    const member = memberLogin.cookie;


    // ---------------------------------------------------------- cash-in state
    const state = await call('GET', '/api/member/cashin', { cookie: member });
    check('GET /api/member/cashin', state.status === 200);
    const denoms = state.data.denominations || [];
    check('denominations 50/100/500/1000', denoms.map(d => d.amount).join(',') === '50,100,500,1000', denoms);
    check('denominations map to QR files', denoms.every(d => d.qr === `/assets/prices/${d.amount}.PNG`), denoms);
    check('member balance starts at 0', state.data.balance === 0, state.data.balance);

    for (const d of denoms) {
        const img = await fetch(BASE + d.qr);
        check(`QR served: ${d.qr}`, img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'), img.status);
    }

    // ---------------------------------------------------------- validation
    const badAmount = await call('POST', '/api/member/cashin', { cookie: member, body: { amount: 75, receipt: RECEIPT } });
    check('non-denomination amount rejected', badAmount.status === 400, badAmount.data);
    const noReceipt = await call('POST', '/api/member/cashin', { cookie: member, body: { amount: 100 } });
    check('missing receipt rejected', noReceipt.status === 400, noReceipt.data);

    // ---------------------------------------------------------- submit cash-in
    const submitted = await call('POST', '/api/member/cashin', {
        cookie: member,
        body: { amount: 100, receipt: RECEIPT, reference: 'GC-TEST-123' },
    });
    check('cash-in submitted', submitted.status === 201, submitted.data);
    const cashId = submitted.data.request && submitted.data.request.id;
    check('cash-in id issued', /^CIN-/.test(cashId || ''), cashId);
    check('pending status', submitted.data.request.status === 'pending');

    const duplicate = await call('POST', '/api/member/cashin', { cookie: member, body: { amount: 50, receipt: RECEIPT } });
    check('second pending cash-in blocked (409)', duplicate.status === 409, duplicate.status);

    const pendingBadge = await call('GET', '/api/member/cashin', { cookie: member });
    check('pending count = 1', pendingBadge.data.pending === 1, pendingBadge.data.pending);


    // ---------------------------------------------------------- admin review
    const adminList = await call('GET', '/api/admin/cashins?status=pending', { cookie: admin });
    check('admin sees pending cash-ins', adminList.status === 200 && adminList.data.requests.length === 1, adminList.data);
    check('admin list hides base64 receipt', !('receipt' in adminList.data.requests[0]) && adminList.data.requests[0].hasReceipt === true);
    check('counts include approvedTotal', typeof adminList.data.counts.approvedTotal === 'number');

    const detail = await call('GET', `/api/admin/cashins/${cashId}`, { cookie: admin });
    check('admin detail includes receipt', detail.status === 200 && !!detail.data.request.receipt);

    const approve = await call('POST', `/api/admin/cashins/${cashId}/approve`, { cookie: admin, body: { note: 'verified' } });
    check('approve succeeds', approve.status === 200 && approve.data.success, approve.data);
    check('balance credited to 100', approve.data.member.balance === 100, approve.data.member.balance);
    check('approve message mentions amount', /₱100/.test(approve.data.message || ''), approve.data.message);

    const approveTwice = await call('POST', `/api/admin/cashins/${cashId}/approve`, { cookie: admin, body: {} });
    check('double approve blocked (409)', approveTwice.status === 409, approveTwice.status);

    const afterCredit = await call('GET', '/api/member/cashin', { cookie: member });
    check('member sees credited balance', afterCredit.data.balance === 100, afterCredit.data.balance);
    check('member sees approved request', afterCredit.data.requests[0].status === 'approved');
    check('pending badge cleared', afterCredit.data.pending === 0, afterCredit.data.pending);

    // ---------------------------------------------------------- reject path
    const second = await call('POST', '/api/member/cashin', { cookie: member, body: { amount: 50, receipt: RECEIPT } });
    check('second cash-in accepted', second.status === 201, second.data);
    const reject = await call('POST', `/api/admin/cashins/${second.data.request.id}/reject`, { cookie: admin, body: { note: 'blurry' } });
    check('reject succeeds', reject.status === 200 && reject.data.request.status === 'rejected', reject.data);
    const afterReject = await call('GET', '/api/member/cashin', { cookie: member });
    check('rejection does not credit balance', afterReject.data.balance === 100, afterReject.data.balance);


    // ---------------------------------------------------------- 402 guard
    await call('POST', '/api/admin/pricing', { cookie: admin, body: { prices: { netflix: 10000 } } });
    const tooPoor = await call('POST', '/api/get-random-netflix-cookie', { cookie: member, body: {} });
    check('insufficient funds → 402', tooPoor.status === 402, tooPoor.status);
    check('402 code INSUFFICIENT_FUNDS', tooPoor.data && tooPoor.data.code === 'INSUFFICIENT_FUNDS', tooPoor.data);

    // ---------------------------------------------------------- restore prices
    const originalPrices = Object.fromEntries((pricing.data.prices || []).map(p => [p.key, p.price]));
    const restored = await call('POST', '/api/admin/pricing', { cookie: admin, body: { prices: originalPrices } });
    check('prices restored', restored.status === 200, restored.data);

    // ---------------------------------------------------------- cleanup
    const removed = await call('DELETE', `/api/admin/members/${memberId}`, { cookie: admin });
    check('test member removed', removed.status === 200 && removed.data.success, removed.data);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(err => {
    console.error('E2E crashed:', err);
    process.exit(1);
});
