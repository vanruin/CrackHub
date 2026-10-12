/**
 * Live validation for the credit-debit + INSUFFICIENT_BALANCE fixes.
 * Run with the server up:  node test-billing-fix.js [BASE_URL]
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8099';
let failures = 0;
const check = (label, cond, extra) => {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
};
const cookieOf = res => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')])
    .filter(Boolean).map(c => c.split(';')[0]).join('; ');

async function call(method, url, { body, cookie } = {}) {
    const res = await fetch(BASE + url, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (err) { /* non-JSON */ }
    return { status: res.status, data, cookie: cookieOf(res) };
}

(async () => {
    console.log(`Billing-fix validation against ${BASE}`);

    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', 'data', 'config.json'), 'utf8'));
    const adminLogin = await call('POST', '/api/auth/login', { body: { key: cfg.adminKey, portal: 'admin' } });
    const admin = adminLogin.cookie;
    check('admin login', adminLogin.status === 200 && adminLogin.data.success, adminLogin.data);

    // garena price must be the default 10
    await call('POST', '/api/admin/pricing', { cookie: admin, body: { prices: { garena: 10 } } });

    // ------------------------------------------------ member with NO credit (pending cash-in only)
    const created = await call('POST', '/api/admin/members', { cookie: admin, body: { name: 'Billing Probe', balance: 0 } });
    check('member created', created.status === 201, created.data);
    const memberId = created.data.member.id;
    const memberKey = created.data.member.key;

    const memberLogin = await call('POST', '/api/auth/login', { body: { key: memberKey, portal: 'member' } });
    const member = memberLogin.cookie;

    // a pending cash-in must NOT unlock generation
    const cashin = await call('POST', '/api/member/cashin', { cookie: member, body: { amount: 100, receipt: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } });
    check('cash-in submitted (pending)', cashin.status === 201, cashin.data);

    const brokeGen = await call('POST', '/api/get-random-garena-account', { cookie: member, body: {} });
    check('pending/zero balance → 402', brokeGen.status === 402, brokeGen.status);
    check('402 code INSUFFICIENT_FUNDS', brokeGen.data && brokeGen.data.code === 'INSUFFICIENT_FUNDS', brokeGen.data);
    check('402 carries price+balance', brokeGen.data && brokeGen.data.price === 10 && brokeGen.data.balance === 0, brokeGen.data);
    check('402 leaks no account', brokeGen.data && brokeGen.data.data === undefined, brokeGen.data);

    // ------------------------------------------------ top-up so the member can afford exactly 2 generations
    await call('POST', '/api/admin/members/' + memberId + '/balance', { cookie: admin, body: { action: 'add', amount: 20, note: 'test top-up' } });

    const gen1 = await call('POST', '/api/get-random-garena-account', { cookie: member, body: {} });
    check('generation 1 succeeds', gen1.status === 200 && gen1.data.success === true, gen1.data);
    check('billing attached', gen1.data && gen1.data.billing && gen1.data.billing.charged === 10, gen1.data && gen1.data.billing);
    check('balance debited to 10', gen1.data && gen1.data.billing.balance === 10, gen1.data && gen1.data.billing);

    const gen2 = await call('POST', '/api/get-random-garena-account', { cookie: member, body: {} });
    check('generation 2 succeeds', gen2.status === 200 && gen2.data.success === true, gen2.data);
    check('balance debited to 0', gen2.data && gen2.data.billing.balance === 0, gen2.data && gen1.data.billing);

    const gen3 = await call('POST', '/api/get-random-garena-account', { cookie: member, body: {} });
    check('drained member → 402', gen3.status === 402, gen3.status);
    check('drained code INSUFFICIENT_FUNDS', gen3.data && gen3.data.code === 'INSUFFICIENT_FUNDS', gen3.data);

    // transaction history shows the two debits
    const tx = await call('GET', '/api/member/transactions', { cookie: member });
    const debits = (tx.data.transactions || []).filter(t => t.type === 'debit');
    check('two debit transactions recorded', debits.length === 2 && debits.every(t => t.amount === 10), debits);

    const me = await call('GET', '/api/auth/me', { cookie: member });
    check('stored balance is 0', me.data && me.data.member && me.data.member.balance === 0, me.data && me.data.member);

    // ------------------------------------------------ partial balance: 5 < price 10 → still blocked
    await call('POST', '/api/admin/members/' + memberId + '/balance', { cookie: admin, body: { action: 'add', amount: 5 } });
    const partial = await call('POST', '/api/get-random-garena-account', { cookie: member, body: {} });
    check('low credit (5 < 10) → 402', partial.status === 402, partial.status);

    // cleanup
    await call('DELETE', '/api/admin/members/' + memberId, { cookie: admin });
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(err => { console.error('CRASH:', err); process.exit(1); });