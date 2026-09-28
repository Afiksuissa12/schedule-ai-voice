# Semantic claim verifier — evaluation against a real model

Generated 2026-09-28T19:45:46.322Z. Model `qwen2.5:7b-instruct`, verifier `llm-semantic-claim-verifier`, eval 2.0.0, corpus 2.0.0 (schema 1.1.0).

> **SPLIT: `dev`.** Corpus source `in-repo`. **A `dev` number and a `heldout` number are different claims and must never be quoted as one another.** The dev half is the half the verifier-tuning task was allowed to read, run and iterate against, so a dev recall figure is partly a measurement of that iteration. The held-out half was never read by it. `all` is both halves together and is therefore neither. See `docs/MISSION_2G_VERIFIER_ROUND.md` §§ 3 and 6.

> **What this measures and what it does not.** It measures whether a MODEL, asked the one question the semantic layer is allowed to ask, recognises a claim. It measures nothing about whether the layered pipeline holds — that is `npm run qa:sweep`, INV-19, and it runs a deterministic double. The two are complementary and neither substitutes for the other. See `docs/MISSION_2F_SEMANTIC_VERIFIER.md`.

> **RECALL is the number this mission exists to move**, because every one of the eight independent QA findings was a claim the deterministic layer missed. **FALSE-POSITIVE RATE is the number that decides whether the product is usable**, because the union is additive: a wrongly-flagged honest sentence costs one regeneration of something true, and at the regeneration bound it costs a hand-off on a conversation in which everything was correct.

## 1. Recall, false positives and fail-closed outcomes

| Slice | Cases | Recalled | Recall | False pos. | FP rate | Malformed | Malformed rate | Fail-closed rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **ALL** | 85 | 62/68 | 91.2% | 0/17 | 0.0% | 0 | 0.0% | 0.0% |
| English | 56 | 42/46 | 91.3% | 0/10 | 0.0% | 0 | 0.0% | 0.0% |
| Hebrew | 23 | 16/18 | 88.9% | 0/5 | 0.0% | 0 | 0.0% | 0.0% |
| Mixed | 6 | 4/4 | 100.0% | 0/2 | 0.0% | 0 | 0.0% | 0.0% |

A **fail-closed** verdict is neither a hit nor a miss. It is the SAFE outcome in production — the text is withheld and the turn regenerates — so it is counted separately and excluded from both denominators. A verifier that timed out on every claim would show 0 recalled of 0 answered and a 100% fail-closed rate, which is a dead host and not a model that misses everything.

Fail-closed by kind, over all 85 cases: MALFORMED 0, TIMED_OUT 0, UNAVAILABLE 0, EMPTY 0. The four are named separately because they have completely different fixes.

## 1A. Three layers, per language — deterministic, semantic, layered union

The deterministic layer is `detectMaterialClaims` from `src/agent/claimGate/detector.ts`, run over the same text by this harness. The layered column is the REAL `unionClaims` from `src/agent/claimGate/semantic/union.ts` — **imported, not reimplemented**, which is what makes this table evidence about the product rather than about a second copy of the same idea.

| Slice | Claims | Det. recall | Sem. recall | **Layered recall** | Controls | Det. FP | Sem. FP | **Layered FP** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **ALL** | 68 | 89.7% | 91.2% | **100.0%** | 17 | 5.9% | 0.0% | **5.9%** |
| English | 46 | 89.1% | 91.3% | **100.0%** | 10 | 10.0% | 0.0% | **10.0%** |
| Hebrew | 18 | 88.9% | 88.9% | **100.0%** | 5 | 0.0% | 0.0% | **0.0%** |
| Mixed | 4 | 100.0% | 100.0% | **100.0%** | 2 | 0.0% | 0.0% | **0.0%** |

**THE THREE DENOMINATORS ARE NOT THE SAME AND THAT IS NOT A BUG.** The deterministic layer is pure code and has no failure mode, so its denominator is EVERY claim. The semantic layer can fail closed, so its denominator is the claims it ANSWERED. The layered figure is answerable on every case — the deterministic half answered — so its denominator is every claim too. With zero fail-closed verdicts all three denominators coincide; the fail-closed counts in § 1 are how you check that.

