# Rentora Server

Node.js + Express API backed by MongoDB Atlas. Single-file entrypoint: `index.js`.
`"type": "module"` (ESM) — use `import`/`export`, not `require`.

## Run
1. `npm install`
2. Create `.env` (gitignored) with `MONGODB_URI`, `ORIGIN`, `PORT`. Existing `.env` shows the shape.
3. `node index.js` — or `npx nodemon index.js` for hot reload (nodemon is a dependency).

Defaults: port `5000`, CORS origin `http://localhost:3000`.

## Database
`connectToMongoDB()` runs on import and connects to MongoDB Atlas database `Rentora-site`.
Collections: `user`, `equipment`. Requires network access to the Atlas cluster; no local DB or seeding.

## Routes
- `GET /` — "Hello World"
- `GET /users` — lists the `user` collection
- `POST /add-equipment` — inserts a document into the `equipment` collection

## Gotchas
- `express.json()` defaults to a 100KB request body limit; POST bodies over that raise `PayloadTooLargeError`. Raise the limit via `express.json({ limit: '...' })` if needed.
- `connectToMongoDB()` runs on import, so importing `index.js` attempts a live Atlas connection.

## Verification
- `npm test` exits 1: no test suite exists. No lint, typecheck, build, or CI is configured.
- `.env` and `node_modules` are gitignored.
