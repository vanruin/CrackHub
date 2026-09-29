/**
 * Service catalog — single source of truth for the paid platforms.
 * `defaultPrice` is the amount charged (in PHP) per SUCCESSFUL generation.
 * Prices can be overridden at runtime through backend/data/pricing.json
 * (managed from the admin panel).
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
        defaultPrice: 5,
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
        defaultPrice: 3,
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
        defaultPrice: 4,
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
        defaultPrice: 4,
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
        defaultPrice: 3,
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
        defaultPrice: 3,
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
        defaultPrice: 5,
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
        defaultPrice: 2,
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
        defaultPrice: 2,
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
        defaultPrice: 2,
    },
];

const BY_KEY = CATALOG.reduce((acc, svc) => {
    acc[svc.key] = svc;
    return acc;
}, {});

const DEFAULT_PRICES = CATALOG.reduce((acc, svc) => {
    acc[svc.key] = svc.defaultPrice;
    return acc;
}, {});

function getservice(key) {
    return BY_KEY[String(key || '').toLowerCase().trim()] || null;
}

module.exports = { CATALOG, DEFAULT_PRICES, getservice };
