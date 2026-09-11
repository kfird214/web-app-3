import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemas } from './schema.js';
import { sessionMiddleware } from './session.js';
import { apiRouter } from './api.js';
import { gameRouter, levelGate, viewModel } from './game.js';
import { LEVELS } from './levels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');
const PORT = process.env.PORT || 3000;

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(appDir, 'views'));

app.use(cookieParser());
app.use(express.json());
app.use('/static', express.static(path.join(appDir, 'statics')));

// A broken JSON body is the client's mistake, so it gets 400 rather than a crash.
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
            error: 'invalid_json',
            message: 'The request body is not valid JSON.',
            detail: err.message,
        });
    }
    next(err);
});

app.use(sessionMiddleware);

// ---------------------------------------------------------------- server rendered pages

// The game page. Rendered by EJS on the server; every level change after this is AJAX.
app.get('/', (req, res) => {
    const level = Math.min(req.session.game.unlocked, LEVELS.length);
    res.render('index', viewModel(req.session, level, req));
});

// The schemas page. Its data is built on the server and baked into the template.
app.get('/schemas', (req, res) => {
    res.render('schemas', {
        resources: Object.values(schemas).map(schema => ({
            key: schema.key,
            label: schema.label,
            collection: schema.collection,
            description: schema.description,
            fields: schema.fields.map(field => ({
                name: field.name,
                type: field.type,
                required: Boolean(field.required),
                server_generated: Boolean(field.server_generated),
                note: field.note || '',
            })),
        })),
    });
});

// ---------------------------------------------------------------- api

app.use('/api/game', gameRouter);   // game control, deliberately in front of the gate
app.use('/api', levelGate, apiRouter);

app.use('/api', (req, res) => {
    res.status(404).json({
        error: 'route_not_found',
        message: `The API has no ${req.method} handler for ${req.originalUrl}.`,
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'not_found',
        message: `Nothing is served at ${req.originalUrl}.`,
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`REST Quest is running at http://localhost:${PORT}`);
});
