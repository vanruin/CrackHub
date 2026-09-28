const fs = require('fs').promises;
const path = require('path');

const ACCOUNTS_DIR = path.join(__dirname, '..', 'public', 'Acccounts');

const SERVICE_FILES = {
    netflix:      { file: 'nft.json',        type: 'json', mode: 'cookie', label: 'Netflix (cookie)' },
    capcut:       { file: 'capcut.txt',      type: 'txt',  label: 'CapCut' },
    crunchyroll:  { file: 'crunchyroll.txt', type: 'txt',  label: 'Crunchyroll' },
    disney:       { file: 'disney.txt',      type: 'txt',  label: 'Disney+' },
    paramount:    { file: 'paramount.txt',   type: 'txt',  label: 'Paramount+' },
    garena:       { file: 'garena.txt',      type: 'txt',  label: 'Garena' },
    moonton:      { file: 'moonton.txt',     type: 'txt',  label: 'Moonton (MLBB)' },
    xbox:         { file: 'xbox.txt',        type: 'txt',  label: 'Xbox Game Pass' },
    steam:        { file: 'Steam.json',      type: 'json', label: 'Steam' },
};

const EMAIL_RE = /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/;

const SEP_NAMES = {
    '\t': 'tab',
    '|': 'pipe',
    ':': 'colon',
    ';': 'semicolon',
    ',': 'comma',
    ' ': 'space',
};

function detectSeparator(line) {
    if (line.includes('\t')) return { sep: '\t', name: 'tab' };
    if (line.includes('|'))  return { sep: '|',  name: 'pipe' };
    if (line.includes(':'))  return { sep: ':',  name: 'colon' };
    if (line.includes(';'))  return { sep: ';',  name: 'semicolon' };
    if (line.includes(','))  return { sep: ',',  name: 'comma' };
    if (/\S+\s+\S+/.test(line)) return { sep: ' ', name: 'space' };
    return null;
}

/**
 * Escape a single separator character so it can be embedded in a RegExp character class.
 */
function escapeSeparator(sep) {
    return sep.replace(/[.*+?^${}()|[\]\\/\-]/g, '\\$&');
}

/**
 * Split on one-or-more consecutive separators ("email::pass", "email||pass") and drop empties.
 */
function splitBySeparator(value, sep) {
    return value
        .split(new RegExp(`[${escapeSeparator(sep)}]+`))
        .map(p => p.trim())
        .filter(Boolean);
}

function detectCredentialSeparator(line) {
    const emailMatch = line.match(EMAIL_RE);
    if (emailMatch) {
        const after = line.substring(emailMatch.index + emailMatch[1].length);
        if (!after) return null;
        const sepMatch = after.match(/^([^\w\s]|[\s]+)/);
        if (sepMatch) {
            const rawSep = sepMatch[1];
            if (rawSep.includes('\t')) return { sep: '\t', name: 'tab' };
            if (rawSep.trim() === '') return { sep: ' ', name: 'space' };
            return { sep: rawSep, name: SEP_NAMES[rawSep] || 'unknown' };
        }
    }
    return detectSeparator(line);
}

// ---------- Cookie jar support (Netflix, HBO, any cookie-based service) ----------

/** Cookie names that matter for a Netflix session. */
const NETFLIX_COOKIE_NAMES = ['NetflixId', 'SecureNetflixId', 'nfvdid'];

/** Object keys that are kept when a nft.json style record is written back to disk. */
const NETFLIX_FIELD_KEYS = [
    'country', 'MaxStreams', 'Since', 'phone', 'streams', 'profiles', 'plan',
    'paymentMethod', 'extra', 'expires', 'quality', 'price', 'nextBilling', 'holdStatus',
];

/** Cookie attributes that must never be treated as cookies themselves. */
const COOKIE_ATTRIBUTES = new Set([
    'path', 'domain', 'expires', 'max-age', 'maxage', 'samesite', 'secure', 'httponly',
    'priority', 'version', 'comment', 'commenturl', 'discard', 'port', 'hostonly', 'session',
]);

const COOKIE_MARKER_RE = /(NetflixId|SecureNetflixId|nfvdid)\s*=/i;
const NETFLIX_HINT_RE = /netflix/i;

/**
 * "email:pass | Country: BR | Plan: Premium | Screens: 4 | Phone: … | cookies" tickets
 * label every metadata field — map those labels onto nft.json field names.
 */
const TICKET_FIELD_KEYS = {
    country: 'country',
    plan: 'plan',
    screens: 'MaxStreams',
    screen: 'MaxStreams',
    maxstreams: 'MaxStreams',
    maxstream: 'MaxStreams',
    streams: 'streams',
    profiles: 'profiles',
    paymentmethod: 'paymentMethod',
    payment: 'paymentMethod',
    extra: 'extra',
    phone: 'phone',
    telephone: 'phone',
    phonenumber: 'phone',
    since: 'Since',
    expires: 'expires',
    expiry: 'expires',
};

/** Label values that mean "nothing here" and should not be stored. */
const NEGATIVE_FIELD_RE = /^(no|none|null|n\/a|na|-|não|nao|nenhum|nenhuma)$/i;

/**
 * Some dumps glue a token blob to the front of an e-mail:
 *   "+W1OhUFuj2J03NzZklucaslopes0307@icloud.com:tereza92"
 * Returns the cleaned login plus how many leading characters belong to the previous
 * block (a glued cookie/token continuation), so cookie values stay complete.
 */
