/**
 * `src/context` - what the agent knows about the business it works for.
 *
 * Three files, and the split matters:
 *
 *  - `businessProfile.ts` is the SCHEMA and the loader. Zod-validated,
 *    versioned, `.strict()`, with no field anywhere for a sentence to say.
 *  - `profiles/default.json` is the committed DATA. Changing what the agent
 *    knows is editing this file, or pointing `profilePath` at another one.
 *  - `dialogueShape.ts` is the rule set that keeps the first two honest, shared
 *    with `npm run check:anti-scripting`.
 *
 * Nothing here talks to a database, a network or a clock. A profile is a
 * document, and this module reads documents.
 */
export * from './businessProfile.js';
export * from './dialogueShape.js';
