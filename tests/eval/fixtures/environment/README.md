# Environment-record fixtures

Committed sample data for `src/eval/environment/`. **Nothing here was read off the
live machine, and no test in `tests/eval/` reads the live machine.** These files
are hand-written to exercise specific branches, and the numbers are plausible for
the host described in `EVAL_HARNESS.md` § 3 (RTX 4060 Laptop, 8188 MiB VRAM,
31.71 GB RAM) without being claimed as measurements of it.

Real records are written by an **external host sampler** into
`<EVAL_OUT_DIR>/environment/<model-slug>.json`. These fixtures are copied into a
temporary directory by the tests; they are never written into `eval-output/`.

## Well-formed

| File | What it exercises |
| --- | --- |
| `qwen2.5_7b-instruct.json` | The ordinary case. Five samples, so an **odd-count median**. Entirely on the GPU (`cpuBytes: 0`), no note. |
| `hermes3_8b.json` | **Even-count median** (four samples), a **partial offload** with 1.5 GiB in system RAM, one `vramUsedBytes: null` inside an otherwise-populated series, and a **free-text note** about another GPU application being open. |
| `single-sample.json` | One reading, where min, median and max are all the same value. |
| `nothing-sampled.json` | A record that exists and measures **nothing** — every quantity `null`, `offload: null`. Distinguishes *the sampler did not run* from *the sampler ran and saw nothing*; both render `not measured`. |

## Malformed — each must be REJECTED, loudly

One defect per file, so a test can assert on the specific reason rather than on
"something was wrong".

| File | The defect |
| --- | --- |
| `omitted-field.json` | `cpuLoadPercent` is **omitted** rather than `null`. Measurement fields are required-and-nullable: an omitted key is a sampler bug, and reading it as `not measured` would hide one. |
| `unknown-key.json` | An extra root key (`vramFree`). Schemas here are closed, exactly as the corpus and tool schemas are. |
| `wrong-schema-version.json` | `schemaVersion: "0.9.0"`. A record from another contract version is rejected, not partially understood. |
| `vram-unit-mixup.json` | `vramTotalBytes: 8188` — MiB written into a bytes field, so used VRAM exceeds total. The exact class of error that makes a number a fabrication risk. |
| `no-samples.json` | `samples: []`. A record claiming to be a measurement and containing none is malformed, not empty. |
| `ends-before-it-starts.json` | `endedAtIso` precedes `startedAtIso`. |
| `percent-out-of-range.json` | `gpuUtilizationPercent: 6000`. A percentage outside 0–100 is a unit error. |