function analyseEmail(rawEmail) {
    const email = String(rawEmail == null ? '' : rawEmail).trim();
    const result = { email, carry: 0 };

    const at = email.lastIndexOf('@');
    if (at <= 0) return result;

    const local = email.slice(0, at);
    const domain = email.slice(at);
    if (local.length < 24) return result;   // normal logins are never touched

    // Lazy blob + name-like tail: "<junk><name>" → keep the name
    const match = local.match(/^([A-Za-z0-9+._%\-]{8,}?)([a-z][a-z0-9._-]{3,})$/);
    if (!match) return result;

    const blob = match[1];
    const tail = match[2];
    // Only trim when the prefix really looks like glued token junk (mixed case + digits)
    if (!/[A-Z]/.test(blob) || !/[0-9]/.test(blob) || tail.length < 5) return result;

    // The leading part that is a valid cookie-value continuation belongs to the previous block
    const firstInvalid = blob.search(/[^A-Za-z0-9_-]/);
    result.email = tail + domain;
    result.carry = firstInvalid === -1 ? blob.length : firstInvalid;

    return result;
}

/** Cleaned login only (keeps signature compatible with plain string use). */
function cleanEmail(rawEmail) {
    return analyseEmail(rawEmail).email;
}

/** Pull the "email:password" pair out of a ticket's first segment. */
function parseEmailPasswordPair(segment) {
    const match = String(segment).match(EMAIL_RE);
    if (!match) return null;
    const username = cleanEmail(match[1]);
    const rest = String(segment)
        .substring(match.index + match[1].length)
        .replace(/^\s*/, '');
    if (!rest) return { username, password: '' };
    const cleaned = rest.replace(/^[\s:|,;]+/, '').trim();
    // A password never carries the cookie metadata terminator
    const password = cleaned.split('|')[0].trim();
    return { username, password };
}

/** Line splitting that works for LF, CRLF and lone-CR files. */
function splitLines(text) {
    return String(text == null ? '' : text).split(/\r\n|\r|\n/);
}

/**
 * Split any text into account blocks, each block starting at an e-mail address.
 * This works no matter how the entries are separated: new lines, lone CR, or a
 * whole dump pasted as a single line ("…cookies;next@mail.com:pass | …").
 */
function splitChunksByEmail(text) {
    const src = String(text == null ? '' : text);
    const re = new RegExp(EMAIL_RE.source, 'gi');
    const starts = [];

    let match;
    while ((match = re.exec(src)) !== null) {
        // A glued token tail stays with the previous block; only the login itself moves
        const analysed = analyseEmail(match[0]);
        starts.push(match.index + analysed.carry);
        if (match.index === re.lastIndex) re.lastIndex++;
    }

    if (starts.length === 0) return [{ text: src, raw: src }];

    const chunks = [];
    if (starts[0] > 0) chunks.push({ text: '', raw: src.slice(0, starts[0]) });

    for (let i = 0; i < starts.length; i++) {
        const end = i + 1 < starts.length ? starts[i + 1] : src.length;
        const piece = src.slice(starts[i], end);
        chunks.push({ text: piece, raw: piece });
    }

    return chunks;
}

/**
 * Parse the "head" of a Netflix ticket (everything before the cookies):
 *   "email:pass | Country: BR | Plan: Premium | Screens: 4 | Phone: (15) 99821-6470"
 * Fields may also be split across several lines instead of pipes.
 */
function parseTicketHead(head) {
    const meta = {};
    const segments = String(head).split(/[|\r\n]+/).map(s => s.trim()).filter(Boolean);

    segments.forEach((segment, index) => {
        const labelled = segment.match(/^([A-Za-z][A-Za-z0-9 _%.-]*?)\s*:\s*(.+)$/);
        if (labelled) {
            const key = labelled[1].toLowerCase().replace(/[\s_\-]+/g, '');
            const value = labelled[2].trim();
            if (TICKET_FIELD_KEYS[key]) {
                if (value && !NEGATIVE_FIELD_RE.test(value)) {
                    meta[TICKET_FIELD_KEYS[key]] = value;
                }
                return;
            }
        }

        if (index === 0) {
            const creds = parseEmailPasswordPair(segment);
            if (creds) {
                meta.username = creds.username;
                if (creds.password) meta.password = creds.password;
            }
        }
    });

    return meta;
}

/**
 * Parse one Netflix "ticket" block:
 *   email:pass | Country: BR | Plan: Premium | Screens: 4 | Extra: No |
 *   Phone: (15) 99821-6470 | SecureNetflixId=…; NetflixId=…; nfvdid=…;
 * Every cookie in the block is kept (NetflixId, SecureNetflixId, nfvdid, …).
 * Returns null when the block is a plain cookie dump / Netscape row (no credentials).
 */
function parseNetflixTicketLine(block) {
    const raw = String(block || '').trim();
    if (!raw || !COOKIE_MARKER_RE.test(raw)) return null;

    const markerIndex = raw.search(COOKIE_MARKER_RE);
    const head = markerIndex > 0 ? raw.slice(0, markerIndex).replace(/[|;,\s]+$/, '').trim() : '';
    const cookieText = markerIndex > 0 ? raw.slice(markerIndex) : raw;

    // Bare dumps ("NetflixId=…; SecureNetflixId=…") and Netscape rows have no credential head
    if (!head || (!EMAIL_RE.test(head) && !head.includes('|'))) return null;

    const pairs = parseCookieString(cookieText);
    if (pairs.length === 0) return null;

    const meta = parseTicketHead(head);
    const account = buildCookieAccount(pairs, meta);
    if (!account) return null;

    if (meta.username && !account.username) account.username = String(meta.username).trim();
    if (meta.password && !account.password) account.password = String(meta.password).trim();

    return account;
}

/**
 * Split a cookie dump into account tickets (credentials + metadata + cookies, one per
 * e-mail) and everything else (Netscape rows, bare cookie dumps) which goes to the jar parser.
 */
