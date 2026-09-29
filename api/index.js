// Vercel serverless function: every route of the web demo is rewritten here (see vercel.json).
// The logic is src/web/handler.ts, bundled to dist/handler.mjs by deploy/vercel/build.mjs.
import { handleRequest } from '../dist/handler.mjs';

export default function handler(req, res) {
  return handleRequest(req, res);
}
