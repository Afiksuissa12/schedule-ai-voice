# Schedule AI Voice - Vercel deployment (branch `hosted-demo`)

```
Visitor's browser
   -> https://<project>.vercel.app                  (Vercel)
      -> api/index.js  ->  dist/handler.mjs          (one serverless function: src/web/handler.ts, bundled)
         -> composition root: ToolDispatcher, scheduling validation, claim gate (real LLM verifier),
            FutureAction follow-up engine, audit trail - the same code as the local demo
         -> OpenRouter: qwen/qwen-2.5-72b-instruct    (OPENROUTER_API_KEY, OPENROUTER_MODEL)
         -> Neon PostgreSQL                          (DATABASE_URL, DATABASE_URL_UNPOOLED)
```

Nothing runs on a personal computer. The handler is stateless: every visitor session is its own
seeded demo world in the shared database, the browser holds an HMAC-signed session token, and the
transcript and persisted actions are read back from the database on every request.

## Build (`vercel.json`)

`node deploy/vercel/build.mjs`:
1. writes `deploy/vercel/.generated/schema.prisma` - `prisma/schema.prisma` with ONLY the datasource
   switched to PostgreSQL (the repository's own schema and tests stay on SQLite);
2. `prisma generate` against it;
3. `prisma db push` to the Neon database (runs inside Vercel's build with Vercel's env vars);
4. bundles `src/web/handler.ts` with esbuild into `dist/handler.mjs` and copies the page assets.

## Environment variables (Vercel -> Project -> Settings -> Environment Variables)

| Name | Source |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | added automatically when the Neon database is connected to the project |
| `OPENROUTER_API_KEY` | your OpenRouter key (secret; never committed) |
| `WEB_DEMO_LLM` | `openrouter` |
| `OPENROUTER_MODEL` | `qwen/qwen-2.5-72b-instruct` (the deployed value). The code default, `qwen/qwen-2.5-7b-instruct`, is served on OpenRouter by a single provider that never emitted tool calls in testing - every booking it claimed was blocked by the claim gate - so it is not usable here. |

## Limits and honesty notes

- Rate limits and the daily turn cap are best-effort per serverless instance; the hard spending cap
  is the credit limit on the OpenRouter key.
- Callback confirmations are usually WITHHELD on this deployment even though the callback is saved.
  The model confirms with verb-first wording ("I've scheduled a callback for ..."), which the
  deterministic detector files as a MEETING claim - the documented, test-asserted false positive
  in `tests/claimGate/claimGateCorpus.ts` `KNOWN_FALSE_POSITIVES` ("verb-first scheduling wording
  over a real callback"). No saved meeting can support it, so after three attempts the text is
  withheld and a human handover is requested. The saved callback still shows in the page's
  "What the application actually saved" panel, and the follow-up engine runs it. The gate was
  deliberately NOT changed for hosting: fixing the detector is a gate change for the Founder to decide.
- Meeting confirmations are released: the gate checks them against the saved meeting, and if the
  model's time wording is unreadable it asks for a regeneration, which normally succeeds.
- The semantic claim verifier can occasionally fail to read a TRUE confirmation's time wording and
  then withholds the reply (fail-safe); the page says so explicitly. See `docs/KNOWN_LIMITATIONS.md`.
- Telephony and calendar are the deterministic in-process providers: nothing dials a phone or
  touches a real calendar.
