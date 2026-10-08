/**
 * Access control + generation guards.
 *
 * A member authenticates with an access KEY. The key can be sent as
 *   - the `ch_access` cookie (set by POST /api/auth/login)  → page access
 *   - the `X-CrackHub-Key` header                           → API access
 * The cookie holds an HMAC-signed token, not the key itself.
 */

const crypto = require('crypto');
const cookie = require('cookie');

const config = require('./config');
const members = require('./members');
const pricing = require('./pricing');
const { getservice } = require('./catalog');

const COOKIE_NAME = 'ch_access';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ------------------------------------------------------------ tokens

function base64url(buffer) {
    return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unBase64url(value) {
    const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payload, secret) {
    return crypto.createHmac('sha256', secret).update(base64url(JSON.stringify(payload))).digest('base64url');
}

async function createToken(payload, maxAge = COOKIE_MAX_AGE) {
    const secret = await config.getSecret();
    const body = { ...payload, exp: Date.now() + maxAge * 1000 };
    const data = base64url(JSON.stringify(body));
    return `${data}.${sign(body, secret)}`;
}

async function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [data, signature] = token.split('.');
    const secret = await config.getSecret();
    let payload;
    try {
        payload = JSON.parse(unBase64url(data));
    } catch (err) {
        return null;
    }
    const expected = sign(payload, secret);
    const a = Buffer.from(signature || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
}

// ------------------------------------------------------------ cookies

function cookiesFrom(req) {
    try {
        return cookie.parse(req.headers.cookie || '');
    } catch (err) {
        return {};
    }
}

function setSessionCookie(res, token, maxAge = COOKIE_MAX_AGE, opts = {}) {
    res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!opts.secure,
        path: '/',
        maxAge,
    }));
}

function clearSessionCookie(res, opts = {}) {
    res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!opts.secure,
        path: '/',
        maxAge: 0,
    }));
}

// ------------------------------------------------------------ identity

function rawKeyFrom(req) {
    const header = req.headers['x-crackhub-key'];
    if (header) return String(header).slice(0, 128);
    const auth = req.headers.authorization || '';
    if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').slice(0, 128);
    return '';
}

/**
 * Resolve who is calling:
 *   { kind: 'member', member } | { kind: 'admin', via } | { kind: 'disabled', member } | null
 */
async function identify(req) {
    const token = cookiesFrom(req)[COOKIE_NAME];
    if (token) {
        const payload = await verifyToken(token);
        if (payload) {
            if (payload.k === 'admin') return { kind: 'admin', via: 'session' };
            const member = await members.getMember(payload.id);
            if (!member) return null;
            if ((member.status || 'active') !== 'active') {
                return { kind: 'disabled', member: members.publicView(member) };
            }
            return { kind: 'member', member: members.publicView(member) };
        }
    }

    const rawKey = rawKeyFrom(req).trim();
    if (!rawKey) return null;

    const adminKey = await config.getAdminKey();
    if (rawKey.toUpperCase() === adminKey.toUpperCase()) return { kind: 'admin', via: 'key' };

    const member = await members.findByKey(rawKey);
    if (!member) return null;
    if ((member.status || 'active') !== 'active') {
        return { kind: 'disabled', member: members.publicView(member) };
    }
    return { kind: 'member', member: members.publicView(member) };
}

/** Attach the identity when present, never block. */
async function attachIdentity(req, res, next) {
    try {
        req.crackhub = await identify(req);
        if (req.crackhub && req.crackhub.kind === 'member') req.member = req.crackhub.member;
        return next();
    } catch (err) {
        return next(err);
    }
}

/** API guard — members (or an admin) only. */
async function requireMember(req, res, next) {
    try {
        const identity = await identify(req);
        req.crackhub = identity;
        if (!identity) {
            return res.status(401).json({
                success: false,
                code: 'AUTH_REQUIRED',
                error: 'A valid access key is required. Enter your key to continue.',
                loginUrl: '/login',
            });
        }
        if (identity.kind === 'disabled') {
            return res.status(403).json({
                success: false,
                code: 'KEY_DISABLED',
                error: 'This access key has been disabled. Contact your admin.',
            });
        }
        if (identity.kind === 'admin') {
            req.admin = true;      // admins may generate without paying (testing)
            return next();
        }
        req.member = identity.member;
        return next();
    } catch (err) {
        return next(err);
    }
}

