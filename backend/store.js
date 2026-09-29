const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Tiny JSON file store used by the member / ticket / pricing layer.
 * - Everything lives in backend/data/*.json (auto-created on first run)
 * - Writes are atomic (tmp file + rename) and serialized per file
 */

const DATA_DIR = path.join(__dirname, 'data');

/** Per-file promise chains so concurrent writes never interleave. */
const chains = new Map();

function withLock(name, task) {
    const prev = chains.get(name) || Promise.resolve();
    const next = prev.then(task, task);
    // keep the chain alive even when a task rejects
    chains.set(name, next.catch(() => {}));
    return next;
}

async function ensureDataDir() {
    await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid store name: ${name}`);
    return path.join(DATA_DIR, `${name}.json`);
}

/** Read a store file. Returns `fallback` when the file does not exist yet. */
async function read(name, fallback = null) {
    try {
        const raw = await fs.readFile(fileFor(name), 'utf-8');
        const trimmed = raw.trim();
        if (!trimmed) return fallback;
        return JSON.parse(trimmed);
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        if (err instanceof SyntaxError) {
            console.error(`❌ store: ${name}.json is not valid JSON — using fallback`);
            return fallback;
        }
        throw err;
    }
}

/**
 * Atomic write with NO locking. Use this from code that already holds the
 * file lock through withLock() — calling write() there would deadlock, because
 * the inner lock would wait for the outer task that is waiting for the write.
 */
async function writeAtomic(name, value) {
    await ensureDataDir();
    const target = fileFor(name);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tmp, target);
    return true;
}

/** Write a store file atomically, serialized per file. */
function write(name, value) {
    return withLock(name, () => writeAtomic(name, value));
}

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function randomToken(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { DATA_DIR, read, write, writeAtomic, withLock, newId, randomToken, ensureDataDir };