function parseCookieSection(text) {
    const tickets = [];
    const other = [];

    for (const chunk of splitChunksByEmail(text)) {
        // Anything before the first e-mail (Netscape rows, bare dumps, comments)
        if (!chunk.text.trim()) {
            other.push(chunk.raw);
            continue;
        }

        // Netscape cookie rows are jar material, never part of a ticket
        const kept = [];
        for (const line of splitLines(chunk.text)) {
            const netscape = parseNetscapeCookieLine(line);
            if (netscape && NETFLIX_HINT_RE.test(netscape.domain)) other.push(line);
            else kept.push(line);
        }

        // No cookie material at all → plain credentials, picked up by the caller
        if (!COOKIE_MARKER_RE.test(chunk.text)) continue;

        const ticket = parseNetflixTicketLine(kept.join('\n'));
        if (ticket) {
            tickets.push(ticket);
            continue;
        }

        // Cookies without usable credentials (bare dump) → jar parser
        if (kept.join('').trim()) other.push(kept.join('\n'));
    }

    // De-duplicate tickets by cookie identity
    const unique = [];
    const seen = new Set();
    for (const ticket of tickets) {
        const key = cookieKeyFromPairs(parseCookieString(ticket.cookie));
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ticket);
    }

    if (unique.length === 0) {
        return { accounts: parseCookieAccounts(text), format: 'cookie' };
    }

    // Everything that is not a ticket still goes through the cookie-jar parser
    // (Netscape rows contain no "name=value", so they must not be filtered by a marker test)
    const jarText = other.join('\n').trim();
    const jars = jarText ? parseCookieAccounts(jarText) : [];

    return { accounts: [...unique, ...jars], format: 'netflix-ticket' };
}

// ---------- Steam dumps: "user:pass | 76561199843954621 | 4 (Game, Game) | By: @seller" ----------

/** Steam line marker: credentials followed by a 16-18 digit SteamID64. */
const STEAM_LINE_RE = /^[^\s|][^|\n]*:[^|\n]*\s*\|\s*\d{16,18}\s*\|/m;

/**
 * Parse one Steam dump line:
 *   gagzq46182:ljdgr12474 | 76561199843954621 | 4 (Metro 2033 Redux, Rust) | By: @tifadz
 */
function parseSteamLine(line) {
    const raw = String(line || '').trim();
    if (!raw) return null;

    const parts = raw.split('|').map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    // "username:password" (the password itself may contain a colon)
    const colon = parts[0].indexOf(':');
    if (colon <= 0) return null;

    const account = {
        username: parts[0].slice(0, colon).trim(),
        password: parts[0].slice(colon + 1).trim(),
        games: [],
    };
    if (!account.username || !account.password) return null;

    for (const part of parts) {
        const steamId = part.match(/\b(\d{16,18})\b/);
        if (steamId) { account.steamid = steamId[1]; break; }
    }

    // "4 (Metro 2033 Redux, Rust)" — the count sits in front of the parenthesised list
    const listSegment = parts.find(part => part.indexOf('(') !== -1) || '';
    if (listSegment) {
        const count = listSegment.match(/^(\d+)\s*\(/);
        if (count) account.gameCount = count[1];

        const open = listSegment.indexOf('(');
        const close = listSegment.lastIndexOf(')');
        if (close > open) {
            account.games = listSegment
                .slice(open + 1, close)
                .split(',')
                .map(game => game.trim())
                .filter(Boolean);
        }
    }

    // "By: @tifadz" (the label may sit anywhere in the line)
    for (const part of parts) {
        const seller = part.match(/^by\s*:?\s*@?(.+)$/i);
        if (seller) { account.seller = seller[1].trim().replace(/^@/, ''); break; }
    }

    account.status = 'active';
    return account;
}

/** Parse a whole Steam dump — one account per line. */
function parseSteamDump(text) {
    const accounts = [];
    const seen = new Set();

    for (const rawLine of splitLines(text)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        const account = parseSteamLine(line);
        if (!account) continue;

        const key = account.username.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        accounts.push(account);
    }

    return accounts;
}

// ---------- "Netflix Token Results" reports (HIT #n blocks) ----------

/** Report text markers: "HIT #1", "Account Details:", "• Email:" */
const REPORT_MARKER_RE = /HIT\s*#\d+|Account Details\s*:|(?:^|\n)\s*[•*\-]?\s*Email\s*:\s*\S+@/i;

/** Bullet labels used by those reports → nft.json field names. */
const REPORT_FIELD_KEYS = {
    email: 'username',
    country: 'country',
    plan: 'plan',
    price: 'price',
    membersince: 'Since',
    nextbilling: 'nextBilling',
    payment: 'paymentMethod',
    phone: 'phone',
    quality: 'quality',
    streams: 'MaxStreams',
    holdstatus: 'holdStatus',
    extramember: 'extra',
    profiles: 'profiles',
    expires: 'expires',
    expiresat: 'expires',
};

/** Cookie labels that may appear on their own bullet instead of a "Cookie:" line. */
const REPORT_COOKIE_KEYS = {
    netflixid: 'NetflixId',
    securenetflixid: 'SecureNetflixId',
    nfvdid: 'nfvdid',
};

/** "phone", "member since", "Next_Billing" → "phone", "membersince", "nextbilling" */
function normalizeLabel(label) {
    return String(label || '').toLowerCase().replace(/[\s_.\-]+/g, '');
}

/** Reports append a status to the phone: "+542975379425 (No)" → "+542975379425" */
function cleanPhone(value) {
    const raw = String(value == null ? '' : value).trim();
    const match = raw.match(/^([+()\d][\d\s().\-]*?)\s*\([^)]*\)\s*$/);
    return match ? match[1].trim() : raw;
}

