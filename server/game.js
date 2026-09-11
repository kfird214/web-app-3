import express from 'express';
import { LEVELS, levelById, docsUpTo, taskText } from './levels.js';
import { schemas } from './schema.js';
import { resetSession } from './session.js';

const fail = (res, status, error, message, extra = {}) =>
    res.status(status).json({ error, message, ...extra });

// Answers are compared loosely on formatting, never on content.
const normalize = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');

// Only these level fields ever reach the browser. The expected request and the
// expected answer stay on the server.
const publicLevel = level => ({
    id: level.id,
    name: level.name,
    subtitle: level.subtitle,
    note: level.note || null,
    question: level.question,
    answer_hint: level.answer_hint,
    methods: level.methods,
    show_query: level.show_query,
    show_body: level.show_body,
    body_placeholder: level.body_placeholder || '{\n  \n}',
});

function scoreFor(record) {
    const penalty = 5 * record.wrong_requests + 10 * Math.max(0, record.answer_attempts - 1);
    return Math.max(30, 100 - penalty);
}

// Field tables the documentation panel renders next to the relevant endpoints.
function schemaTables() {
    const tables = {};
    for (const schema of Object.values(schemas)) {
        tables[schema.key] = {
            label: schema.label,
            fields: schema.fields.map(f => ({
                name: f.name,
                type: f.type,
                required: Boolean(f.required),
                server_generated: Boolean(f.server_generated),
                note: f.note || '',
            })),
        };
    }
    return tables;
}

function stepperData(session, currentId) {
    const { unlocked, levels } = session.game;
    return LEVELS.map(level => ({
        id: level.id,
        name: level.name,
        status: levels[level.id].completed ? 'done' : level.id <= unlocked ? 'open' : 'locked',
        current: level.id === currentId,
    }));
}

export function viewModel(session, levelId, req) {
    const level = levelById(levelId);
    const record = session.game.levels[levelId];
    const solved = LEVELS.filter(l => session.game.levels[l.id].completed).length;
    return {
        base_url: `${req.protocol}://${req.get('host')}`,
        level: publicLevel(level),
        task: taskText(level, session),
        docs: docsUpTo(levelId),
        schema_tables: schemaTables(),
        steps: stepperData(session, levelId),
        record: {
            completed: record.completed,
            request_ok: record.request_ok,
            score: record.score,
            last: record.last,
        },
        read_only: record.completed,
        progress: { solved, total: LEVELS.length, current: levelId },
        total_score: LEVELS.reduce((sum, l) => sum + session.game.levels[l.id].score, 0),
        all_done: solved === LEVELS.length,
        has_next: levelId < LEVELS.length,
    };
}

const renderPartial = (req, view, locals) => new Promise((resolve, reject) => {
    req.app.render(view, locals, (err, html) => (err ? reject(err) : resolve(html)));
});

// ---------------------------------------------------------------- the level gate
//
// Sits in front of the whole REST API. It reads the level id the player is on from
// the X-Game-Level header, decides whether the request is the one the level asked
// for, and reports the verdict back through response headers so the JSON bodies of
// the API stay clean. Correctness is decided here, on the server, and nowhere else.

export function levelGate(req, res, next) {
    const game = req.session.game;
    const header = req.get('X-Game-Level');
    if (!header) {
        return fail(res, 400, 'missing_level_header', 'Every request in this game must carry the X-Game-Level header.');
    }
    const id = Number(header);
    const level = levelById(id);
    if (!level) {
        return fail(res, 400, 'unknown_level', `There is no level ${header}.`);
    }
    if (id > game.unlocked) {
        return fail(res, 403, 'level_locked', `Level ${id} is not unlocked yet.`);
    }
    const record = game.levels[id];
    if (record.completed) {
        return fail(res, 409, 'level_completed', `Level ${id} is already solved, so it is read only now.`);
    }
    if (level.onEnter) level.onEnter(req.session);

    const path = (req.baseUrl + req.path).replace(/\/+$/, '') || '/';
    const target = { method: req.method, path, query: req.query, body: req.body };
    const verdict = level.match(target, req.session);
    record.request_attempts++;

    const statusAllowed = status => level.accepts_status
        ? level.accepts_status.includes(status)
        : status < 300;

    // Runs once, just before the response goes out, when the status code is known.
    let done = false;
    const finalize = body => {
        if (done) return;
        done = true;
        const ok = verdict.ok && statusAllowed(res.statusCode);
        if (ok) record.request_ok = true;
        else record.wrong_requests++;

        let hint = verdict.hint || null;
        if (verdict.ok && !ok) {
            hint = 'You reached the right endpoint, but the server did not accept this request. Read the response body.';
        }
        res.set('X-Game-Level', String(id));
        res.set('X-Game-Request-Ok', ok ? '1' : '0');
        if (hint) res.set('X-Game-Hint', encodeURIComponent(hint));

        record.last = {
            method: target.method,
            url: req.originalUrl,
            status: res.statusCode,
            body: body ?? null,
            request_ok: ok,
            hint,
            at: new Date().toISOString(),
        };
    };

    const sendJson = res.json.bind(res);
    res.json = body => { finalize(body); return sendJson(body); };
    const endResponse = res.end.bind(res);
    res.end = (...args) => { finalize(null); return endResponse(...args); };

    // Reading with GET is always allowed, so exploring the API is free. Anything that
    // could change data is refused unless it is what this level actually asked for.
    if (!verdict.ok && req.method !== 'GET') {
        return fail(res, 403, 'not_this_level',
            verdict.hint || `This level is not asking for a ${req.method} request here.`);
    }
    next();
}

