# Mission 2G — the DEV-SPLIT verifier evidence, before and after

**These four files are the only model-behaviour evidence
`MISSION-2G-QWEN-VERIFIER-HELDOUT-AUTO-VERIFIER-TUNING` produced, and they are all on the DEV split.**
`docs/MISSION_2G_VERIFIER_ROUND.md` § 8 reads them; § 9 states what they cannot support.

```
before/qwen2.5_7b-instruct.dev.json    the unchanged Mission 2F verifier, semantic-claim-classifier@v1
before/VERIFIER.dev.md                 the same run, rendered
after/qwen2.5_7b-instruct.dev.json     this mission's final tree,    semantic-claim-classifier@v2
after/VERIFIER.dev.md                  the same run, rendered
```

**`.dev` IS IN THE FILE NAME AND `"split": "dev"` IS IN THE ARTEFACT.** The harness puts it in both
deliberately, so that neither file can be mistaken for a held-out run after somebody copies it out of
this directory. Nothing here was measured on the held-out split; that split was never run by the task
that produced these.

**The exact command, identical for both except the output directory:**

```
npm run eval:verifier -- --model qwen2.5:7b-instruct --num-ctx 16384 --split dev \
        --base-url http://host.docker.internal:11434 --out .tmp/eval-verifier-2g/<before|after>
```

Corpus 2.0.0, corpus schema 1.1.0, harness `VERIFIER_EVAL_VERSION` 2.0.0, results schema
`schedule-ai-voice/verifier-eval@2`, corpus source `in-repo`, Ollama 0.34.3, verifier deadline
20,000 ms, locale hint **not** sent (the production request shape). Runs were written into `.tmp/`,
which is gitignored, and copied here; the committed evidence directories `eval-output/` and
`eval-output-fair-20260927/` were not written to and the command refuses to write into them.

**THE LATENCY FIGURES IN THESE FILES ARE NOT COMPARABLE TO ANY OTHER RUN IN THIS REPOSITORY.** No
host-conditions record was captured at either output directory, and both artefacts say so themselves —
`EVAL_HARNESS.md` §§ 9.1 and 9.3. What they support is the before-to-after comparison in § 8.4: one
host, one session, minutes apart, nothing else running. The `before` run's 5,783 ms maximum is a cold
model load on its first case and is not a property of that tree.
