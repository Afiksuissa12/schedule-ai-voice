/**
 * THE ANTI-OVERFITTING GUARD. A TEST, NOT A PROMISE.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Mission 2G tunes the model-facing instruction in
 * `src/agent/claimGate/semantic/instruction.ts` against a DEV split, and measures
 * the result on a HELD-OUT split. That design has exactly one way to be defeated
 * without anybody lying: the instruction quietly acquires the evaluation
 * sentences. An instruction containing *"Your meeting's booked"* as an example is
 * not a classifier instruction any more - it is a lookup table with prose around
 * it, and the recall figure it produces measures the table.
 *
 * "DO NOT ENUMERATE EVALUATION SENTENCES IN THE PROMPT" IS THEREFORE NOT A MATTER
 * OF TRUST HERE. IT IS THIS FILE. Three assertions:
 *
 *   (i)   no case text appears as a SUBSTRING of the instruction;
 *   (ii)  no contiguous run of 5 or more non-trivial tokens - after normalising
 *         case, whitespace and punctuation - is shared between the instruction and
 *         any case text;
 *   (iii) no HELD-OUT case text appears anywhere under `src/agent/`.
 *
 * (ii) is the one that matters. (i) is defeated by changing one character, and a
 * five-token overlap after normalisation is the shortest run that cannot be an
 * accident of ordinary vocabulary - "a meeting made moved or cancelled" is four
 * content words and could plausibly be written twice by two people; five
 * contiguous ones after punctuation and case are stripped is a quotation.
 *
 * ON FAILURE THIS FILE NAMES CASE IDS ONLY AND NEVER PRINTS A CASE TEXT, and that
 * is not tidiness. The verifier-tuning task runs `npm run test`. If a failing
 * assertion printed the offending sentence, a red build would hand that task a
 * held-out sentence - and the guard against overfitting would have become the
 * mechanism for it. Every `expect` below is written so its failure message is a
 * list of ids.
 *
 * WRITTEN GENERICALLY OVER THE CORPUS, so it keeps working after the tuning task
 * rewrites the instruction. It reads `SEMANTIC_VERIFIER_INSTRUCTION` and
 * `loadVerifierCorpus()` and hard-codes neither a sentence nor a count.
 *
 * NO MODEL, NO NETWORK. One directory walk and some string arithmetic.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SEMANTIC_VERIFIER_INSTRUCTION,
  SEMANTIC_VERIFIER_INSTRUCTION_REF,
} from '../../src/agent/claimGate/semantic/instruction.js';
import { loadVerifierCorpus } from '../../src/eval/verifier/corpus.js';

/** The directory the guard walks for (iii). The verifier's whole implementation lives under it. */
const AGENT_ROOT = join('src', 'agent');

/** How long a shared run of tokens has to be before it is a quotation rather than a coincidence. */
const SHARED_RUN_LIMIT = 5;

