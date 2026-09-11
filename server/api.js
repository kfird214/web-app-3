import express from 'express';
import { schemas, fieldOf, validateBody, validateField } from './schema.js';
import {
    recalcChecksum, findItem, findLocation,
    reviewsFor, openingHoursFor, averageRating,
} from './database.js';

export const apiRouter = express.Router();

const fail = (res, status, error, message, extra = {}) =>
    res.status(status).json({ error, message, ...extra });

const itemFieldNames = () => schemas.item.fields.map(f => f.name);

// ---------------------------------------------------------------- API index

apiRouter.get('/', (req, res) => {
    const db = req.session.db;
    res.json({
        name: 'Corner Shop API',
        collections: [
            { resource: 'item', path: '/api/items', count: db.items.length },
            { resource: 'review', path: '/api/items/:itemId/reviews', count: db.reviews.length },
            { resource: 'location', path: '/api/locations', count: db.locations.length },
            { resource: 'opening_hours', path: '/api/locations/:locationId/hours', count: db.opening_hours.length },
            { resource: 'post', path: '/api/posts', count: db.posts.length },
        ],
        schemas_page: '/schemas',
    });
});

// ---------------------------------------------------------------- items

apiRouter.get('/items', (req, res) => {
    const allowed = [...itemFieldNames(), 'sort', 'order'];
    const unknown = Object.keys(req.query).filter(k => !allowed.includes(k));
    if (unknown.length) {
        return fail(res, 400, 'unknown_query_parameter',
            `These query parameters are not fields of an item: ${unknown.join(', ')}.`,
            { allowed });
    }

    let results = req.session.db.items;

    // Every remaining query parameter is a field filter, combined with AND.
    for (const [key, raw] of Object.entries(req.query)) {
        if (key === 'sort' || key === 'order') continue;
        const field = fieldOf(schemas.item, key);
        const wanted = String(raw);
        results = results.filter(item => {
            if (field.type === 'number' || field.type === 'integer') {
                return Number(item[key]) === Number(wanted);
            }
            return String(item[key]).toLowerCase() === wanted.toLowerCase();
        });
    }

    if (req.query.sort !== undefined) {
        const key = String(req.query.sort);
        if (!itemFieldNames().includes(key)) {
            return fail(res, 400, 'unknown_sort_field', `Cannot sort by "${key}".`, { allowed: itemFieldNames() });
        }
        const order = String(req.query.order ?? 'asc').toLowerCase();
        if (!['asc', 'desc'].includes(order)) {
            return fail(res, 400, 'unknown_order', 'order must be either asc or desc.');
        }
        const direction = order === 'desc' ? -1 : 1;
        results = [...results].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction);
    }

    res.json(results);
});

apiRouter.post('/items', (req, res) => {
    const errors = validateBody(schemas.item, req.body);
    if (errors.length) {
        return fail(res, 422, 'invalid_item', 'The item could not be created.', { errors });
    }
    const db = req.session.db;
    const item = recalcChecksum({
        id: `itm_${db.next_item_id++}`,
        name: req.body.name,
        type: req.body.type,
        price: req.body.price,
        stock_count: req.body.stock_count,
    });
    db.items.push(item);
    req.session.game.vars.created_item_id = item.id;
    res.status(201).json(item);
});

apiRouter.get('/items/:id', (req, res) => {
    const item = findItem(req.session.db, req.params.id);
    if (!item) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);
    res.json(item);
});

apiRouter.put('/items/:id', (req, res) => {
    const item = findItem(req.session.db, req.params.id);
    if (!item) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);

    const errors = validateBody(schemas.item, req.body);
    if (errors.length) {
        return fail(res, 422, 'invalid_item',
            'PUT replaces the whole item, so every field has to be present and valid.', { errors });
    }
    // A replacement keeps only the id; everything else comes from the body.
    Object.assign(item, {
        name: req.body.name,
        type: req.body.type,
        price: req.body.price,
        stock_count: req.body.stock_count,
    });
    recalcChecksum(item);
    res.json(item);
});