/**
 * Parse one HIT block of a "Netflix Token Results" report:
 *   • Email: user@mail.com      • Country: AR      • Plan: Básico
 *   • Streams: 1                • Member Since: …  • Cookie: NetflixId=…
 *   🔑 Login Link: https://www.netflix.com/login?nftoken=…
 */
function parseNetflixReportBlock(block) {
    const meta = {};
    const cookies = {};
    let cookieLine = '';
    let loginUrl = '';
    let seenEmail = false;

    for (const rawLine of splitLines(block)) {
        const line = rawLine.trim();
        if (!line) continue;

        // Login links ("🖥️ PC Login:    https://…")
        const urlMatch = line.match(/https?:\/\/\S+/);
        if (urlMatch) {
            const label = normalizeLabel(line.slice(0, urlMatch.index));
            if (label.includes('loginlink') || label.includes('loginurl') || !loginUrl) {
                loginUrl = urlMatch[0];
            }
            continue;
        }

        // "• Key: value" / "* Key: value" / "Key: value"
        const bullet = line.match(/^(?:[•*\-]|\d+[.)])?\s*([A-Za-z][A-Za-z0-9 /_%.\-]*?)\s*:\s*(.+)$/);
        if (!bullet) continue;

        const key = normalizeLabel(bullet[1]);
        const value = bullet[2].trim();
        if (!value) continue;

        if (key === 'email') seenEmail = true;
        // Header lines that come after the e-mail belong to the next HIT block
        if (seenEmail && (key === 'expires' || key === 'expiresat' || key === 'generated' || key === 'remaining')) continue;

        if (key === 'cookie') { cookieLine = value; continue; }
        if (REPORT_COOKIE_KEYS[key]) { cookies[REPORT_COOKIE_KEYS[key]] = value; continue; }

        const field = REPORT_FIELD_KEYS[key];
        if (!field) continue;                       // Generated / Remaining / Total Checked
        meta[field] = field === 'phone' ? cleanPhone(value) : value;
    }

    if (!meta.username) return null;

    let pairs = parseCookieString(cookieLine);
    if (pairs.length === 0 && Object.keys(cookies).length > 0) {
        pairs = Object.entries(cookies).map(([name, value]) => ({ name, value }));
    }
    if (pairs.length === 0) return null;

    const account = buildCookieAccount(pairs, { ...meta, loginUrl });
    if (!account) return null;
    if (meta.username && !account.username) account.username = String(meta.username).trim();

    return account;
}

/**
 * Split a report into blocks: a block starts at its "• Email: …" bullet,
 * so the bullet (and its e-mail) stays with the right account.
 * Falls back to the "HIT #n" banners when the e-mail bullet is missing.
 */
function splitReportBlocks(text) {
    const src = String(text == null ? '' : text);

    const collect = re => {
        const out = [];
        let m;
        while ((m = re.exec(src)) !== null) out.push(m.index);
        return out;
    };

    const slice = starts => starts.map(
        (start, i) => src.slice(start, i + 1 < starts.length ? starts[i + 1] : src.length)
    );

    // "HIT #n" banners give the cleanest boundaries: the block also holds Expires/Remaining
    const banners = collect(/^[^\S\n]*=+[^\n]*HIT[^\n]*=+[^\n]*$/gim);
    if (banners.length > 0) return slice(banners);

    // Otherwise every block starts at its own "• Email: …" bullet
    const emailStarts = collect(/^[^\S\n]*(?:[•*\-]|\d+[.)])?[^\S\n]*Email[^\S\n]*:[^\S\n]*\S+@\S+.*$/gim);
    return slice(emailStarts);
}

/** Parse a whole "Netflix Token Results" report — one account per HIT block. */
function parseNetflixReport(text) {
    const accounts = [];
    for (const block of splitReportBlocks(text)) {
        const account = parseNetflixReportBlock(block);
        if (account) accounts.push(account);
    }
    return accounts;
}

/** Does this text look like a cookie dump rather than a credentials list? */
function isCookieLikeText(text) {
    if (!text || typeof text !== 'string') return false;
    if (COOKIE_MARKER_RE.test(text)) return true;
    // Netscape cookie file rows are TAB separated and mention the domain
    if (text.includes('\t') && NETFLIX_HINT_RE.test(text)) return true;
    return false;
}

/** Can this name be a cookie name (and not an attribute such as Path/Domain)? */
function looksLikeCookieName(name) {
    if (!name) return false;
    return /^[A-Za-z0-9_%.\-]+$/.test(name) && !COOKIE_ATTRIBUTES.has(name.toLowerCase());
}

/**
 * Parse any cookie string into name/value pairs.
 * Handles: "a=1; b=2", "Cookie: a=1; b=2", "Set-Cookie: a=1; Path=/; Domain=.netflix.com"
 */
