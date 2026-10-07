/**
 * Service catalog — single source of truth for the platforms.
 * Everything here is covered by the monthly subscription, so entries carry
 * no price. `view()` shapes the catalog for the storefront by adding the
 * live pool size.
 */

const CATALOG = [
    {
        key: 'netflix',
        label: 'Netflix',
        emoji: '🎬',
        color: '#E50914',
        path: '/netflix',
        file: 'nft.json',
        type: 'json',
        validated: true,      // the backend verifies the cookie before returning it
        credential: 'login + password + QR login link',
    },
    {
        key: 'steam',
        label: 'Steam',
        emoji: '🎮',
        color: '#66c0f4',
        path: '/steam',
        file: 'Steam.json',
        type: 'json',
        validated: false,
        credential: 'username + password + shared access token',
    },
    {
        key: 'hbo',
        label: 'HBO Max',
        emoji: '🍪',
        color: '#7b4fff',
        path: '/hbo',
        file: 'hbo.txt',
        type: 'txt',
        validated: false,
        credential: 'cookie set (Netscape + JSON)',
    },
    {
        key: 'disney',
        label: 'Disney+',
        emoji: '✨',
        color: '#113ccf',
        path: '/disney',
        file: 'disney.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'crunchyroll',
        label: 'Crunchyroll',
        emoji: '🍣',
        color: '#f47521',
        path: '/crunchyroll',
        file: 'crunchyroll.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'paramount',
        label: 'Paramount+',
        emoji: '⭐',
        color: '#0064ff',
        path: '/paramount',
        file: 'paramount.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'xbox',
        label: 'Xbox Game Pass',
        emoji: '🟢',
        color: '#107c10',
        path: '/xbox',
        file: 'xbox.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'moonton',
        label: 'Moonton (MLBB)',
        emoji: '🏆',
        color: '#ff9900',
        path: '/moonton',
        file: 'moonton.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'garena',
        label: 'Garena Free Fire',
        emoji: '🔥',
        color: '#ff6b00',
        path: '/garena',
        file: 'garena.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
    {
        key: 'capcut',
        label: 'CapCut Pro',
        emoji: '✂️',
        color: '#00d4ff',
        path: '/capcut',
        file: 'capcut.txt',
        type: 'txt',
        validated: false,
        credential: 'email + password',
    },
];

const BY_KEY = CATALOG.reduce((acc, svc) => {
    acc[svc.key] = svc;
    return acc;
}, {});

async function view(poolCounter) {
    return Promise.all(CATALOG.map(async svc => ({
        key: svc.key,
        label: svc.label,
        emoji: svc.emoji,
        color: svc.color,
        path: svc.path,
        credential: svc.credential,
        available: poolCounter ? await poolCounter(svc.key) : 0,
    })));
}

function getservice(key) {
    return BY_KEY[String(key || '').toLowerCase().trim()] || null;
}

module.exports = { CATALOG, getservice, view };
