/**
 * `npm run web:demo` - run the web demo as an ordinary Node HTTP server.
 *
 * All behaviour lives in `./handler.ts` (stateless; the same code the Vercel function runs). This
 * file only listens. Set DATABASE_URL (SQLite `file:` or PostgreSQL) and create the schema first
 * with `npx prisma db push`.
 */
import { createServer } from 'node:http';

import { handleRequest, MODEL_LABEL } from './handler.js';

const PORT = Number(process.env['PORT'] ?? process.env['WEB_DEMO_PORT'] ?? 8080);
const HOST = process.env['WEB_DEMO_HOST'] ?? '0.0.0.0';

const server = createServer((req, res) => { void handleRequest(req, res); });
server.requestTimeout = 180_000;
server.listen(PORT, HOST, () => {
  console.log(`[web-demo] listening on ${HOST}:${PORT} - model ${MODEL_LABEL}`);
});
