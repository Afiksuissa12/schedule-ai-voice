/**
 * THE CANDIDATE SET, and the argument for each member.
 *
 * "It is popular" is not a reason and does not appear below. Every model here
 * is here because it tests a specific hypothesis about what this product needs,
 * and the set is deliberately small: five models over a twenty-scenario
 * multi-turn corpus is already hundreds of real generations on one laptop GPU,
 * and a larger set would have meant a shallower corpus. The corpus is the part
 * that decides whether the answer is trustworthy.
 *
 * THE HARDWARE CONSTRAINT, measured on the host and not re-derived here:
 * NVIDIA RTX 4060 Laptop, 8188 MiB VRAM. The working budget is ~7.5 GiB for
 * weights plus KV cache, which puts the ceiling at 7-9B parameters at 4-bit.
 * Anything that cannot demonstrably fit is listed as REJECTED with the reason,
 * because "we did not try it" and "we tried it and it did not fit" are
 * different statements and the Founder Review needs the second one.
 */

/**
 * Where a tag comes from, because the two are not interchangeable.
 *
 * `registry` - pullable from the Ollama registry with `ollama pull`. Every
 * candidate was one of these until Mission 2D-R.
 *
 * `local` - created ON THE HOST BY THE OPERATOR from a Modelfile committed in
 * this repository. `ollama pull` CANNOT fetch it and asking it to is an error
 * rather than a slow download, so `eval:pull`, `eval:run` and `eval:models` all
 * have to tell these apart from a registry model that is merely missing. They
 * are also OPT-IN: a local tag never joins the default model list, because most
 * hosts will not have created it and a default run must not fail on a tag the
 * operator never asked for.
 */
export type CandidateOrigin = 'registry' | 'local';

export interface Candidate {
  readonly tag: string;
  /** The hypothesis this model is in the set to test. */
  readonly rationale: string;
  /** Absent means `registry`, which is what every Mission 2 candidate was. */
  readonly origin?: CandidateOrigin;
  /**
   * For `local` tags only: the repo-relative Modelfile it is created from, and
   * the stock tag it is built on top of. Recorded into `models.json` so that a
   * result row for a locally-created model can never be mistaken for a
   * registry model's, and so the provenance survives in the committed evidence.
   */
  readonly localProvenance?: {
    readonly modelfile: string;
    readonly baseTag: string;
    /** What was changed relative to `baseTag`, in one line, for `models.json`. */
    readonly deviation: string;
  };
}

/** Is this tag one the operator has to create by hand rather than pull? */
export function isLocalOrigin(candidate: Candidate): boolean {
  return candidate.origin === 'local';
}

/**
 * The default model list for `eval:run` and `eval:pull`: registry models only.
 * A `local` candidate runs when it is named with `--model`, and not otherwise.
 */
export function defaultBenchmarkTags(): readonly string[] {
  return CANDIDATES.filter((candidate) => !isLocalOrigin(candidate)).map((candidate) => candidate.tag);
}

/** The candidate carrying this tag, if the set knows it. */
export function findCandidate(tag: string): Candidate | undefined {
  return CANDIDATES.find((candidate) => candidate.tag === tag);
}

