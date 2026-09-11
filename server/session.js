import crypto from 'node:crypto';
import { seedData } from './database.js';
import { LEVELS } from './levels.js';

const COOKIE = 'rq_sid';
const sessions = new Map();   // sid -> session (server memory only, cleared on restart)

function blankProgress() {
    const levels = {};
    for (const level of LEVELS) {
        levels[level.id] = {
            request_ok: false,      // has the player ever sent the request this level asks for?
            completed: false,       // request_ok + correct answer
            request_attempts: 0,
            wrong_requests: 0,
            answer_attempts: 0,
            score: 0,
            last: null,             // last response, so solved levels stay readable
        };
    }
    return levels;
}

export function newSession() {
    return {
        id: crypto.randomUUID(),
        db: seedData(),
        game: {
            unlocked: 1,            // highest level the player may send requests to
            levels: blankProgress(),
            vars: {},               // ids the server generated for this player (level 2, 9, ...)
            flags: {},              // one-shot markers, e.g. the level 3 restock
        },
    };
}

export function sessionMiddleware(req, res, next) {
    let session = sessions.get(req.cookies?.[COOKIE]);
    if (!session) {
        session = newSession();
        sessions.set(session.id, session);
        res.cookie(COOKIE, session.id, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 });
    }
    req.session = session;
    next();
}

export function resetSession(req, res) {
    const fresh = newSession();
    sessions.delete(req.session?.id);
    sessions.set(fresh.id, fresh);
    res.cookie(COOKIE, fresh.id, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 });
    req.session = fresh;
    return fresh;
}