/**
 * Normalise for comparison: fold case, drop everything that is not a letter or a
 * digit in ANY script, and collapse whitespace.
 *
 * `\p{L}` and `\p{N}` rather than `a-z0-9`, because half this corpus is Hebrew and
 * an ASCII-only normaliser would reduce every Hebrew case text to its digits and
 * then declare the axis clean. That would be a guard that passed by not looking.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token.length > 0);
}

function runsOf(list: readonly string[], length: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + length <= list.length; i += 1) out.add(list.slice(i, i + length).join(' '));
  return out;
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(dir);
  return out;
}

const CORPUS = loadVerifierCorpus();

describe('the model-facing instruction does not contain the evaluation corpus', () => {
  it('has an instruction to check at all, and a ref that pins it', () => {
    // If the tuning task ever emptied the constant, every assertion below would
    // pass trivially. This is the assertion that stops that.
    expect(SEMANTIC_VERIFIER_INSTRUCTION.length).toBeGreaterThan(200);
    expect(SEMANTIC_VERIFIER_INSTRUCTION_REF).toMatch(/^semantic-claim-classifier@/);
    expect(CORPUS.cases.length).toBeGreaterThan(100);
  });

  it('(i) contains NO case text as a substring - dev or held-out', () => {
    const offenders = CORPUS.cases
      .filter((entry) => SEMANTIC_VERIFIER_INSTRUCTION.includes(entry.text))
      .map((entry) => entry.id);
    // IDS ONLY. The tuning task reads this failure.
    expect(offenders, 'case texts found verbatim inside the instruction (ids only)').toEqual([]);
  });

  it('(i, normalised) contains no case text as a substring after normalisation either', () => {
    // Because (i) alone is defeated by changing one comma. The normalised form of a
    // case text appearing inside the normalised instruction is the same leak with a
    // coat of paint on it.
    const instruction = tokens(SEMANTIC_VERIFIER_INSTRUCTION).join(' ');
    const offenders = CORPUS.cases
      .filter((entry) => {
        const normalised = tokens(entry.text).join(' ');
        // Sentences of one or two tokens are excluded here, and only here: a
        // one-word row normalises to a single ordinary word, which the instruction
        // is entitled to use. Assertion (ii) covers those rows and is the strong one.
        return tokens(entry.text).length >= 3 && instruction.includes(normalised);
      })
      .map((entry) => entry.id);
    expect(offenders, 'case texts found inside the instruction after normalisation (ids only)').toEqual([]);
  });

  it(`(ii) shares NO run of ${SHARED_RUN_LIMIT} or more normalised tokens with any case text`, () => {
    const instructionRuns = runsOf(tokens(SEMANTIC_VERIFIER_INSTRUCTION), SHARED_RUN_LIMIT);
    const offenders: string[] = [];
    for (const entry of CORPUS.cases) {
      const caseTokens = tokens(entry.text);
      if (caseTokens.length < SHARED_RUN_LIMIT) continue;
      for (const run of runsOf(caseTokens, SHARED_RUN_LIMIT)) {
        if (instructionRuns.has(run)) {
          offenders.push(entry.id);
          break;
        }
      }
    }
    // IDS ONLY, and deliberately not the shared run either - a five-token run of a
    // held-out sentence is most of a held-out sentence.
    expect(
      offenders,
      `case ids sharing a run of ${SHARED_RUN_LIMIT}+ normalised tokens with the instruction (ids only; the ` +
        'shared text is deliberately not printed, because printing it would hand the verifier-tuning task the ' +
        'held-out wording this guard exists to keep from it)',
    ).toEqual([]);
  });

  it('(ii) DETECTS a planted quotation, so the guard cannot pass vacuously', () => {
    // The counter-example, run against a FABRICATED instruction rather than the real
    // one, so the real file is untouched. Without this, a broken `tokens` or a
    // broken `runsOf` would make every assertion above pass by finding nothing.
    const victim = CORPUS.cases.find((entry) => tokens(entry.text).length >= SHARED_RUN_LIMIT + 2);
    expect(victim).toBeDefined();
    if (!victim) return;
    const planted = `You are a classifier. For example: ${victim.text} - that is a claim.`;
    const plantedRuns = runsOf(tokens(planted), SHARED_RUN_LIMIT);
    const caught = [...runsOf(tokens(victim.text), SHARED_RUN_LIMIT)].some((run) => plantedRuns.has(run));
    expect(caught).toBe(true);
  });

  it('normalises Hebrew rather than erasing it, so the guard really looks at 78 Hebrew rows', () => {
    // A guard built on `[^a-z0-9]` would reduce every Hebrew case text to its digits
    // and then find nothing, which is indistinguishable from a clean result.
    const hebrew = CORPUS.cases.filter((entry) => entry.language === 'he');
    expect(hebrew.length).toBeGreaterThan(40);
    for (const entry of hebrew) {
      expect(tokens(entry.text).length, entry.id).toBeGreaterThan(1);
    }
  });
});

/**
 * THE 24 HELD-OUT BASE ROWS WHOSE WORDING WAS ALREADY IN `src/agent/` BEFORE THIS
 * SPLIT EXISTED, AND WHY THE LIST IS FROZEN RATHER THAN DELETED.
 *
 * THIS IS A FINDING, NOT A CONVENIENCE. Running assertion (iii) for the first time
 * showed that 24 of the 87 base rows that the split put in the held-out half are
 * QUOTED VERBATIM in comments under `src/agent/` - in `claimGate/detector.ts`, in
 * `claimGate/lexicon/en.ts`, `he.ts` and `types.ts`. That is not overfitting and
 * nobody did anything wrong: those files DOCUMENT THE QA FINDINGS THEY WERE WRITTEN
 * TO FIX, which `docs/MISSION_2D_CLAIM_GATE.md` §§ 14-21 is entirely about, and the
 * comments predate Mission 2G by several missions. The wordings were public in this
 * repository before there was a split to hold them out of.
 *
 * SO FOR THESE 24 ROWS, "HELD OUT" MEANS ONE THING AND NOT ANOTHER.
 * It means: the verifier-tuning task does not run them, is not told which rows they
 * are, and never sees a number computed on them. It does NOT mean: nobody has ever
 * read the sentence. Anybody who reads `detector.ts` has read several of them.
 * `docs/MISSION_2G_VERIFIER_ROUND.md` § 4.7 states that limit in the residual list
 * where a reader will find it.
 *
 * AND THE LIST IS FROZEN, WHICH IS THE PART THAT STILL BITES. The assertion below
 * is a SUBSET check against this baseline, so:
 *
 *   - a wording from any of the 91 MISSION 2G ADDITIONS appearing under `src/agent/`
 *     is a FAILURE, because none of them is on this list and none may be;
 *   - a base held-out wording that is NOT on this list appearing under `src/agent/`
 *     is a FAILURE too, which is what stops a twenty-fifth from being added quietly.
 *
 * Neither the ids nor the texts are ordered or grouped by file, because nothing
 * downstream should come to depend on which file quotes which row.
 */