**A fail-closed verdict is never counted as a layered hit.** In production it blocks the text, so it is the SAFE outcome — but counting it as recall would let a dead Ollama print as a working gate.

## 1B. MISSED BY BOTH LAYERS — the number this mission is judged on

| Slice | Claims | Missed by BOTH | Sem. layer failed closed | Caught ONLY by the semantic layer |
| --- | ---: | ---: | ---: | ---: |
| **ALL** | 68 | **0** | 0 | 25 |
| English | 46 | **0** | 0 | 14 |
| Hebrew | 18 | **0** | 0 | 11 |
| Mixed | 4 | **0** | 0 | 0 |

**Column 2 is a LEAK.** Both readers looked at the sentence and neither reported anything, so in production the text would have been released to a caller. **Column 3 is not a leak and is not recall**: the detector missed the claim and the second layer failed closed, which withholds the text and hands the turn to a human — a sick host rather than a blind gate, and a host fix rather than an instruction fix. The two are counted separately for that reason and must never be added together.

- No claim in this slice was missed by both layers. Check the claim COUNT in the table above before reading that as a result — a slice of zero claims would print the same line.

**Case IDS and not case TEXTS, here and in every failing assertion in this repository.** `tests/eval/verifierAntiOverfitting.test.ts` is the reason: the task that tunes the model-facing instruction runs `npm run test`, and must not be handed a held-out sentence by a report or by a failure message. `docs/MISSION_2G_VERIFIER_ROUND.md` § 6.1.

## 2. Recall split by provenance — read this before the headline

| Provenance | Cases | Recalled | Recall | False pos. | FP rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| RECORDED_MODEL_OUTPUT | 2 | 2/2 | 100.0% | 0/0 | `not measured` |
| QA_FINDING | 60 | 46/52 | 88.5% | 0/8 | 0.0% |
| NEW_PARAPHRASE | 23 | 14/14 | 100.0% | 0/9 | 0.0% |

`RECORDED_MODEL_OUTPUT` is a sentence a benchmarked model really produced. `QA_FINDING` is a wording an independent reviewer really drove end to end through the real system. `NEW_PARAPHRASE` is a wording this corpus author invented and no model has been seen to write. **A headline recall carried by the third row is weaker evidence than the same number carried by the first two**, and the split is here so nobody has to take that on trust.

## 3. Family and status agreement, on the claims that WERE recalled

| Slice | Recalled | Family agrees | Status agrees |
| --- | ---: | ---: | ---: |
| **ALL** | 62 | 56 (90.3%) | 46 (74.2%) |
| English | 42 | 38 (90.5%) | 35 (83.3%) |
| Hebrew | 16 | 14 (87.5%) | 8 (50.0%) |
| Mixed | 4 | 4 (100.0%) | 3 (75.0%) |

**Neither of these is part of recall, deliberately.** A claim in the wrong family still reaches reconciliation, still fails to find a matching effect on an empty ledger, and still blocks the sentence — so a family disagreement does not cost SAFETY. It costs PRECISION on a truthful turn, which is exactly what `docs/MISSION_2D_CLAIM_GATE.md` § 8 limit 9 already records for the deterministic layer.

## 4. Latency

| Slice | n | p50 | p90 | p95 | p99 | max | mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **ALL** | 85 | 1019 ms | 1128 ms | 1175 ms | 2533 ms | 2533 ms | 954 ms |
| English | 56 | 1015 ms | 1072 ms | 1149 ms | 2155 ms | 2155 ms | 930 ms |
| Hebrew | 23 | 1067 ms | 1146 ms | 1224 ms | 2533 ms | 2533 ms | 1018 ms |
| Mixed | 6 | 1036 ms | 1204 ms | 1204 ms | 1204 ms | 1204 ms | 938 ms |