// ---------------------------------------------------------------- game control routes

export const gameRouter = express.Router();

gameRouter.get('/state', (req, res) => {
    const level = Math.min(req.session.game.unlocked, LEVELS.length);
    res.json(viewModel(req.session, level, req));
});

// Returns the next level already rendered by EJS, so the browser can swap it in
// without a page load and without duplicating the templates in client code.
gameRouter.get('/levels/:id/view', async (req, res) => {
    const id = Number(req.params.id);
    const level = levelById(id);
    if (!level) return fail(res, 404, 'unknown_level', `There is no level ${req.params.id}.`);
    if (id > req.session.game.unlocked) {
        return fail(res, 403, 'level_locked', `Level ${id} is not unlocked yet.`);
    }
    if (level.onEnter) level.onEnter(req.session);

    const model = viewModel(req.session, id, req);
    try {
        const [levelHtml, docsHtml, stepperHtml] = await Promise.all([
            renderPartial(req, 'partials/level', model),
            renderPartial(req, 'partials/docs', model),
            renderPartial(req, 'partials/stepper', model),
        ]);
        res.json({ ...model, html: { level: levelHtml, docs: docsHtml, stepper: stepperHtml } });
    } catch (err) {
        fail(res, 500, 'render_failed', err.message);
    }
});

gameRouter.post('/levels/:id/answer', async (req, res) => {
    const id = Number(req.params.id);
    const level = levelById(id);
    if (!level) return fail(res, 404, 'unknown_level', `There is no level ${req.params.id}.`);

    const game = req.session.game;
    const record = game.levels[id];
    if (id > game.unlocked) {
        return fail(res, 403, 'level_locked', `Level ${id} is not unlocked yet.`);
    }
    if (record.completed) {
        return res.status(409).json({ correct: true, message: 'This level is already solved.' });
    }
    if (!record.request_ok) {
        return res.status(409).json({
            correct: false,
            message: 'Send the request this level asks for first - the answer comes from the response.',
        });
    }
    const given = String(req.body?.answer ?? '').trim();
    if (!given) {
        return res.status(400).json({ correct: false, message: 'Type an answer before submitting.' });
    }

    record.answer_attempts++;
    const expected = level.answer(req.session);
    if (expected === null || normalize(given) !== normalize(expected)) {
        return res.json({
            correct: false,
            message: 'That is not the value the server returned. Read the response once more.',
        });
    }

    record.completed = true;
    record.score = scoreFor(record);
    game.unlocked = Math.max(game.unlocked, Math.min(id + 1, LEVELS.length));

    const model = viewModel(req.session, id, req);
    const stepper = await renderPartial(req, 'partials/stepper', model).catch(() => null);
    res.json({
        correct: true,
        message: model.all_done
            ? 'Correct - and that was the last level. You finished the whole API.'
            : 'Correct. The next level is unlocked.',
        score: record.score,
        total_score: model.total_score,
        progress: model.progress,
        all_done: model.all_done,
        has_next: model.has_next,
        next_level: model.has_next ? id + 1 : null,
        stepper_html: stepper,
    });
});

gameRouter.post('/reset', (req, res) => {
    resetSession(req, res);
    res.json({ ok: true, message: 'Progress cleared and the catalog is back to its starting state.' });
});
