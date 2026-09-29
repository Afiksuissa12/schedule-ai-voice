# Demo guide (about 5 minutes)

This demo shows the core idea of Schedule AI Voice: **a local LLM generates the
conversation, and application code owns truth and actions.** A contact asks for a
callback; the model *proposes* it with a structured tool call; the application
validates it, persists a `FutureAction`, later executes it with no model
involved, and can explain every step from the audit trail.

Everything is local. No phone is dialled, no calendar is written, no message
leaves the machine, and no API key is read.

## 0. One-time setup (2 minutes, plus the model download)

```bash
npm install
npm run db:setup                     # Prisma client + local SQLite schema + seed

ollama pull qwen2.5:7b-instruct      # about 4.7 GB, once
```

If Ollama runs on the same machine (not in a container), point the app at it:

```bash
export LOCAL_LLM_BASE_URL=http://localhost:11434        # bash
$env:LOCAL_LLM_BASE_URL = "http://localhost:11434"      # PowerShell
```

Check it:

```bash
npm run llm:probe      # Ollama reachable? qwen2.5:7b-instruct present and tool-capable?
```

## 1. Run the demo (about 1 minute)

```bash
npm run demo:local -- --num-ctx 16384
```

`--num-ctx 16384` is the validated context size (it is also the default in
`.env.example`). Pass it explicitly: an **older** local `.env` may still say
8192, and at 8192 the context budget has to drop the price list, so the agent
cannot quote prices (the demo prints a WARNING when this happens).

Other optional flags: `--keep` keeps the demo's SQLite database and prints its path;
`--json` also prints the generated utterances and per-turn metrics.

The program prints numbered sections. What to look at in each:

| Section | What happens | What to point out |
|---|---|---|
| **0. Preconditions** | Checks Ollama, the model and native tool-calling support. | Nothing runs against a missing model. |
| **1. Seeded world** | A returning contact, Jordan, with one previous call on record. | The conversation starts with memory. |
| **2. The conversation** | Three contact messages. Every **agent** reply is generated live by the local model. | Contact: *"Hi, it's Jordan. You caught me at a better time than last week."* — the agent recalls the earlier call. Contact asks about price for eight technicians — answered from the business profile (e.g. the "Dispatch Core" plan). Contact: *"Can you call me back tomorrow afternoon at 3?"* — the model proposes `schedule_followup` with `"when": "tomorrow afternoon at 3"` (the contact's own words, not a timestamp), and the output shows **ALLOWED — application code validated and persisted it**. |
| **3. What application code persisted** | Reads the database back. | One `FutureAction CALL_CONTACT PENDING` for 2026-03-05 15:00 America/New_York — resolved by application code, not the model. The check *"no time-bearing tool argument carried a timestamp the model resolved for itself"* passes. |
| **4. The follow-up engine keeps the promise** | Advances the (fixed) clock and runs `DueActionRunner`. | The `FutureAction` becomes `DONE`, dispatched through the simulated telephony provider **with no model involved**. |
| **5. The audit chain** | Prints every event for the scheduling turn under one correlation id. | `TOOL_CALL_REQUESTED` → `TOOL_CALL_VALIDATED` (*"tomorrow afternoon at 3" resolved to 2026-03-05T15:00 America/New_York*) → `ENTITY_PERSISTED` → the model's confirmation. The turn is fully explained by one id. |
| **6. Generated, not recited** | Compares every agent sentence with every string literal in `src/`. | A known scripted control line **is** caught (so the check works), and **no** agent sentence is prewritten. |

It ends with `RESULT: PASS - every check above held.` The model's exact wording
differs on every run; the validated instant and the persisted result do not.

**If the model asks "3 in the afternoon?" instead of booking**, the demo lets the
contact answer once ("Afternoon, yes - 3 pm tomorrow. Go ahead and lock it in.")
and continues. This is the model following its "ask when ambiguous" guardrail,
and it is printed as an observation, not a failure.

## 2. Show the guardrails without a model (about 1 minute)

These need no Ollama and are deterministic:

```bash
npm run slice:demo              # the offline end-to-end slice (scripted model, tests-only double)
npm run check:anti-scripting    # proves the runtime path contains no canned agent dialogue
npm run qa:sweep                # invariant sweep: e.g. no claim leaks past the gate, no model-made timestamps
```

`slice:demo` uses `ScriptedLlmProvider`, the deterministic test double; it exists
so the pipeline can be shown offline and byte-for-byte reproducibly. The real
demo is `demo:local`.

## 3. Talking points

- The model never writes a date: it passes the contact's words, and deterministic
  code resolves them in the contact's timezone or refuses.
- The `ToolDispatcher` is the single chokepoint: schema, permissions and time
  validation happen there, and every decision is audited.
- Promises are durable: a `FutureAction` row, executed later by
  `DueActionRunner` without the model.
- Replies that claim an action happened are checked against what was actually
  persisted (the claim gate). It is defense in depth, not a proof — see
  [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

## Troubleshooting

- `Cannot reach Ollama` — start Ollama and set `LOCAL_LLM_BASE_URL` as above
  (inside a container use `http://host.docker.internal:11434`, the default).
- `model ... is not on the host` — run `ollama pull qwen2.5:7b-instruct`.
- Slow first reply — the first request loads the model into memory (a few
  seconds); later turns are faster.
