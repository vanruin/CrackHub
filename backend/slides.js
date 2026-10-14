/**
 * Showcase slides — the clickable picture carousel at the top of the store.
 *
 * The admin posts a picture (data-URL → disk file via backend/media.js) plus a
 * title, a short subtitle, an optional price and the full details. Members see
 * the active slides, open the details and send an inquiry about the account.
 *
 * Stored in backend/data/slides.json as { slides: [...] }
 */

const store = require('./store');
const media = require('./media');

const STORE_NAME = 'slides';
const TITLE_LIMIT = 80;
const SUBTITLE_LIMIT = 120;
const DETAILS_LIMIT = 1200;

function nowIso() {
    return new Date().toISOString();
}

function slideId() {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `SLD-${stamp}-${store.randomToken(2).toUpperCase()}`;
}

async function loadAll() {
    const data = await store.read(STORE_NAME, null);
    return data && Array.isArray(data.slides) ? data.slides : [];
}

function mutate(task) {
    return store.withLock(STORE_NAME, async () => {
        const slides = await loadAll();
        const result = await task(slides);
        // inside the slides lock — a locked write() would deadlock here
        await store.writeAtomic(STORE_NAME, { updatedAt: nowIso(), slides });
        return result;
    });
}

function cleanPrice(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw badRequest('Price must be a positive amount');
    return Math.round(value * 100) / 100;
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function summary(slide) {
    if (!slide) return null;
    return {
        id: slide.id,
        title: slide.title,
        subtitle: slide.subtitle || '',
        price: slide.price,
        details: slide.details || '',
        image: slide.image ? slide.image.url : null,
        order: Number(slide.order) || 0,
        active: slide.active !== false,
        createdAt: slide.createdAt,
        updatedAt: slide.updatedAt,
    };
}

function byOrder(a, b) {
    const diff = (Number(a.order) || 0) - (Number(b.order) || 0);
    return diff !== 0 ? diff : String(b.createdAt).localeCompare(String(a.createdAt));
}

// ---------------------------------------------------------------- queries

/** @param {{ activeOnly?: boolean }} opts */
async function listSlides(opts = {}) {
    let slides = await loadAll();
    if (opts.activeOnly) slides = slides.filter(s => s.active !== false);
    return slides.map(summary).sort(byOrder);
}

async function getSlide(id) {
    const slides = await loadAll();
    return summary(slides.find(s => s.id === id) || null);
}

async function counts() {
    const slides = await loadAll();
    return {
        total: slides.length,
        active: slides.filter(s => s.active !== false).length,
    };
}

// ---------------------------------------------------------------- mutations

/**
 * Create a slide: { title, subtitle?, price?, details?, image: dataURL,
 *                   order?, active? }
 */
async function createSlide({ title, subtitle, price, details, image, order, active } = {}) {
    const cleanTitle = String(title || '').trim().slice(0, TITLE_LIMIT);
    if (!cleanTitle) throw badRequest('Give the slide a title');

    const picture = await media.save(image, 'image');

    return mutate(async slides => {
        const slide = {
            id: slideId(),
            title: cleanTitle,
            subtitle: String(subtitle || '').trim().slice(0, SUBTITLE_LIMIT),
            price: cleanPrice(price),
            details: String(details || '').trim().slice(0, DETAILS_LIMIT),
            image: picture,
            order: Number.isFinite(Number(order)) ? Number(order) : slides.length,
            active: active === false ? false : true,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        slides.push(slide);
        return summary(slide);
    });
}

/** Edit a slide — every field is optional, `image` replaces the picture. */
async function updateSlide(id, patch = {}) {
    const cleanTitle = patch.title === undefined ? null : String(patch.title).trim().slice(0, TITLE_LIMIT);
    if (cleanTitle !== null && !cleanTitle) throw badRequest('The title cannot be empty');

    let replacement = null;
    if (patch.image) replacement = await media.save(patch.image, 'image');

    try {
        return await mutate(async slides => {
            const slide = slides.find(s => s.id === id);
            if (!slide) throw new Error('Slide not found');

            if (cleanTitle !== null) slide.title = cleanTitle;
            if (patch.subtitle !== undefined) slide.subtitle = String(patch.subtitle || '').trim().slice(0, SUBTITLE_LIMIT);
            if (patch.price !== undefined) slide.price = cleanPrice(patch.price);
            if (patch.details !== undefined) slide.details = String(patch.details || '').trim().slice(0, DETAILS_LIMIT);
            if (patch.order !== undefined && String(patch.order).trim() !== '') slide.order = Number(patch.order) || 0;
            if (patch.active !== undefined) slide.active = patch.active !== false;
            if (replacement) slide.image = replacement;
            slide.updatedAt = nowIso();
            return summary(slide);
        });
    } catch (err) {
        if (replacement) await media.remove(replacement.url).catch(() => {});
        throw err;
    }
}

async function removeSlide(id) {
    const removed = await mutate(async slides => {
        const index = slides.findIndex(s => s.id === id);
        if (index < 0) throw new Error('Slide not found');
        return slides.splice(index, 1)[0];
    });

    if (removed.image && removed.image.url) await media.remove(removed.image.url).catch(() => {});
    return summary(removed);
}

module.exports = {
    listSlides,
    getSlide,
    createSlide,
    updateSlide,
    removeSlide,
    counts,
};
