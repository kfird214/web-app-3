import crypto from 'node:crypto';

// Every item carries a checksum derived from its own values, so any change to the
// item produces a different checksum. Several levels ask the player to read it back.
export function recalcChecksum(item) {
    const { checksum, ...values } = item;
    const canonical = JSON.stringify(Object.keys(values).sort().map(k => [k, values[k]]));
    item.checksum = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8);
    return item;
}

const WEEK = [
    ['sunday', '09:00', '19:00'],
    ['monday', '09:00', '19:00'],
    ['tuesday', '09:00', '19:00'],
    ['wednesday', '09:00', '21:00'],
    ['thursday', '09:00', '21:00'],
    ['friday', '09:00', '14:00'],
    ['saturday', null, null],
];

const hoursFor = locationId => WEEK.map(([day, opens, closes]) => ({
    location_id: locationId,
    day,
    opens,
    closes,
    closed: opens === null,
}));

// Each player session gets its own copy of this data, so one player's POST/PUT/DELETE
// never leaks into another player's game. Nothing is persisted to disk.
export function seedData() {
    const items = [
        { id: 'itm_1001', name: 'Neon Desk Lamp', type: 'gadget', price: 49.9, stock_count: 12 },
        { id: 'itm_1002', name: 'Mechanical Keyboard', type: 'gadget', price: 320, stock_count: 5 },
        { id: 'itm_1003', name: 'The REST Handbook', type: 'book', price: 88.5, stock_count: 30 },
        { id: 'itm_1004', name: 'HTTP Deep Dive', type: 'book', price: 120, stock_count: 7 },
        { id: 'itm_1005', name: 'Torque Wrench', type: 'tool', price: 210, stock_count: 3 },
        { id: 'itm_1006', name: 'Laser Level', type: 'tool', price: 450, stock_count: 2 },
        { id: 'itm_1007', name: 'USB-C Hub', type: 'gadget', price: 99, stock_count: 21 },
    ].map(recalcChecksum);

    const reviews = [
        { id: 'rev_2001', item_id: 'itm_1003', author: 'Dana', rating: 5, comment: 'Finally understood status codes.' },
        { id: 'rev_2002', item_id: 'itm_1003', author: 'Omer', rating: 4, comment: 'Great chapters on caching.' },
        { id: 'rev_2003', item_id: 'itm_1003', author: 'Lena', rating: 4, comment: 'Wish it had more examples.' },
    ];

    const locations = [
        { id: 'loc_4001', name: 'Rothschild Branch', city: 'Tel Aviv', address: '14 Rothschild Blvd', phone: '03-5550101' },
        { id: 'loc_4002', name: 'Hadar Branch', city: 'Haifa', address: '8 Herzl St', phone: '04-5550202' },
    ];

    return {
        items,
        reviews,
        locations,
        opening_hours: [...hoursFor('loc_4001'), ...hoursFor('loc_4002')],
        posts: [],            // intentionally empty: GET /api/posts answers 204 No Content
        next_item_id: 1008,
        next_review_id: 2004,
    };
}

export const findItem = (db, id) => db.items.find(i => i.id === id) || null;
export const findLocation = (db, id) => db.locations.find(l => l.id === id) || null;
export const reviewsFor = (db, itemId) => db.reviews.filter(r => r.item_id === itemId);
export const openingHoursFor = (db, locationId) => db.opening_hours.filter(h => h.location_id === locationId);

export function averageRating(reviews) {
    if (reviews.length === 0) return null;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return Math.round((sum / reviews.length) * 10) / 10;
}