/** API guard — admin key only. */
async function requireAdmin(req, res, next) {
    try {
        const identity = await identify(req);
        req.crackhub = identity;
        if (identity && identity.kind === 'admin') return next();
        return res.status(403).json({
            success: false,
            code: 'ADMIN_REQUIRED',
            error: 'Admin key required for this action.',
            loginUrl: '/admin-login',
        });
    } catch (err) {
        return next(err);
    }
}

// ------------------------------------------------------ generation tracking

function defaultExtract(body) {
    const d = (body && body.data) || {};
    const login = d.email || d.username || d.account || '';
    const label = d.country
        || (Array.isArray(d.games) ? d.games.slice(0, 3).join(', ') : '')
        || (Array.isArray(d.cookies) ? `${d.cookies.length} cookies` : '');
    return {
        login,
        label,
        meta: {
            attempts: typeof body.attempts === 'number' ? body.attempts : null,
            remaining: typeof body.accountsRemaining === 'number' ? body.accountsRemaining : null,
        },
    };
}

/**
 * Guard `service` generations: per-member rate limit + usage recording.
 * Every generation is charged at the service's live price, debited from the
 * member's balance (402 when the balance cannot cover it).
 */
function generation(service, options = {}) {
    const svc = getservice(service);

    // Sliding-window limiter per member — blunts payload spam / pool draining.
    const hits = new Map();
    const WINDOW_MS = 60 * 1000;
    const MAX_PER_WINDOW = 12;

    function tooFast(id) {
        const now = Date.now();
        const list = (hits.get(id) || []).filter(t => now - t < WINDOW_MS);
        list.push(now);
        hits.set(id, list);
        if (hits.size > 5000) hits.clear();       // bound memory
        return list.length > MAX_PER_WINDOW;
    }

    return async function trackGeneration(req, res, next) {
        try {
            if (!svc) return next(new Error(`Unknown service: ${service}`));
            if (req.admin) return next();          // admin key = free test runs
            const member = req.member;
            if (!member) return next();            // no member attached

            if (tooFast(member.id)) {
                res.setHeader('Retry-After', '60');
                return res.status(429).json({
                    success: false,
                    code: 'RATE_LIMITED',
                    error: 'Too many generations in the last minute — give it a moment and try again.',
                    balance: Number(member.balance),
                });
            }

            // Charge the live price of the service — refuse before delivering
            // an account the member cannot pay for.
            const price = await pricing.priceFor(svc.key);
            const balance = Number(member.balance) || 0;
            if (price > 0 && balance < price) {
                return res.status(402).json({
                    success: false,
                    code: 'INSUFFICIENT_FUNDS',
                    error: `Not enough balance — ${svc.label} costs ₱${price} and your balance is ₱${balance}. Cash in to add funds.`,
                    price,
                    balance,
                });
            }

            res.setHeader('X-CrackHub-Charged', '0');
            res.setHeader('X-CrackHub-Balance', String(balance));

            const originalJson = res.json.bind(res);

            res.json = async function patchedJson(body) {
                try {
                    const worked = res.statusCode >= 200 && res.statusCode < 300 && body && body.success === true;
                    if (worked) {
                        const info = (options.extract || defaultExtract)(body);
                        const record = await members.recordGeneration(member.id, {
                            service: svc.key,
                            price,
                            login: info.login,
                            label: info.label,
                            meta: info.meta,
                        });

                        res.setHeader('X-CrackHub-Balance', String(record.balance));
                        if (record.usageId) res.setHeader('X-CrackHub-Usage-Id', String(record.usageId));

                        if (body && typeof body === 'object') {
                            body.billing = {
                                service: svc.key,
                                label: svc.label,
                                charged: record.recorded,
                                balance: record.balance,
                                usageId: record.usageId,
                            };
                        }
                    }
                } catch (err) {
                    console.error(`⚠️  generation(${svc.key}) could not record the account:`, err.message);
                    if (err.status === 402 || err.code === 'INSUFFICIENT_FUNDS') {
                        // balance changed under us — report the failed charge
                        res.status(402);
                        if (body && typeof body === 'object') {
                            body.success = false;
                            body.code = 'INSUFFICIENT_FUNDS';
                            body.error = err.message;
                        }
                    }
                    if (body && typeof body === 'object' && !body.billing) {
                        body.billing = { service: svc.key, charged: 0, error: err.message };
                    }
                }
                return originalJson(body);
            };

            return next();
        } catch (err) {
            return next(err);
        }
    };
}

