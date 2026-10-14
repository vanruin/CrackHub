/**
 * Uploaded media — tutorial screenshots, tutorial videos and showcase slide
 * pictures.
 *
 * The admin sends files as data-URLs in JSON (there is no multipart stack in
 * this project); they are decoded to disk here so the JSON stores only ever
 * hold a small `/media/<file>` reference.
 *
 * Files live in backend/data/media/ and are served by the guarded
 * GET /media/:file route in server.js — members and admins only.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR } = require('./store');

const MEDIA_DIR = path.join(DATA_DIR, 'media');

const IMAGE_LIMIT = 4 * 1024 * 1024;    // per file, decoded bytes
const VIDEO_LIMIT = 50 * 1024 * 1024;

const IMAGE_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
};

const VIDEO_TYPES = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
};

const DATA_URL_RE = /^data:([a-z0-9.+_-]+\/[a-z0-9.+_-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Validation failure → HTTP 400 instead of a generic 500. */
function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

async function ensureDir() {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
}

/**
 * Decode one data-URL and store it.
 * `kind` = 'image' | 'video'.
 * Returns { url, type, mime, bytes }.
 */
async function save(raw, kind = 'image') {
    const types = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
    const limit = kind === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT;
    const label = kind === 'video' ? 'video' : 'screenshot';

    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) throw badRequest(`Attach a ${label} first`);
    if (value.length > Math.ceil(limit * 1.4) + 1024) {
        throw badRequest(`That ${label} is too large — max ${Math.round(limit / 1024 / 1024)} MB`);
    }

    const match = DATA_URL_RE.exec(value);
    if (!match) throw badRequest(`The ${label} must be a PNG, JPG, WEBP or GIF image` + (kind === 'video' ? '' : ''));

    const mime = match[1].toLowerCase();
    const ext = types[mime];
    if (!ext) {
        const allowed = kind === 'video'
            ? Object.keys(VIDEO_TYPES).join(', ')
            : Object.keys(IMAGE_TYPES).join(', ');
        throw badRequest(`Unsupported file type "${mime}" — use one of: ${allowed}`);
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) throw badRequest(`That ${label} file is empty`);
    if (buffer.length > limit) {
        throw badRequest(`That ${label} is too large — max ${Math.round(limit / 1024 / 1024)} MB`);
    }

    const name = `${kind}-${crypto.randomBytes(9).toString('hex')}.${ext}`;
    await ensureDir();
    await fs.writeFile(path.join(MEDIA_DIR, name), buffer);

    return { url: `/media/${name}`, type: kind, mime, bytes: buffer.length };
}

/** Save a list of image data-URLs (used for multi-screenshot tutorials). */
async function saveMany(list, kind = 'image') {
    const items = Array.isArray(list) ? list.filter(Boolean).slice(0, 20) : [];
    const saved = [];
    try {
        for (const item of items) saved.push(await save(item, kind));
    } catch (err) {
        // never leave half a tutorial on disk
        await Promise.all(saved.map(entry => remove(entry.url).catch(() => {})));
        throw err;
    }
    return saved;
}

/** Absolute path of a stored media file (null when the reference is bogus). */
function filePath(url) {
    const value = typeof url === 'string' ? url.trim() : '';
    const match = /^\/media\/([A-Za-z0-9._-]+)$/.exec(value);
    if (!match) return null;
    const target = path.join(MEDIA_DIR, match[1]);
    // belt & braces: the name must stay inside MEDIA_DIR
    if (path.dirname(target) !== MEDIA_DIR) return null;
    return target;
}

/** Delete a stored file. Missing files are not an error. */
async function remove(url) {
    const target = filePath(url);
    if (!target) return false;
    try {
        await fs.unlink(target);
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
    }
}

module.exports = {
    IMAGE_LIMIT,
    VIDEO_LIMIT,
    MEDIA_DIR,
    save,
    saveMany,
    remove,
    filePath,
};
