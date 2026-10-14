/**
 * Smoke test for the showcase slides, tutorial area and inquiry flow.
 * Run with the server up:  node test-content.js [BASE_URL]
 * Exits non-zero on the first failed assertion.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8099';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';
const UNSUPPORTED = 'data:application/zip;base64,UEsDBBQAAAAI';

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
    console.log(`Content E2E against ${BASE}`);

    // ---------------------------------------------------------- admin login
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', 'data', 'config.json'), 'utf8'));
    const adminLogin = await call('POST', '/api/auth/login', { body: { key: cfg.adminKey, portal: 'admin' } });
    check('admin login', adminLogin.status === 200 && adminLogin.data.success, adminLogin.data);
    const admin = adminLogin.cookie;

    // ---------------------------------------------------------- member login
    const members = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend', 'data', 'members.json'), 'utf8'));
    const member = (members.members || [])[0];
    check('a seeded member exists', !!member);
    const memberLogin = await call('POST', '/api/auth/login', { body: { key: member.key, portal: 'member' } });
    check('member login', memberLogin.status === 200 && memberLogin.data.success, memberLogin.data);
    const user = memberLogin.cookie;

    const statsBefore = await call('GET', '/api/admin/stats', { cookie: admin });
    const inquiriesBefore = (statsBefore.data.stats.inquiries || {}).total;
    check('stats expose inquiry counts', Number.isFinite(inquiriesBefore), statsBefore.data);

    // --------------------------------------------------------------- slides
    const badSlide = await call('POST', '/api/admin/slides', { cookie: admin, body: { image: PNG } });
    check('slide without a title is rejected', badSlide.status === 400, badSlide.data);

    const slide = await call('POST', '/api/admin/slides', {
        cookie: admin,
        body: {
            title: 'Netflix — 1 month',
            subtitle: 'Full access',
            price: 99,
            details: 'Region PH. Warranty for 7 days.',
            order: 1,
            image: PNG,
        },
    });
    check('admin publishes a slide', slide.status === 201 && slide.data.success, slide.data);
    const slideId = slide.data && slide.data.slide && slide.data.slide.id;
    check('slide picture stored under /media/', /^\/media\/.+\.png$/.test((slide.data.slide || {}).image || ''), slide.data);

    // ------------------------------------------------------------ tutorials
    const noMedia = await call('POST', '/api/admin/tutorials', { cookie: admin, body: { title: 'Empty' } });
    check('tutorial without media is rejected', noMedia.status === 400, noMedia.data);

    const badType = await call('POST', '/api/admin/tutorials', {
        cookie: admin,
        body: { title: 'Bad type', images: [UNSUPPORTED] },
    });
    check('unsupported upload type is rejected', badType.status === 400, badType.data);

    const tutorial = await call('POST', '/api/admin/tutorials', {
        cookie: admin,
        body: {
            title: 'How to claim your account',
            note: 'Step by step',
            images: [PNG, PNG],
            video: FAKE_VIDEO,
        },
    });
    check('admin publishes a tutorial', tutorial.status === 201 && tutorial.data.success, tutorial.data);
    const tut = (tutorial.data || {}).tutorial || {};
    check('tutorial keeps 2 screenshots + video', tut.images && tut.images.length === 2 && !!tut.video, tut);

    const adminTutorials = await call('GET', '/api/admin/tutorials', { cookie: admin });
    check('admin lists tutorials',
        adminTutorials.status === 200 && (adminTutorials.data.tutorials || []).some(t => t.id === tut.id),
        adminTutorials.data.counts);

    // -------------------------------------------------------- member reads
    const mSlides = await call('GET', '/api/member/slides', { cookie: user });
    check('member sees the active slide',
        mSlides.status === 200 && (mSlides.data.slides || []).some(s => s.id === slideId), mSlides.data);

    const mTutorials = await call('GET', '/api/member/tutorials', { cookie: user });
    check('member sees the tutorial',
        mTutorials.status === 200 && (mTutorials.data.tutorials || []).some(t => t.id === tut.id), mTutorials.data);

    const anon = await call('GET', '/api/member/tutorials');
    check('member endpoints need a key', anon.status === 401, anon.status);

    // ------------------------------------------------------- media is gated
    const mediaUrl = tut.images[0];
    const anonMedia = await fetch(BASE + mediaUrl);
    check('media is rejected without a key', anonMedia.status === 401, anonMedia.status);
    const memberMedia = await fetch(BASE + mediaUrl, { headers: { cookie: user } });
    check('media is served to a member', memberMedia.status === 200, memberMedia.status);
    const adminMedia = await fetch(BASE + mediaUrl, { headers: { cookie: admin } });
    check('media is served to the admin', adminMedia.status === 200, adminMedia.status);

    // ----------------------------------------------------------- inquiries
    const noSlide = await call('POST', '/api/member/inquiries', {
        cookie: user,
        body: { slideId: 'SLD-nope', message: 'hello' },
    });
    check('inquiry for an unknown slide is rejected', noSlide.status === 404, noSlide.data);

    const inquiry = await call('POST', '/api/member/inquiries', {
        cookie: user,
        body: { slideId, message: 'Is this still available? I want to buy.' },
    });
    check('member sends an inquiry', inquiry.status === 201 && inquiry.data.success, inquiry.data);
    const inqId = inquiry.data && inquiry.data.inquiry && inquiry.data.inquiry.id;
    check('inquiry hides the member id', inquiry.data && !('memberId' in (inquiry.data.inquiry || {})), inquiry.data);

    const mInquiries = await call('GET', '/api/member/inquiries', { cookie: user });
    check('member sees their own inquiry',
        mInquiries.status === 200 && (mInquiries.data.inquiries || []).some(i => i.id === inqId), mInquiries.data);

    const aInquiries = await call('GET', '/api/admin/inquiries?status=open', { cookie: admin });
    check('admin sees the inquiry',
        aInquiries.status === 200 && (aInquiries.data.inquiries || []).some(i => i.id === inqId), aInquiries.data);
    check('inquiry carries the listing title',
        (aInquiries.data.inquiries || []).some(i => i.slideTitle === 'Netflix — 1 month'), aInquiries.data);

    const reply = await call('POST', `/api/admin/inquiries/${inqId}/reply`, {
        cookie: admin,
        body: { text: 'Yes — send your GCash reference.' },
    });
    check('admin replies', reply.status === 200 && reply.data.inquiry.status === 'replied', reply.data);

    const closed = await call('POST', `/api/admin/inquiries/${inqId}/status`, {
        cookie: admin,
        body: { status: 'closed' },
    });
    check('admin closes the inquiry', closed.status === 200 && closed.data.inquiry.status === 'closed', closed.data);

    const stats = await call('GET', '/api/admin/stats', { cookie: admin });
    check('stats include the new inquiry',
        stats.status === 200 && stats.data.stats.inquiries.total === inquiriesBefore + 1, stats.data.stats);

    // -------------------------------------------------------- admin gating
    const asMember = await call('POST', '/api/admin/tutorials', {
        cookie: user,
        body: { title: 'nope', images: [PNG] },
    });
    check('members cannot post tutorials', asMember.status === 403, asMember.status);

    // -------------------------------------------------------------- cleanup
    const delTutorial = await call('DELETE', `/api/admin/tutorials/${tut.id}`, { cookie: admin });
    check('tutorial deleted', delTutorial.status === 200, delTutorial.data);

    const mediaDir = path.join(__dirname, 'backend', 'data', 'media');
    const owned = [...tut.images.map(u => path.basename(u)), path.basename(tut.video)];
    const left = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).filter(f => owned.includes(f)) : [];
    check('deleted tutorial files removed from disk', left.length === 0, left);

    const delSlide = await call('DELETE', `/api/admin/slides/${slideId}`, { cookie: admin });
    check('slide deleted', delSlide.status === 200, delSlide.data);

    const goneInquiry = await call('POST', '/api/member/inquiries', {
        cookie: user,
        body: { slideId, message: 'hello' },
    });
    check('deleted slide cannot be inquired', goneInquiry.status === 404, goneInquiry.data);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll content checks passed');
    process.exit(failures ? 1 : 0);
})().catch(err => {
    console.error('Test crashed:', err);
    process.exit(1);
});


