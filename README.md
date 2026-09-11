# REST Quest

A browser game for learning HTTP and REST by actually sending requests. Every level
describes a situation in a small shop's system, and the player has to build the matching
HTTP request - method, route, query parameters and request body - and send it. Nothing is
simulated: the requests really go to this Express server, and the real response is shown
back with its status code and JSON body.

## Install and run

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a browser.

`npm run dev` runs the same server with `node --watch` for development.
Set `PORT` to use a different port, e.g. `PORT=4000 npm start`.

Requires Node.js 18 or newer. There is no database and no build step.

## Pages

| Path       | What it is |
|------------|------------|
| `/`        | The game. Rendered on the server with EJS; every level change after that is AJAX, with no page reload. |
| `/schemas` | A server rendered reference page listing every resource, its fields and their types. |
| `/api/...` | The REST API the game talks to. |

## The levels

Each level keeps the same layout - method buttons, route field, query parameter rows,
request body, RUN, and an answer box - while the idea behind it gets harder. The
documentation panel on the right grows as levels unlock.

| # | Level | Practises |
|---|-------|-----------|
| 1 | Taking Inventory | `GET` a collection, read JSON |
| 2 | Stocking the Shelf | `POST` with a request body, server side validation |
| 3 | Filtering by Type | a query parameter that really filters the data |
| 4 | Replacing an Item | `PUT` with a route parameter and a full body |
| 5 | One Field at a Time | `PATCH` with two route parameters, type checking |
| 6 | Narrowing It Down | several query parameters combined in one request |
| 7 | Nothing to Show | exploring an API, and `204 No Content` |
| 8 | What Customers Say | a nested resource, the item/review relation |
| 9 | Leaving a Review | route parameter and request body together |
| 10 | Cleaning Up After Yourself | `DELETE`, and data that really changes |
| 11 | Proving It Is Gone | reading a `404` error response |

## How correctness is decided

All of it on the server, in `server/levels.js`. Nothing in the browser knows the expected
method, path, query string or answer.

- Every game request carries an `X-Game-Level` header naming the level the player is on.
- `levelGate` in `server/game.js` compares the request against that level's definition and
  reports its verdict in the `X-Game-Request-Ok` and `X-Game-Hint` response headers, which
  keeps the API's own JSON bodies clean.
- Reading with `GET` is always allowed, so exploring the API is free. A request that would
  change data and is not what the level asked for is refused with `403 Forbidden`.
- Answers are submitted to `POST /api/game/levels/:id/answer`, and the expected value is
  computed from the session's own data at that moment.
- A solved level becomes read only: the client disables it, and the server refuses further
  requests to it with `409 Conflict`. The player can still go back and reread the request
  and response that solved it.

## API

Resources: **items**, **reviews** (nested under an item), **locations**, **opening hours**
(nested under a location) and **posts** (a real collection that is deliberately empty, which
is why it answers `204`).

```
GET    /api                                  the API index, lists every collection
GET    /api/items                            list, filterable by any item field, plus sort and order
POST   /api/items                            create an item
GET    /api/items/:id                        one item
PUT    /api/items/:id                        replace an item
PATCH  /api/items/:id/:field                 update a single field, body { "value": ... }
DELETE /api/items/:id                        remove an item and its reviews
GET    /api/items/:id/reviews                the reviews of one item, with a summary
POST   /api/items/:id/reviews                add a review to an item
GET    /api/locations                        list branches
GET    /api/locations/:id                    one branch
GET    /api/locations/:id/hours              opening hours of a branch
GET    /api/posts                            the blog posts (empty, so 204 No Content)
```

Game control routes live under `/api/game` and sit in front of the level gate:
`GET /api/game/state`, `GET /api/game/levels/:id/view`,
`POST /api/game/levels/:id/answer`, `POST /api/game/reset`.

Status codes in use: `200`, `201`, `204`, `400`, `403`, `404`, `409`, `422`.

## Data and sessions

Each player gets a cookie (`rq_sid`) and their own copy of the seed data, so one player's
`POST`, `PUT`, `PATCH` and `DELETE` never affect anyone else's game. The data is defined in
`server/database.js` and kept in server memory - there is no database, and changes are not
kept across a restart. Writes are real within a session: an item created in level 2 is the
same item patched in level 5 and deleted in level 10.

## Project layout

```
server/
  index.js      express app, EJS setup, the two SSR pages, error handling
  game.js       the level gate, the game routes, the view model
  levels.js     all 11 level definitions and their documentation (server only)
  api.js        the REST API
  schema.js     field definitions, shared by the validator and the schemas page
  database.js   seed data, the per session copy, checksums
  session.js    cookie session and progress tracking
app/
  views/        EJS templates - index, schemas, and the partials reused by AJAX
  statics/
    index.css   all styling
    index.js    client side, vanilla JS only
```

The client and the server are kept apart: the browser builds and sends requests and renders
what came back, and every decision about whether something is right is made on the server.
Level changes fetch the next level already rendered by EJS and swap it in, so the templates
are not duplicated in client code.