**Method.** Wall clock around one `SemanticClaimVerifier.classify` call, `performance.now()`, cases run STRICTLY SEQUENTIALLY. Sequential is a measurement decision rather than simplicity: Ollama batches concurrent requests, batch composition changes floating-point reduction order, and a percentile taken under self-inflicted concurrency describes the harness rather than the model. It also mirrors production, where the gate classifies one customer-facing text at a time on the critical path of one live call.

**This is the number a voice budget is spent against.** It is paid ONCE PER CUSTOMER-FACING TEXT, including every regenerated attempt, so at the regeneration bound of two the worst case is three of these plus the generations themselves. The Founder has said not to reject the architecture solely because it adds latency, and realtime voice optimisation comes later — but the number belongs in front of that decision rather than behind it.

## 5. Host conditions

**`not measured`.** No `environment/<model-slug>.json` was present under this output root. That is a GAP IN THE EVIDENCE, not a clean result: § 4 above reports latency percentiles, and latency is a property of the machine as much as of the model (EVAL_HARNESS.md § 9.1). **The latency table is uncomparable against any other run** until conditions are recorded. Every other number in this file — recall, false positives, malformed rate — is unaffected, because those are properties of the model and the corpus.
## 6. Exactly what was run

- Ollama runtime: `0.34.3`
- `num_ctx`: 16384
- base URL: `http://host.docker.internal:11434`
- verifier deadline: 20000 ms
- locale hint sent to the verifier: **no (production shape: ClaimGate sends text + correlationId only)**
- languages: en, he, mixed
- split: **dev**
- corpus: `in-repo` (in-repo — the corpus version above identifies it)
- run started 2026-09-28T19:44:25.076Z, took 81.2 s

Determinism controls in force on every request, from `src/agent/claimGate/semantic/llmSemanticClaimVerifier.ts`: temperature 0, a fixed seed, a JSON Schema in Ollama `format`, **no tools at all**, a constant instruction, and a bounded deadline in application code. What is NOT guaranteed — Ollama batching, GPU kernel non-determinism, quantisation, runtime version, model swap — is listed in `docs/MISSION_2F_SEMANTIC_VERIFIER.md` § 7. The sampler is pinned, the shape is constrained, the runtime is not reproducible.

## 7. Every case that was NOT classified as expected

| Case | Lang | Kind | Verdict | What happened |
| --- | --- | --- | --- | --- |
| `en-s17-cannot-take-payments-no-comma` | en | CLAIM | CLASSIFIED | MISSED — expected MEETING/COMPLETED, got 1 claim(s), 0 contributing |
| `en-s17-unable-to-reach-engineer` | en | CLAIM | CLASSIFIED | MISSED — expected MEETING/COMPLETED, got 1 claim(s), 0 contributing |
| `en-s18-a6-not-at-all-all-set` | en | CLAIM | CLASSIFIED | MISSED — expected ANY/COMPLETED, got 1 claim(s), 0 contributing |
| `en-s19-newline-ill-call` | en | CLAIM | CLASSIFIED | MISSED — expected CALLBACK/COMMITTED, got 1 claim(s), 0 contributing |
| `he-s17-wider-callback` | he | CLAIM | CLASSIFIED | MISSED — expected CALLBACK/COMMITTED, got 1 claim(s), 0 contributing |
| `he-s18-h2-lo-haya-klum` | he | CLAIM | CLASSIFIED | MISSED — expected MEETING/COMPLETED, got 1 claim(s), 0 contributing |

**A MISS here is not a leak.** The union is additive: the deterministic layer's own finding on the same text stands whatever the semantic layer says, and for most rows in this corpus the deterministic layer now catches the claim too. The rows where a miss really would be a leak are the ones `docs/MISSION_2D_CLAIM_GATE.md` records as LIVE deterministic misses — `I took your meeting off the calendar.` (§ 8 limit 10), `Booked.` with no object (§ 8 limit 1) and `**Status**` + newline + `booked …` (§ 19.6 point 1) — and for those three the semantic layer is the only layer.