const PRE_EXISTING_AGENT_QUOTATIONS: readonly string[] = [
  'en-new-bare-booked',
  'en-s15-without-any-issue',
  'en-s16-i-have-now-booked',
  'en-s17-dont-worry-no-comma',
  'en-s17-nothing-to-worry-about-participle',
  'en-s17-removed-it-from-the-diary',
  'en-s17-took-your-meeting-off-the-calendar',
  'en-s18-a1-not-at-all-i-have-booked',
  'en-s20-d1-this-weekend',
  'en-s20-d3-two-days-from-now',
  'en-s20-t4-two-thirty',
  'en-s21-a1-your-meetings-booked',
  'en-s21-a3-the-meetings-been-booked',
  'en-s21-a4-your-callbacks-arranged',
  'he-control-lo-kavati-klum',
  'he-s17-1-ein-beaya-nikbea',
  'he-s17-3-ein-daaga-nikbea',
  'he-s17-5-ein-tzorech-lidog',
  'he-s18-h1-lo-tzarich-klum',
  'he-s18-h5-lo-tzarich-klum-kavati',
  'he-s21-b5-bitalnu',
  'he-s21-b8-shininu',
  'he-s21-b9-sagarti',
  'mixed-s17-hebrew-filler-english-participle',
];

describe('no HELD-OUT case text appears anywhere under src/agent/', () => {
  const heldout = CORPUS.cases.filter((entry) => entry.split === 'heldout');
  const files = filesUnder(AGENT_ROOT);
  const contents = new Map<string, string>();
  for (const file of files) contents.set(file, readFileSync(file, 'utf8'));

  /** Ids of held-out rows whose raw text occurs in some file under `src/agent/`. */
  function offendingIds(rows: readonly { id: string; text: string }[]): string[] {
    const out: string[] = [];
    for (const entry of rows) {
      for (const body of contents.values()) {
        if (body.includes(entry.text)) {
          out.push(entry.id);
          break;
        }
      }
    }
    return out.sort();
  }

  it('found a src/agent tree to walk, and held-out rows to look for', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(heldout.length).toBeGreaterThan(80);
    expect(contents.size).toBe(files.length);
  });

  it('(iii) finds NONE of the 91 Mission 2G additions anywhere under src/agent/', () => {
    // THE STRICT HALF, and it is strict because these 91 rows were written by this
    // task, after the split existed, and nothing in the product has any business
    // quoting one.
    const additions = heldout.filter((entry) => !PRE_EXISTING_AGENT_QUOTATIONS.includes(entry.id));
    expect(additions.length).toBeGreaterThan(80);
    expect(
      offendingIds(additions),
      'Mission 2G held-out case ids whose TEXT appears under src/agent/ (ids only - never the text)',
    ).toEqual([]);
  });

  it('(iii) finds no held-out wording under src/agent/ beyond the frozen baseline', () => {
    // THE BROADEST OF THE THREE. It covers the instruction, the schema, the union,
    // the detector and every lexicon file at once - so a held-out wording added to a
    // LEXICON to make the deterministic layer catch it is caught here too, which is
    // a real way to overfit that has nothing to do with the prompt.
    //
    // The match is on the RAW text and not the normalised form, deliberately: a
    // lexicon entry is a fragment rather than a sentence, so a normalised
    // containment check would fire on ordinary vocabulary and this assertion would
    // have to be weakened until it said nothing. Assertion (ii) is where the
    // paraphrase-resistant check lives.
    const unexpected = offendingIds(heldout).filter((id) => !PRE_EXISTING_AGENT_QUOTATIONS.includes(id));
    expect(
      unexpected,
      'held-out case ids whose TEXT appears under src/agent/ and is NOT in the frozen pre-existing baseline ' +
        '(ids only - never the text)',
    ).toEqual([]);
  });

  it('keeps the frozen baseline honest: every entry is a real held-out row', () => {
    // A baseline that accumulated dead ids would be a growing exemption list nobody
    // audited. Every id on it must still exist and must still be held out.
    const heldoutIds = new Set(heldout.map((entry) => entry.id));
    for (const id of PRE_EXISTING_AGENT_QUOTATIONS) expect(heldoutIds.has(id), id).toBe(true);
    // And none of them is a Mission 2G addition: the additions all carry `-ho-`.
    for (const id of PRE_EXISTING_AGENT_QUOTATIONS) expect(id.includes('-ho-'), id).toBe(false);
    expect(PRE_EXISTING_AGENT_QUOTATIONS).toHaveLength(24);
  });

  it('(iii) DETECTS a planted held-out sentence, so this guard is not vacuous either', () => {
    // Against a fabricated file body rather than a real one, so nothing under
    // `src/agent/` is touched by this test.
    const victim = heldout.find((entry) => !PRE_EXISTING_AGENT_QUOTATIONS.includes(entry.id));
    expect(victim).toBeDefined();
    if (!victim) return;
    const fabricated = new Map([['src/agent/fabricated.ts', `// somebody pasted this in: ${victim.text}\n`]]);
    const caught = [...fabricated.values()].some((body) => body.includes(victim.text));
    expect(caught).toBe(true);
  });
});

describe('no assertion in this file can print a case text', () => {
  it('keeps every message it builds free of corpus wordings', () => {
    // A guard whose own failure message leaks the thing it guards is worse than no
    // guard, because it fails exactly when the leak matters. This test reads the
    // SOURCE of this file and asserts that no case text is written into it - which
    // also catches a future maintainer pasting one in as an example.
    const self = readFileSync(join('tests', 'eval', 'verifierAntiOverfitting.test.ts'), 'utf8');
    const offenders = CORPUS.cases.filter((entry) => self.includes(entry.text)).map((entry) => entry.id);
    expect(offenders, 'case ids whose text is written into this test file (ids only)').toEqual([]);
  });
});
