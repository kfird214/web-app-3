// Single source of truth for both request validation and the SSR /schemas page.

export const ITEM_TYPES = ['book', 'gadget', 'tool'];

export const schemas = {
    item: {
        key: 'item',
        label: 'Item',
        collection: '/api/items',
        description: 'A product sitting in the shop catalog.',
        fields: [
            { name: 'id', type: 'string', server_generated: true, note: 'Assigned by the server, e.g. "itm_1008".' },
            { name: 'name', type: 'string', required: true, note: '1-60 characters.',
              check: v => (v.trim().length >= 1 && v.length <= 60) ? null : 'must be 1-60 characters' },
            { name: 'type', type: 'string', required: true, note: `One of: ${ITEM_TYPES.join(', ')}.`,
              check: v => ITEM_TYPES.includes(v) ? null : `must be one of: ${ITEM_TYPES.join(', ')}` },
            { name: 'price', type: 'number', required: true, note: 'Greater than 0.',
              check: v => v > 0 ? null : 'must be greater than 0' },
            { name: 'stock_count', type: 'integer', required: true, note: 'A whole number, 0 or more.',
              check: v => v >= 0 ? null : 'must be 0 or more' },
            { name: 'checksum', type: 'string', server_generated: true, note: '8 hex characters, recalculated on every change.' },
        ],
    },
    review: {
        key: 'review',
        label: 'Review',
        collection: '/api/items/:itemId/reviews',
        description: 'A customer review that belongs to exactly one item.',
        fields: [
            { name: 'id', type: 'string', server_generated: true, note: 'Assigned by the server, e.g. "rev_2004".' },
            { name: 'item_id', type: 'string', server_generated: true, note: 'Copied from the :itemId route parameter.' },
            { name: 'author', type: 'string', required: true, note: '1-40 characters.',
              check: v => (v.trim().length >= 1 && v.length <= 40) ? null : 'must be 1-40 characters' },
            { name: 'rating', type: 'integer', required: true, note: 'A whole number from 1 to 5.',
              check: v => (v >= 1 && v <= 5) ? null : 'must be between 1 and 5' },
            { name: 'comment', type: 'string', required: true, note: '1-200 characters.',
              check: v => (v.trim().length >= 1 && v.length <= 200) ? null : 'must be 1-200 characters' },
        ],
    },
    location: {
        key: 'location',
        label: 'Location',
        collection: '/api/locations',
        description: 'A physical branch of the shop. Read only.',
        fields: [
            { name: 'id', type: 'string', server_generated: true, note: 'e.g. "loc_4001".' },
            { name: 'name', type: 'string', required: true, note: 'The branch name.' },
            { name: 'city', type: 'string', required: true, note: 'City the branch sits in.' },
            { name: 'address', type: 'string', required: true, note: 'Street address.' },
            { name: 'phone', type: 'string', required: true, note: 'Contact number.' },
        ],
    },
    opening_hours: {
        key: 'opening_hours',
        label: 'Opening hours',
        collection: '/api/locations/:locationId/hours',
        description: 'One row per weekday for a single branch. Read only.',
        fields: [
            { name: 'location_id', type: 'string', server_generated: true, note: 'The branch these hours belong to.' },
            { name: 'day', type: 'string', required: true, note: 'sunday through saturday.' },
            { name: 'opens', type: 'string', required: true, note: 'HH:MM, or null when closed.' },
            { name: 'closes', type: 'string', required: true, note: 'HH:MM, or null when closed.' },
            { name: 'closed', type: 'boolean', required: true, note: 'true when the branch does not open that day.' },
        ],
    },
    post: {
        key: 'post',
        label: 'Post',
        collection: '/api/posts',
        description: 'A blog post for the shop news page. The shop has not published any yet, so this collection is empty.',
        fields: [
            { name: 'id', type: 'string', server_generated: true, note: 'Assigned by the server, e.g. "pst_3001".' },
            { name: 'title', type: 'string', required: true, note: '1-80 characters.',
              check: v => (v.trim().length >= 1 && v.length <= 80) ? null : 'must be 1-80 characters' },
            { name: 'body', type: 'string', required: true, note: '1-2000 characters.',
              check: v => (v.trim().length >= 1 && v.length <= 2000) ? null : 'must be 1-2000 characters' },
            { name: 'published', type: 'boolean', required: true, note: 'true or false.' },
        ],
    },
};

const typeName = v => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;

export function typeMatches(expected, value) {
    if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeName(value) === expected;
}

export function fieldOf(schema, name) {
    return schema.fields.find(f => f.name === name);
}

// Checks one field value. Returns an error string, or null when the value is fine.
export function validateField(field, value) {
    if (!typeMatches(field.type, value)) {
        return `expects ${field.type}, got ${typeName(value)}`;
    }
    return field.check ? field.check(value) : null;
}

// Validates a whole request body. `partial` skips the "required field missing" checks.
export function validateBody(schema, body, { partial = false } = {}) {
    const errors = [];
    if (typeName(body) !== 'object') {
        return [{ field: '(body)', message: 'the request body must be a JSON object' }];
    }
    for (const field of schema.fields) {
        const present = Object.prototype.hasOwnProperty.call(body, field.name);
        if (field.server_generated) {
            if (present) errors.push({ field: field.name, message: 'is generated by the server and must not be sent' });
            continue;
        }
        if (!present) {
            if (field.required && !partial) errors.push({ field: field.name, message: 'is required and is missing' });
            continue;
        }
        const problem = validateField(field, body[field.name]);
        if (problem) errors.push({ field: field.name, message: problem });
    }
    const known = schema.fields.map(f => f.name);
    for (const key of Object.keys(body)) {
        if (!known.includes(key)) errors.push({ field: key, message: 'is not a field of this resource' });
    }
    return errors;
}