function parseCookieString(str) {
    const pairs = [];
    if (!str) return pairs;
    for (const chunk of String(str).split(/[;\n]/)) {
        const part = chunk.trim().replace(/^cookie:\s*/i, '').replace(/^set-cookie:\s*/i, '');
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim().replace(/^["']/, '').replace(/["']$/, '');
        if (!name || !value || !looksLikeCookieName(name)) continue;
        pairs.push({ name, value });
    }
    return pairs;
}

/**
 * Netscape / curl cookie-file row: domain \t flag \t path \t secure \t expiry \t name \t value
 */
function parseNetscapeCookieLine(line) {
    const parts = String(line).split('\t');
    if (parts.length < 7) return null;
    const name = parts[5].trim();
    const value = parts[6].trim();
    if (!name || !value) return null;
    return {
        name,
        value,
        domain: parts[0].replace(/^#HttpOnly_/, '').trim(),
        path: parts[2].trim(),
        secure: parts[3].trim(),
        expiration: parts[4].trim(),
    };
}

/** Stable identity for a cookie set — used for duplicate detection. */
function cookieKeyFromPairs(pairs) {
    const id = pairs.find(p => p.name === 'NetflixId');
    if (id) return `NetflixId:${id.value}`;
    const secure = pairs.find(p => p.name === 'SecureNetflixId');
    if (secure) return `SecureNetflixId:${secure.value}`;
    const vdid = pairs.find(p => p.name === 'nfvdid');
    if (vdid) return `nfvdid:${vdid.value}`;
    return pairs.map(p => `${p.name}=${p.value}`).join('&');
}

/** Fingerprint of a raw cookie string ("a=1; b=2") — used to skip duplicate dumps. */
function cookieIdentity(cookie) {
    return cookieKeyFromPairs(parseCookieString(cookie));
}

/**
 * Build one account object from a set of cookie pairs.
 * Returns null when the set holds no recognisable Netflix cookie.
 */
function buildCookieAccount(pairs, meta = {}) {
    const clean = [];
    const seen = new Set();
    for (const pair of pairs || []) {
        if (!pair || !pair.name) continue;
        if (!looksLikeCookieName(pair.name) || seen.has(pair.name)) continue;
        const value = pair.value == null ? '' : String(pair.value).trim();
        if (!value) continue;
        seen.add(pair.name);
        clean.push({ name: pair.name, value });
    }

    if (!clean.some(p => NETFLIX_COOKIE_NAMES.includes(p.name))) return null;

    clean.sort((a, b) => {
        const ai = NETFLIX_COOKIE_NAMES.indexOf(a.name);
        const bi = NETFLIX_COOKIE_NAMES.indexOf(b.name);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const account = {
        username: String(meta.username || meta.email || '').trim(),
        password: String(meta.password || '').trim(),
        extra: meta.extra ? String(meta.extra).trim() : undefined,
        cookie: clean.map(p => `${p.name}=${p.value}`).join('; '),
    };
    if (meta.loginUrl) account.loginUrl = String(meta.loginUrl).trim();

    const fields = {};
    for (const key of NETFLIX_FIELD_KEYS) {
        if (meta[key] != null && meta[key] !== '') fields[key] = meta[key];
    }
    if (Object.keys(fields).length) account.fields = fields;

    return account;
}

/** Turn groups of cookie pairs into de-duplicated account objects. */
function accountsFromCookiePairs(groups) {
    const accounts = [];
    const seen = new Set();

    for (const pairs of groups) {
        if (!pairs || pairs.length === 0) continue;
        const ids = pairs.filter(p => p.name === 'NetflixId');
        const others = pairs.filter(p => p.name !== 'NetflixId');
        // A jar that holds several NetflixId values is really several accounts
        const sets = ids.length > 1 ? ids.map(id => [id, ...others]) : [pairs];

        for (const set of sets) {
            const account = buildCookieAccount(set);
            if (!account) continue;
            const key = cookieKeyFromPairs(parseCookieString(account.cookie));
            if (seen.has(key)) continue;
            seen.add(key);
            accounts.push(account);
        }
    }

    return accounts;
}

/**
 * Pull email/password metadata out of a cookie dump line, e.g.
 * "user@mail.com:MyPass NetflixId=...; SecureNetflixId=..."
 */
function extractLineMeta(line) {
    const meta = {};
    const match = line.match(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\s*[:|,;\s]\s*([^\s;|,]+)/);
    if (match) {
        meta.username = cleanEmail(match[1]);
        const candidate = match[2];
        if (candidate && !candidate.includes('=')) meta.password = candidate;
    } else {
        const emailOnly = line.match(EMAIL_RE);
        if (emailOnly) meta.username = cleanEmail(emailOnly[1]);
    }
    return meta;
}

/**
 * Parse Netflix cookie dumps in any of these shapes:
 *  - "NetflixId=...; SecureNetflixId=...; nfvdid=..."
 *  - Netscape cookie file rows (TAB separated, one cookie per line)
 *  - "Cookie: NetflixId=...; ..." copied headers
 *  - several dumps separated by blank lines (one account each)
 */
function parseCookieAccounts(text, sharedMeta = {}) {
    if (!text || typeof text !== 'string') return [];

    const groups = [];
    let jar = [];
    const flushJar = () => {
        if (jar.length) {
            groups.push(jar);
            jar = [];
        }
    };

    for (const rawLine of splitLines(text)) {
        const line = rawLine.trim();
        if (!line) { flushJar(); continue; }

        const netscape = parseNetscapeCookieLine(rawLine);
        if (netscape && NETFLIX_HINT_RE.test(netscape.domain)) {
            jar.push(netscape);
            continue;
        }

        // Real Netscape files use "#HttpOnly_.netflix.com" — only skip plain comments
        if (/^#/.test(line) || /^\/\//.test(line)) continue;

        flushJar();
        // Metadata (email, country, plan, …) can sit in front of the cookie pairs — keep cookies only
        const markerIndex = line.search(COOKIE_MARKER_RE);
        const cookieLine = markerIndex > 0 ? line.slice(markerIndex) : line;
        const pairs = parseCookieString(cookieLine);
        if (pairs.length) groups.push(pairs);
    }
    flushJar();

    const accounts = accountsFromCookiePairs(groups);
    if (accounts.length === 0) return [];

    // Attach email/password found in the dump (only meaningful for a single account)
    if (accounts.length === 1) {
        const meta = { ...extractLineMeta(text), ...sharedMeta };
        if (meta.username && !accounts[0].username) accounts[0].username = String(meta.username).trim();
        if (meta.password && !accounts[0].password) accounts[0].password = String(meta.password).trim();
    }

    return accounts;
}

/** Short, safe display form of a cookie (never dump the whole value in a preview). */
function maskCookiePreview(cookie) {
    if (!cookie) return '';
    const pairs = parseCookieString(cookie);
    const id = pairs.find(p => p.name === 'NetflixId');
    if (id) return `NetflixId=${id.value.slice(0, 12)}… (${pairs.length} cookies)`;
    return String(cookie).slice(0, 24) + '…';
}

function parseJsonAccounts(data) {
    const accounts = [];

    const normalize = (item) => {
        if (typeof item === 'string') {
            return parseTextLine(item);
        }
        if (Array.isArray(item)) {
            if (typeof item[0] === 'string' && typeof item[1] === 'string') {
                return {
                    username: item[0].trim(),
                    password: item[1].trim(),
                    extra: item.slice(2).map(String).filter(Boolean).join(',') || undefined,
                };
            }
            return null;
        }
        if (item && typeof item === 'object') {
            const username = item.email || item.username || item.user || item.login || item.id || item.account;
            const password = item.password || item.pass || item.pwd || item.secret || item.token;
            const extraKeys = ['extra', 'notes', 'info', 'country', 'game', 'games', 'level', 'rank', 'uid'];
            const extra = extraKeys.find(k => item[k] != null);

            // Anything carrying cookies counts as a cookie account (nft.json records, {cookie}, {NetflixId})
            let cookie = null;
            const rawCookie = item.cookie || item.cookies || item.cookieString || item.cookie_string;
            if (typeof rawCookie === 'string') {
                const built = buildCookieAccount(parseCookieString(rawCookie), item);
                cookie = built ? built.cookie : null;
            } else if (Array.isArray(rawCookie)) {
                const built = accountsFromCookiePairs([
                    rawCookie.map(c => ({ name: c && (c.name || c.key), value: c && c.value })),
                ]);
                cookie = built.length ? built[0].cookie : null;
            } else {
                const netflixPairs = NETFLIX_COOKIE_NAMES
                    .filter(name => typeof item[name] === 'string' && item[name])
                    .map(name => ({ name, value: item[name] }));
                if (netflixPairs.length) {
                    const built = buildCookieAccount(netflixPairs);
                    cookie = built ? built.cookie : null;
                }
            }

            if (!username && !password && !cookie) return null;
            if (!password && !cookie) return null; // a record needs at least one secret

            const account = {
                username: username ? String(username).trim() : '',
                password: password ? String(password).trim() : '',
                extra: extra ? String(item[extra]).trim() : undefined,
            };

            if (cookie) {
                account.cookie = cookie;
                const fields = {};
                for (const key of NETFLIX_FIELD_KEYS) {
                    if (item[key] != null && item[key] !== '') fields[key] = item[key];
                }
                if (Object.keys(fields).length) account.fields = fields;
            }

            return account;
        }
        return null;
    };

    let list;
    if (Array.isArray(data)) {
        list = data;
    } else if (data && typeof data === 'object' && (Array.isArray(data.accounts) || Array.isArray(data.data))) {
        list = data.accounts || data.data;
    } else {
        list = [data];
    }

    // Cookie-Editor / EditThisCookie export: [{name, value, domain, ...}, ...]
    const cookieJarItems = list.filter(
        it => it && typeof it === 'object' && typeof it.name === 'string' && typeof it.value === 'string'
    );
    if (cookieJarItems.length > 0 && cookieJarItems.length === list.length) {
        const netflixItems = cookieJarItems.filter(c => NETFLIX_HINT_RE.test(String(c.domain || '')));
        const source = netflixItems.length ? netflixItems : cookieJarItems;
        const cookieAccounts = accountsFromCookiePairs([
            source.map(c => ({ name: c.name, value: String(c.value) })),
        ]);
        if (cookieAccounts.length) {
            return { format: 'cookie', accounts: cookieAccounts };
        }
    }

    for (const item of list) {
        const acc = normalize(item);
        if (acc) accounts.push(acc);
    }

    const hasCookies = accounts.some(a => a.cookie);
    return { format: hasCookies ? 'cookie' : 'json', accounts };
}

function parseTextLine(line) {
    line = line.trim();
    if (!line) return null;
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith('---')) return null;
    // Bare URLs are never credentials
    if (/^https?:\/\//i.test(line) && !line.includes('@')) return null;

    const emailMatch = line.match(EMAIL_RE);

    if (emailMatch) {
        const username = cleanEmail(emailMatch[1]);
        let afterEmail = line.substring(emailMatch.index + emailMatch[1].length).trim();

        if (!afterEmail) {
            return { username, password: '', extra: undefined };
        }

        // Handle " | " as an extra-field delimiter (common in moonton-style format)
        // e.g. email:pass | Level 10 | Region EU
        if (afterEmail.includes(' | ')) {
            const pipeIdx = afterEmail.indexOf(' | ');
            const credPart = afterEmail.substring(0, pipeIdx);
            const extraPart = afterEmail.substring(pipeIdx + 3).trim();

            const credSep = credPart.match(/^([^\w\s])/);
            let password = credPart;
            if (credSep) {
                password = credPart.substring(1).trim();
            }

            return {
                username,
                password: password || '',
                extra: extraPart || undefined,
            };
        }

        const sepMatch = afterEmail.match(/^([^\w\s]|[\s]+)/);
        if (!sepMatch) {
            return { username, password: afterEmail, extra: undefined };
        }

        const separator = sepMatch[1];
        let rest = afterEmail.substring(separator.length);

        if (separator.trim() === '') {
            const tokens = rest.split(/\s+/).filter(Boolean);
            return {
                username,
                password: tokens[0] || '',
                extra: tokens.slice(1).join(' ') || undefined,
            };
        }

        const parts = splitBySeparator(rest, separator);
        if (parts.length === 0) return null;
        return {
            username,
            password: parts[0] || '',
            extra: parts.slice(1).join(separator) || undefined,
        };
    }

    // No email — try generic separator detection (username:password)
    const detected = detectSeparator(line);
    if (!detected) return null;

    if (detected.name === 'space') {
        const tokens = line.split(/\s+/).filter(Boolean);
        if (tokens.length < 2) return null;
        return {
            username: tokens[0],
            password: tokens[1],
            extra: tokens.slice(2).join(' ') || undefined,
        };
    }

    const parts = splitBySeparator(line, detected.sep);
    if (parts.length < 2) return null;

    return {
        username: parts[0],
        password: parts[1],
        extra: parts.slice(2).join(detected.sep) || undefined,
    };
}

function parseAccounts(text) {
    if (!text || typeof text !== 'string') {
        return { format: 'none', count: 0, accounts: [], rawFormat: 'empty-input' };
    }

    const trimmed = text.trim();
    if (!trimmed) {
        return { format: 'none', count: 0, accounts: [], rawFormat: 'empty-input' };
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            const result = parseJsonAccounts(parsed);
            return {
                format: result.format,
                count: result.accounts.length,
                accounts: result.accounts,
                rawFormat: 'json',
            };
        } catch (e) {
            // Not valid JSON — fall through to text parsing
        }
    }

    const lines = splitLines(trimmed).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
        return { format: 'none', count: 0, accounts: [], rawFormat: 'no-lines' };
    }

    // Steam dumps: "user:pass | 76561199843954621 | 4 (Game, Game) | By: @seller"
    if (STEAM_LINE_RE.test(trimmed)) {
        const steamAccounts = parseSteamDump(trimmed);
        if (steamAccounts.length > 0) {
            return {
                format: 'steam-dump',
                count: steamAccounts.length,
                accounts: steamAccounts,
                rawFormat: 'steam',
            };
        }
    }

    // Netflix "Token Results" reports (HIT #n blocks with bullet fields + login links)
    if (REPORT_MARKER_RE.test(trimmed)) {
        const reportAccounts = parseNetflixReport(trimmed);
        if (reportAccounts.length > 0) {
            return {
                format: 'netflix-report',
                count: reportAccounts.length,
                accounts: reportAccounts,
                rawFormat: 'report',
            };
        }
    }

    // Cookie material wins: tickets (credentials + metadata + cookies) or Netscape/jar dumps
    if (isCookieLikeText(trimmed)) {
        const section = parseCookieSection(trimmed);
        if (section.accounts.length > 0) {
            // Pick up plain "email:password" lines mixed into the same file — but never
            // re-add an e-mail that already produced an account (multi-line tickets)
            const known = new Set(
                section.accounts
                    .map(acc => String(acc.username || '').trim().toLowerCase())
                    .filter(Boolean)
            );
            const extra = [];
            for (const line of lines) {
                if (COOKIE_MARKER_RE.test(line) || !line.includes('@')) continue;
                const parsed = parseTextLine(line);
                if (!parsed || !parsed.password) continue;
                const login = String(parsed.username || '').trim().toLowerCase();
                if (!login || known.has(login)) continue;
                known.add(login);
                extra.push(parsed);
            }

            const accounts = [...section.accounts, ...extra];
            return {
                format: section.format,
                count: accounts.length,
                accounts,
                rawFormat: 'cookie',
            };
        }
    }

    const firstValid = lines.find(l => !l.startsWith('#') && !l.startsWith('//')) || lines[0];
    const credSep = detectCredentialSeparator(firstValid) || { name: 'colon', sep: ':' };

    const accounts = [];
    for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('//') || line.startsWith('---')) continue;
        const parsed = parseTextLine(line);
        if (parsed) accounts.push(parsed);
    }

    return {
        format: credSep.name,
        count: accounts.length,
        accounts,
        rawFormat: credSep.name,
    };
}

/** nft.json record shape read by backend/netflix.js (email/password/country/…/cookie). */
function formatNetflixRecord(account) {
    const fields = account.fields || {};
    const record = {
        email: account.username || '',
        password: account.password || '',
    };

    if (fields.country) record.country = fields.country;
    if (fields.MaxStreams != null && fields.MaxStreams !== '') record.MaxStreams = String(fields.MaxStreams);
    if (fields.Since) record.Since = fields.Since;
    if (fields.phone) record.phone = fields.phone;
    if (fields.plan) record.plan = fields.plan;
    if (fields.paymentMethod) record.paymentMethod = fields.paymentMethod;
    if (fields.quality) record.quality = fields.quality;
    if (fields.price) record.price = fields.price;
    if (fields.profiles) record.profiles = fields.profiles;
    if (fields.holdStatus) record.holdStatus = fields.holdStatus;
    if (fields.extra) record.extra = fields.extra;
    if (fields.nextBilling) record.nextBilling = fields.nextBilling;
    if (fields.expires) record.expires = fields.expires;
    if (account.loginUrl) record.loginUrl = account.loginUrl;
    if (account.cookie) record.cookie = account.cookie;

    return record;
}

/** Steam.json record shape read by backend/steam.js. */
function formatSteamRecord(account) {
    const rawGames = account.games || (account.fields && account.fields.games);
    const games = Array.isArray(rawGames)
        ? rawGames.map(g => String(g).trim()).filter(Boolean)
        : (typeof rawGames === 'string' ? rawGames.split(',').map(g => g.trim()).filter(Boolean) : []);

    const record = {
        username: account.username || '',
        password: account.password || '',
    };
    if (account.steamid) record.steamid = String(account.steamid);
    if (account.gameCount != null && account.gameCount !== '') record.gameCount = String(account.gameCount);
    if (games.length) record.games = games;
    if (account.seller) record.seller = account.seller;
    record.status = account.status || 'active';

    return record;
}

function formatForFile(account, serviceType, service) {
    if (serviceType === 'json') {
        // Steam keeps username/password/games, cookie services keep the nft.json layout
        if (service === 'steam' || account.steamid || account.seller) return formatSteamRecord(account);
        if (service === 'netflix' || account.cookie) return formatNetflixRecord(account);
        return {
            username: account.username,
            password: account.password,
            games: [],
            status: 'active',
        };
    }
    return `${account.username}:${account.password}`;
}

function formatDetected(account) {
    const parts = [account.username, account.password];
    if (account.extra) parts.push(account.extra);
    return parts.join(' | ');
}

async function getAccountCount(service) {
    const config = SERVICE_FILES[service];
    if (!config) return 0;

    const filePath = path.join(ACCOUNTS_DIR, config.file);
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        if (config.type === 'json') {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed.length : (parsed.accounts || []).length;
        }
        const lines = splitLines(data).filter(line => line.trim() && !line.trim().startsWith('#'));
        return lines.length;
    } catch (err) {
        if (err.code === 'ENOENT') return 0;
        return 0;
    }
}

async function addAccountsToFile(service, accounts) {
    const config = SERVICE_FILES[service];
    if (!config) throw new Error(`Unknown service: ${service}`);

    const filePath = path.join(ACCOUNTS_DIR, config.file);
    const results = { added: 0, updated: 0, duplicates: 0, errors: [] };

    // The pool folder may not exist yet on a fresh install
    await fs.mkdir(ACCOUNTS_DIR, { recursive: true });

    if (config.type === 'json') {
        let existing = [];
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data);
            existing = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }

        const loginOf = record => String((record && (record.email || record.username)) || '').trim().toLowerCase();
        const cookieOf = record => (record && record.cookie) ? cookieIdentity(record.cookie) : null;

        for (const acc of accounts) {
            const login = String(acc.username || '').trim().toLowerCase();
            const cookieKey = acc.cookie ? cookieIdentity(acc.cookie) : null;

            // Same cookie set already stored?
            let index = cookieKey ? existing.findIndex(r => cookieOf(r) === cookieKey) : -1;

            if (index === -1 && cookieKey) {
                // Same login but a newer cookie set → replace it
                index = login ? existing.findIndex(r => loginOf(r) === login) : -1;
                if (index !== -1 && !cookieOf(existing[index])) index = -1;
            }

            if (index === -1 && !cookieKey) {
                // Plain credentials: only the login identifies the record
                index = login ? existing.findIndex(r => loginOf(r) === login) : -1;
            }

            if (index === -1) {
                existing.push(formatForFile(acc, 'json', service));
                results.added++;
                continue;
            }

            const stored = existing[index];
            const storedCookie = cookieOf(stored);
            const storedLogin = loginOf(stored);
            const fresh = formatForFile(acc, 'json', service);

            const sameCookie = cookieKey !== null && storedCookie === cookieKey;
            const betterLogin = Boolean(login) && login !== storedLogin;

            // Cleaner/newer login (e.g. a junk prefix was cut off) → refresh the record
            if (betterLogin) {
                existing[index] = { ...stored, ...fresh };
                results.updated++;
                continue;
            }

            // Same login but a different cookie set → keep the newest session
            if (cookieKey && !sameCookie) {
                existing[index] = { ...stored, ...fresh };
                results.updated++;
                continue;
            }

            // Non-cookie services (Steam, plain lists): refresh when the data changed
            if (!cookieKey && (login || storedLogin)) {
                const changed = String(stored.password || '') !== String(fresh.password || '')
                    || JSON.stringify(stored.steamid || '') !== JSON.stringify(fresh.steamid || '')
                    || JSON.stringify(stored.games || []) !== JSON.stringify(fresh.games || [])
                    || JSON.stringify(stored.seller || '') !== JSON.stringify(fresh.seller || '');

                if (changed) {
                    existing[index] = { ...stored, ...fresh };
                    results.updated++;
                    continue;
                }
            }

            results.duplicates++;
        }

        await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    } else {
        let existingLines = [];
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            existingLines = splitLines(data).map(l => l.trim()).filter(Boolean);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }

        const existingUsernames = new Set();
        for (const line of existingLines) {
            const parsed = parseTextLine(line);
            if (parsed) existingUsernames.add(parsed.username);
        }

        const newLines = [];
        for (const acc of accounts) {
            if (existingUsernames.has(acc.username)) {
                results.duplicates++;
                continue;
            }
            newLines.push(`${acc.username}:${acc.password}`);
            existingUsernames.add(acc.username);
            results.added++;
        }

        if (newLines.length > 0) {
            const appendData = (existingLines.length > 0 ? '\n' : '') + newLines.join('\n') + '\n';
            await fs.appendFile(filePath, appendData, 'utf-8');
        }
    }

    return results;
}

module.exports = {
    parseAccounts,
    parseTextLine,
    parseSteamLine,
    parseSteamDump,
    parseNetflixTicketLine,
    parseNetflixReport,
    parseCookieSection,
    detectSeparator,
    detectCredentialSeparator,
    formatForFile,
    formatNetflixRecord,
    formatDetected,
    addAccountsToFile,
    getAccountCount,
    SERVICE_FILES,
};
