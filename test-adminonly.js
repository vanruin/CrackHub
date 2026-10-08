/** Live check: member side has NO add-account access; admin still does. */
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
    try { data = await res.json(); } catch (err) { /* html */ }
    return { status: res.status, data, cookie: cookieOf(res), text: res.headers.get('content-type') || '' };
}

(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', 'data', 'config.json'), 'utf8'));

    // admin session
    const adminLogin = await call('POST', '/api/auth/login', { body: { key: cfg.adminKey, portal: 'admin' } });
    const admin = adminLogin.cookie;

    // member session
    const created = await call('POST', '/api/admin/members', { cookie: admin, body: { name: 'Member Probe', balance: 0 } });
    const memberKey = created.data.member.key;
    const memberId = created.data.member.id;
    const memberLogin = await call('POST', '/api/auth/login', { body: { key: memberKey, portal: 'member' } });
    const member = memberLogin.cookie;

    // ---- member must be blocked from every add-account endpoint
    const parse = await call('POST', '/api/accounts/parse', { cookie: member, body: { text: 'a@b.c:pass', service: 'netflix' } });
    check('member blocked: POST /api/accounts/parse', parse.status === 403 && parse.data.code === 'ADMIN_REQUIRED', parse.status);

    const add = await call('POST', '/api/accounts/add', { cookie: member, body: { text: 'a@b.c:pass', service: 'netflix' } });
    check('member blocked: POST /api/accounts/add', add.status === 403, add.status);

    const listSteam = await call('GET', '/api/steam-accounts', { cookie: member });
    check('member blocked: GET /api/steam-accounts', listSteam.status === 403, listSteam.status);

    const postSteam = await call('POST', '/api/steam-accounts', { cookie: member, body: { username: 'x', password: 'y' } });
    check('member blocked: POST /api/steam-accounts', postSteam.status === 403, postSteam.status);

    const delSteam = await call('DELETE', '/api/steam-accounts/nobody', { cookie: member });
    check('member blocked: DELETE /api/steam-accounts/:u', delSteam.status === 403, delSteam.status);

    // ---- admin still allowed
    const adminParse = await call('POST', '/api/accounts/parse', { cookie: admin, body: { text: 'a@b.c:secret123', service: 'netflix' } });
    check('admin can parse', adminParse.status === 200 && adminParse.data.success === true, adminParse.data);

    const adminList = await call('GET', '/api/steam-accounts', { cookie: admin });
    check('admin can list steam accounts', adminList.status === 200 && adminList.data.success !== false, adminList.status);

    // ---- member pages still fine, no uploader markup
    for (const page of ['/netflix', '/steam']) {
        const res = await fetch(BASE + page, { headers: { cookie: member } });
        const html = await res.text();
        check(`${page} renders for member`, res.status === 200, res.status);
        const hasUploader = /uploadToggle|adminToggle|uploadBtn|addAccountBtn|upload-card|admin-panel|SAVE TO/.test(html);
        check(`${page} has no add-account UI`, !hasUploader);
    }

    // ---- intro admin tools page untouched (still has the add panel)
    const tools = await fetch(BASE + '/tools', { headers: { cookie: admin } });
    const toolsHtml = await tools.text();
    check('admin /tools keeps add-accounts panel', tools.status === 200 && /addAccountsBtn|accounts\/add/.test(toolsHtml), tools.status);

    // cleanup
    await call('DELETE', `/api/admin/members/${memberId}`, { cookie: admin });

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(err => { console.error('CRASH:', err); process.exit(1); });