export const CANDIDATES: readonly Candidate[] = [
  {
    tag: 'qwen2.5:7b-instruct',
    rationale:
      'Named in the mission brief, and the strongest instruction-follower of the 7B generation. It is the ' +
      'control for structured output: if a model cannot reliably emit a native tool call, nothing else about ' +
      'it matters, and qwen2.5 is the one most likely to. It is also the provider task\'s current default, so ' +
      'it is the incumbent this benchmark has to beat or confirm.',
  },
  {
    tag: 'mistral:7b-instruct',
    rationale:
      'Named in the mission brief. The oldest architecture in the set and the smallest at 7.2B, which makes ' +
      'it the floor: it answers "how much does the extra billion parameters actually buy on this task?" If it ' +
      'keeps up, the cheapest option wins and that is worth knowing.',
  },
  {
    tag: 'llama3.1:8b-instruct-q4_K_M',
    rationale:
      'Named in the mission brief. NOTE THE TAG: plain `llama3.1:8b-instruct` does not exist in the Ollama ' +
      'registry - the instruct builds are only published with an explicit quantization suffix - so the brief\'s ' +
      'name would never have resolved. Llama 3.1 was trained with tool use as a first-class objective and is ' +
      'the reference point most external tool-calling evaluations are stated against.',
  },
  {
    tag: 'aya-expanse:8b',
    rationale:
      'ADDED, and the addition this harness would defend hardest. The corpus the Founder mandated contains ' +
      'Hebrew and mixed Hebrew/English conversations, and every other candidate is a predominantly-English ' +
      'model that happens to have seen some Hebrew. aya-expanse is Cohere\'s explicitly multilingual release, ' +
      'trained across 23 languages including Hebrew. Without it the Hebrew result would only tell us how badly ' +
      'English-first models cope, not whether the requirement is achievable at this size at all.',
  },
  {
    tag: 'hermes3:8b',
    rationale:
      'ADDED to isolate one variable. It is a fine-tune of Llama-3.1-8B specifically tuned for multi-turn ' +
      'conversation and tool use, and its base model is ALSO in this set. So the pair answers a question no ' +
      'single model can: does a conversation-focused fine-tune measurably improve human-likeness, or is the ' +
      'base model already at the ceiling of what 8B can do here? Note it ships at Q4_0 rather than Q4_K_M, ' +
      'which is a slightly cruder quantization - recorded, and a mild confound worth stating.',
  },
  {
    // LAST IN THE ARRAY ON PURPOSE. `generateReportArtefacts` orders every table
    // by candidate order and `rebenchmarkReadiness.test.ts` pins
    // `qwen2.5:7b-instruct` first; appending is the only position that changes
    // no existing row and no existing ordering.
    tag: 'm2b/aya-expanse-schema-tools:v1',
    origin: 'local',
    localProvenance: {
      modelfile: 'src/eval/models/modelfiles/aya-expanse-8b-schema-tools.Modelfile',
      baseTag: 'aya-expanse:8b',
      deviation:
        'Chat template renders each tool as the complete function JSON (schema, enums, required, nested ' +
        'properties) instead of the stock Python stub, which reads only name/type/description and drops ' +
        'every enum and required list. Also drops the stock instruction to call `directly-answer`, which ' +
        'is not one of this system\'s nine tools. No PARAMETER and no SYSTEM override; weights identical.',
    },
    rationale:
      'ADDED BY MISSION 2D-R AS A CONTROLLED EXPERIMENT, and it is the only candidate that is not a ' +
      'published model. `aya-expanse:8b` was recorded at 14.6% argument validity, and the wrapper fix ' +
      'explained only part of that: a free-text `outcome` on 7 of 7 `record_call_outcome` calls and a ' +
      'free-text `urgency` on 3 of 5 `transfer_to_human` calls survived it. The operator-captured template ' +
      'shows why - it renders tool parameters as a Python stub carrying only name, type and description, ' +
      'so `enum` and `required` NEVER REACHED THE MODEL, while qwen2.5\'s template sends the whole schema ' +
      'as JSON. This tag is stock aya with that one defect corrected, so the three-way run against stock ' +
      'aya and stock qwen2.5 separates "this model cannot follow a schema" from "this model was never ' +
      'shown one". OPT-IN: the operator creates it (EVAL_HARNESS.md § 9.8); nothing here pulls or runs it, ' +
      'and it is excluded from the default model list so a host without it is unaffected.',
  },
];

export interface RejectedCandidate {
  readonly tag: string;
  readonly reason: string;
}

/**
 * Considered and not pulled. Listed so the shortlist is an argument rather than
 * an assertion.
 */
export const REJECTED: readonly RejectedCandidate[] = [
  {
    tag: 'qwen2.5:14b-instruct',
    reason:
      'REJECTED ON VRAM, on the registry\'s published 4-bit size of roughly 9 GiB for the weights alone, ' +
      'before any KV cache, against an 8188 MiB card. NOT MEASURED HERE - it was not pulled, precisely ' +
      'because it could only run by spilling into system RAM, at which point every latency number would ' +
      'describe the spill rather than the model. Worth revisiting on a 12 GiB card.',
  },
  {
    tag: 'mistral-small:22b, gemma2:27b and larger',
    reason:
      'REJECTED ON VRAM, decisively and without measurement: 13 GiB and up at 4-bit, against 8 GiB of card. ' +
      'Out of scope for this machine at any context length.',
  },
  {
    // The 3,714 below is NOT the only figure in this repository for the fixed
    // prompt cost. `.env.example` and DEFAULT_LOCAL_LLM_NUM_CTX in
    // src/llm/localLlmProvider.ts both state 3,732 for the same quantity, and
    // unlike this one they name their measurement (`npm run llm:smoke`,
    // 2026-09-23, as a whole minimal turn's prompt_eval_count). The 18-token gap
    // is unexplained - plausibly the one-sentence utterance the smoke turn sends,
    // but nothing records that. Neither figure is being changed on a guess: this
    // string is quoted verbatim in the committed results.json, and the review
    // records the disagreement at S 5.2.6 instead. Re-measure before relying on
    // either to the token.
    tag: 'llama3.2:3b, qwen2.5:3b and other sub-4B models',
    reason:
      'REJECTED ON EXPECTED CAPABILITY, not on size - they would fit comfortably. The fixed prompt floor for ' +
      'a real turn here is 3,714 tokens of system prompt and tool schemas, and the mission asks for 7-9B ' +
      'unless there is a stated reason otherwise. This harness has no evidence either way about 3B models on ' +
      'this task; the reason is the brief, not a measurement. If latency turns out to be the binding ' +
      'constraint for voice, this is the first assumption that should be re-tested.',
  },
  {
    tag: 'gemma2:9b',
    reason:
      'DEPRIORITISED, not disqualified. It is the other credible multilingual-ish option at this size, but ' +
      'the multilingual slot in the set went to aya-expanse:8b, which is explicitly trained for it, and a ' +
      'sixth model would have cost corpus depth. No claim is made here about its tool-calling support: it ' +
      'was not pulled and therefore not measured. A follow-up run that adds it would be cheap.',
  },
];
