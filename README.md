# Schedule AI Voice

A production-oriented AI Voice Sales & Scheduling platform: natural-language
sales conversations, real phone communication, real meeting scheduling,
durable conversation state, and autonomous follow-up.

This repository is built by the Autonomous Development Team
(`C:\Users\afiks\AutonomousDevTeam`) against a Founder mission. See
`.agent/missions/` for mission history once missions have run.

## See the whole slice in one command

```bash
npm install
npm run db:generate
npm run slice:demo
```

`slice:demo` runs the first end-to-end vertical slice and prints what happened:
a contact in `America/New_York` asks to be called back "tomorrow afternoon at
3"; the agent proposes a tool call carrying **those words**; application code
resolves and validates the datetime deterministically; a `FutureAction` is
persisted with the right UTC instant, the contact's timezone and a validation
receipt; the clock advances; one follow-up pass dispatches the call through a
deterministic telephony double; an adversarial turn is refused with zero rows
written; and the whole audit chain is printed in order.

It uses a temporary SQLite file it deletes afterwards (`--keep` to retain it), a
scripted language model, and deterministic providers. **No network, no API key,
no real phone call, no real calendar.**

```bash
npm run verify          # typecheck + the full test suite
```

The suite is green with `OPENAI_API_KEY` unset. Exactly one optional test talks
to OpenAI, and it skips cleanly when the key is absent.

## Where things are

| Document | What it covers |
|---|---|
| `FOUNDATION_CONTRACT.md` | Schema, repositories, audit store, ports, test helpers |
| `SCHEDULING_CONTRACT.md` | Datetime resolution and validation, provider doubles, meetings, durable follow-up |
| `AGENT_CONTRACT.md` | LLM boundary, guardrailed prompt, the nine tools, the dispatcher chokepoint, conversations, the agent turn |

The governing rule, in one sentence: **the LLM reasons and converses, but
application code owns state and executes actions.** Every model-originated
action passes through `ToolDispatcher` in `src/agent/tools/dispatcher.ts`, and
a tool call cannot mutate persisted state without passing validation first.

## Legacy reference (read-only, not part of this repo)

- `C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\REBUILD_NOTES.md`
- `C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\legacy_project\PLAN.md`

This project is a from-scratch rebuild, not a port of the legacy prototype.
