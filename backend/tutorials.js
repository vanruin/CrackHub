/**
 * Tutorials — guides the admin publishes for members.
 *
 * One tutorial = a title + several screenshots and/or one video. The files are
 * uploaded by the admin as data-URLs and stored on disk by backend/media.js;
 * this store keeps only the title and the /media/ references.
 *
 * Stored in backend/data/tutorials.json as { tutorials: [...] }
 */

const store = require('./store');
const media = require('./media');

const STORE_NAME = 'tutorials';
const TITLE_LIMIT = 120;
const NOTE_LIMIT = 500;
const MAX_IMAGES = 10;
const HISTORY_LIMIT = 200;

function nowIso() {
    return new Date().toISOString();
}

function tutorialId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `TUT-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.tutorials) ? data.tutorials : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const tutorials = await loadAll();
        const result = await task(tutorials);
        // inside the tutorials lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), tutorials });
        return result;
    });
}

/** Card view — media stays an array of { url, type } references. */
function summary(tutorial) {
    if (!tutorial) return null;
    const images = (tutorial.images || []).filter(m => m && m.type === 'image');
    const video = (tutorial.video && tutorial.video.type === 'video') ? tutorial.video : null;
    return {
        id: tutorial.id,
        title: tutorial.title,
        note: tutorial.note || '',
        images: images.map(m => m.url),
        video: video ? video.url : null,
        poster: images.length ? images[0].url : null,
        count: images.length,
        createdAt: tutorial.createdAt,
        updatedAt: tutorial.updatedAt,
    };
}

// ---------------------------------------------------------------- queries

async function listTutorials() {
    const tutorials = await loadAll();
    return tutorials
        .map(summary)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getTutorial(id) {
    const tutorials = await loadAll();
    return summary(tutorials.find(t => t.id === id) || null);
}

async function counts() {
    const tutorials = await loadAll();
    return {
        total: tutorials.length,
        screenshots: tutorials.reduce((sum, t) => sum + (t.images || []).length, 0),
        videos: tutorials.filter(t => t.video).length,
    };
}

// ---------------------------------------------------------------- mutations

/**
 * Publish a tutorial.
 *   { title, note?, images: [dataURL], video?: dataURL }
 */
async function createTutorial({ title, note, images, video } = {}) {
    const cleanTitle = String(title || '').trim().slice(0, TITLE_LIMIT);
    if (!cleanTitle) throw badRequest('Give the tutorial a title');

    const hasImages = Array.isArray(images) && images.some(Boolean);
    const hasVideo = typeof video === 'string' && video.trim();
    if (!hasImages && !hasVideo) {
        throw badRequest('Attach at least one screenshot or a video');
    }

    const savedImages = hasImages ? await media.saveMany(images.slice(0, MAX_IMAGES), 'image') : [];
    let savedVideo = null;
    if (hasVideo) {
        try {
            savedVideo = await media.save(video, 'video');
        } catch (err) {
            await Promise.all(savedImages.map(m => media.remove(m.url).catch(() => {})));
            throw err;
        }
    }

    return mutate(async tutorials => {
        const tutorial = {
            id: tutorialId(),
            title: cleanTitle,
            note: String(note || '').trim().slice(0, NOTE_LIMIT),
            images: savedImages,
            video: savedVideo,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        tutorials.push(tutorial);
        if (tutorials.length > HISTORY_LIMIT) tutorials.splice(0, tutorials.length - HISTORY_LIMIT);
        return summary(tutorial);
    });
}

/** Delete a tutorial and the files it points at. */
async function removeTutorial(id) {
    const removed = await mutate(async tutorials => {
        const index = tutorials.findIndex(t => t.id === id);
        if (index < 0) throw new Error('Tutorial not found');
        return tutorials.splice(index, 1)[0];
    });

    const files = [...(removed.images || []).map(m => m.url), removed.video && removed.video.url].filter(Boolean);
    await Promise.all(files.map(url => media.remove(url).catch(() => {})));
    return summary(removed);
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

module.exports = {
    MAX_IMAGES,
    listTutorials,
    getTutorial,
    createTutorial,
    removeTutorial,
    counts,
};
