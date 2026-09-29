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
- Callback confirmations: the model's usual wording ("I've scheduled a callback for ...") used to be
  filed as a MEETING claim by the deterministic detector (`docs/MISSION_2D_CLAIM_GATE.md` § 8
  limit 9) and was withheld even though the callback was saved. Fixed on this branch with the
  Founder's approval: a generic booking verb now defers to a CALLBACK object right after it, unless
  the sentence also names a meeting or a generic booking. The claim is still reconciled against
  the saved callback's day and time, and a callback that was never saved, or one described at the
  wrong day or time, is still rejected (`tests/claimGate/claimGateCorpus.ts` `LEDGER_CASES`).
- Semantic-layer readings (Founder-approved, `src/agent/claimGate/semantic/union.ts`
  `borrowedReading`): a semantic claim may use the day and time the deterministic detector already
  read from the same phrase, and a bare "then" may refer to an earlier claim of the SAME type in the
  same reply. The semantic claim keeps its own type and is still checked against the saved state;
  `tests/agent/semanticBorrowedReading.test.ts` holds the adversarial cases that must still block.
- Meeting confirmations are released: the gate checks them against the saved meeting, and if the
  model's time wording is unreadable it asks for a regeneration, which normally succeeds.
- The semantic claim verifier can occasionally fail to read a TRUE confirmation's time wording and
  then withholds the reply (fail-safe); the page says so explicitly. See `docs/KNOWN_LIMITATIONS.md`.
- Telephony and calendar are the deterministic in-process providers: nothing dials a phone or
  touches a real calendar.

## Restated times (safety fix)

A day or a time restated in a sentence with no booking wording - "The meeting is booked for Friday at
10:00 AM. Just note that it's at 11:00 AM." - is checked against the saved effect like any claim
(`src/agent/claimGate/detector.ts` `appendRestatedTimes`; tests in `tests/agent/restatedTime.test.ts`).
It applies when the reply already contains a scheduling claim; prices, quantities, phone numbers,
identifiers and durations are not read as times, and questions are not restatements.

## Known hosted-demo limitations (measured on production, 29 September 2026; not fixed - scope frozen)

- **Meeting confirmations are not always shown.** In 10 fresh production booking runs, 5 showed the
  model's confirmation; in the others the meeting was saved but the reply was withheld (the page
  then shows the safety-gate notice and the saved meeting) or the time was not accepted. Causes below.
- **"<weekday> next week" is not a time the scheduler accepts** ("Tuesday next week at 1pm" is
  refused as `INVALID_FORMAT`; "next Tuesday at 1pm" works). Nothing is booked and nothing false is said.
- **"for <non-time words>" can be read as an unreadable time** by the deterministic detector
  ("booked for the Northwind Dispatch Demo", "set up for our discussion"), which withholds a true reply
  (`UNREADABLE_WHEN`). The detector also reads "everything is set up" as a completion claim.
- **Readiness wording** ("I'll make sure everything is set up") is still sometimes classified by the
  semantic verifier as a record commitment; "I'll make sure it's on the calendar" is treated as a
  calendar undertaking, deliberately.
- **Unsupported promises still occur occasionally** ("I'll confirm the details with you again before
  the call"); the gate blocks them (`NO_TOOL_FOR_PROMISE`), which withholds that reply.
- **Timeouts.** When the model keeps producing unsupported text, three gate attempts (each a model
  call plus a verifier call) can exceed the 60 s function limit; the visitor then sees an error
  instead of a reply or the safety notice. Nothing false is shown.
- **A restated time with no scheduling claim anywhere in the reply** has no anchor in the
  deterministic layer ("Your meeting is at 10 AM. Actually, it'll be at 11."). It is caught only when
  the semantic verifier reports the first sentence as a meeting - its instruction treats wording that
  describes a state of affairs as an assertion - and then fails closed (`UNREADABLE_WHEN`).