// ------------------------------------------------------------ page guards

/** Pages that must stay reachable without a key. */
const PUBLIC_PAGES = new Set(['/login.html', '/admin-login.html']);
/** Pages that require the admin key instead of a member key. */
const ADMIN_PAGES = new Set(['/admin.html', '/intro.html']);

function normalized(req) {
    let p = req.path || '/';
    try { p = decodeURIComponent(p); } catch (err) { /* keep raw */ }
    return p.toLowerCase();
}

function loginRedirect(res, req, wantsAdmin = false) {
    const target = encodeURIComponent(req.originalUrl || '/');
    // Member and staff logins are completely separate pages.
    const page = wantsAdmin ? '/admin-login' : '/login';
    return res.redirect(`${page}?next=${target}`);
}

/** Shown to signed-in members who open an admin-only page (instead of looping them back to the admin login tab). */
function memberOnAdminPage() {
    return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Admin only</title></head>' +
        '<body style="font-family:system-ui;background:#0b0b0f;color:#e6e6ee;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
        '<div><h1 style="font-size:22px">🛡️ Admin area</h1>' +
        '<p style="opacity:.7">Your access key is a member key.<br>Ask your admin for the admin key to open this page.</p>' +
        '<p><a style="color:#00d4ff" href="/">Back to the store</a> &nbsp;·&nbsp; <a style="color:#00d4ff" href="/admin-login">Staff sign-in</a></p>' +
        '</div></body></html>'
    );
}

/** Guard a server-rendered route: members (or admins) only. */
function requireMemberPage(req, res, next) {
    identify(req).then(identity => {
        if (!identity) return loginRedirect(res, req, false);
        if (identity.kind === 'disabled') {
            return res.status(403).send(
                '<!DOCTYPE html><meta charset="utf-8"><title>Key disabled</title>' +
                '<body style="font-family:system-ui;background:#0b0b0f;color:#e6e6ee;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
                '<div><h1 style="font-size:22px">🔒 Access key disabled</h1><p style="opacity:.7">Contact your admin to re-enable this key.</p>' +
                '<p><a style="color:#00d4ff" href="/login">Use another key</a></p></div>');
        }
        return next();
    }).catch(next);
}

/** Guard admin routes. */
function requireAdminPage(req, res, next) {
    identify(req).then(identity => {
        if (identity && identity.kind === 'admin') return next();
        if (identity && identity.kind === 'member') return res.status(403).send(memberOnAdminPage());
        return loginRedirect(res, req, true);
    }).catch(next);
}

/**
 * Runs before express.static: every .html file is protected, assets are not.
 * (Admin pages need the admin key, everything else needs a member key.)
 */
function protectStaticPages(req, res, next) {
    const p = normalized(req);
    if (!p.endsWith('.html') || PUBLIC_PAGES.has(p)) return next();

    const wantsAdmin = ADMIN_PAGES.has(p);
    identify(req).then(identity => {
        if (wantsAdmin) {
            if (identity && identity.kind === 'admin') return next();
            if (identity && identity.kind === 'member') return res.status(403).send(memberOnAdminPage());
            return loginRedirect(res, req, true);
        }
        if (!identity) return loginRedirect(res, req, false);
        if (identity.kind === 'disabled') return res.status(403).send('Key disabled — <a href="/login">use another key</a>');
        return next();
    }).catch(next);
}

module.exports = {
    COOKIE_NAME,
    COOKIE_MAX_AGE,
    createToken,
    verifyToken,
    setSessionCookie,
    clearSessionCookie,
    identify,
    attachIdentity,
    requireMember,
    requireAdmin,
    requireMemberPage,
    requireAdminPage,
    protectStaticPages,
    generation,
};