apiRouter.patch('/items/:id/:field', (req, res) => {
    const item = findItem(req.session.db, req.params.id);
    if (!item) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);

    const field = fieldOf(schemas.item, req.params.field);
    if (!field || field.server_generated) {
        return fail(res, 422, 'field_not_patchable',
            `"${req.params.field}" is not a field you can update on an item.`,
            { patchable: schemas.item.fields.filter(f => !f.server_generated).map(f => f.name) });
    }
    if (req.body === undefined || req.body === null || typeof req.body !== 'object' || !('value' in req.body)) {
        return fail(res, 422, 'missing_value',
            'Send the new value as { "value": <new value> }.');
    }
    const problem = validateField(field, req.body.value);
    if (problem) {
        return fail(res, 422, 'invalid_value',
            `Field "${field.name}" ${problem}.`,
            { field: field.name, expected_type: field.type, note: field.note });
    }
    item[field.name] = req.body.value;
    recalcChecksum(item);
    res.json(item);
});

apiRouter.delete('/items/:id', (req, res) => {
    const db = req.session.db;
    const index = db.items.findIndex(i => i.id === req.params.id);
    if (index === -1) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);

    const [removed] = db.items.splice(index, 1);
    const before = db.reviews.length;
    db.reviews = db.reviews.filter(r => r.item_id !== removed.id);

    // A one time receipt for the deletion, so the caller can prove which removal
    // it was. It is generated fresh on every delete and never repeats.
    const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));
    req.session.game.vars.last_confirmation_code = confirmationCode;

    res.json({
        deleted_id: removed.id,
        deleted_reviews: before - db.reviews.length,
        remaining_items: db.items.length,
        confirmation_code: confirmationCode,
    });
});

// ---------------------------------------------------------------- reviews (nested under an item)

apiRouter.get('/items/:id/reviews', (req, res) => {
    const item = findItem(req.session.db, req.params.id);
    if (!item) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);

    const reviews = reviewsFor(req.session.db, item.id);
    res.json({
        item_id: item.id,
        count: reviews.length,
        average_rating: averageRating(reviews),
        reviews,
    });
});

apiRouter.post('/items/:id/reviews', (req, res) => {
    const db = req.session.db;
    const item = findItem(db, req.params.id);
    if (!item) return fail(res, 404, 'item_not_found', `No item exists with id "${req.params.id}".`);

    const errors = validateBody(schemas.review, req.body);
    if (errors.length) {
        return fail(res, 422, 'invalid_review', 'The review could not be created.', { errors });
    }
    const review = {
        id: `rev_${db.next_review_id++}`,
        item_id: item.id,          // taken from the route parameter, never from the body
        author: req.body.author,
        rating: req.body.rating,
        comment: req.body.comment,
    };
    db.reviews.push(review);
    req.session.game.vars.created_review_id = review.id;
    res.status(201).json(review);
});

// ---------------------------------------------------------------- locations and opening hours (read only)

apiRouter.get('/locations', (req, res) => {
    res.json(req.session.db.locations);
});

apiRouter.get('/locations/:id', (req, res) => {
    const location = findLocation(req.session.db, req.params.id);
    if (!location) return fail(res, 404, 'location_not_found', `No location exists with id "${req.params.id}".`);
    res.json(location);
});

apiRouter.get('/locations/:id/hours', (req, res) => {
    const location = findLocation(req.session.db, req.params.id);
    if (!location) return fail(res, 404, 'location_not_found', `No location exists with id "${req.params.id}".`);
    res.json({ location_id: location.id, hours: openingHoursFor(req.session.db, location.id) });
});

// ---------------------------------------------------------------- posts (a real collection that happens to be empty)

apiRouter.get('/posts', (req, res) => {
    const posts = req.session.db.posts;
    if (posts.length === 0) {
        // 204 is not allowed to carry a body, so the explanation travels in a header.
        res.set('X-Notice', 'No posts have been published yet :(');
        return res.status(204).end();
    }
    res.json(posts);
});

apiRouter.get('/posts/:id', (req, res) => {
    const post = req.session.db.posts.find(p => p.id === req.params.id);
    if (!post) return fail(res, 404, 'post_not_found', `No post exists with id "${req.params.id}".`);
    res.json(post);
});
