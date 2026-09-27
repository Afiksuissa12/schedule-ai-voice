/**
 * Sentences and tokens - the step BEFORE any claim vocabulary is consulted.
 *
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 * Every rule in this gate is expressed over whole tokens inside one sentence,
 * for two reasons that are both load-bearing:
 *
 *  1. TOKENS, because JavaScript's `\b` is defined on ASCII word characters, so
 *     a word-boundary regex can never match a Hebrew word. Token equality works
 *     in every script. This is the same conclusion Mission 2B reached for the
 *     scheduling grammar (`src/scheduling/lexicon/types.ts`), and it is reached
 *     again here rather than assumed.
 *  2. SENTENCES, because that is the scope a negation actually has. The real
 *     `aya-expanse:8b` defect reads `אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה...`
 *     - a negator (`אין`) in one sentence and a false completion in the next. A
 *     detector that scoped negation to the whole text would be talked out of the
 *     defect by the reassurance in front of it.
 *
 * CRLF
 * ---------------------------------------------------------------------------
 * This repository's working trees are CRLF (`core.autocrlf=true`, no
 * `.gitattributes`), and a parser that ignored that once broke
 * `npm run check:anti-scripting` outright - the allowance regex could not
 * consume the `\r` a CRLF line leaves behind, so the check's verdict depended on
 * how the reader had cloned (`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`
 * § 13). Model output arrives with whatever line endings the model felt like, so
 * every boundary class below names `\r` explicitly and a test asserts that
 * `"...\r\n..."` and `"...\n..."` produce identical tokens.
 */
import { normalizeScript } from '../../scheduling/lexicon/script.js';

/** One token, normalised for matching and located in the ORIGINAL text. */
export interface ClaimToken {
  /** Script-normalised and lower-cased. What a lexicon form is compared to. */
  readonly text: string;
  /** Offset of this token in the sentence's own text. */
  readonly offset: number;
}

/** One sentence of the reviewed text, with its tokens. */
export interface ClaimSentence {
  /** 0-based position of this sentence in the text. */
  readonly index: number;
  /** The sentence as the model wrote it, trimmed. Used for an audit excerpt. */
  readonly raw: string;
  readonly tokens: readonly ClaimToken[];
  /** True when the sentence ends in a question mark. */
  readonly interrogative: boolean;
}

/**
 * Characters that END a sentence.
 *
 * `\r` and `\n` are both here: a model that answers in bullet points separates
 * its assertions by a newline and nothing else, and treating a line break as
 * continuation would merge a negated line into an asserted one.
 *
 * Hebrew's own stops - PASEQ, SOF PASUQ, NUN HAFUKHA - are not listed because
 * `normalizeScript` has already mapped them to a space by the time this runs.
 */
const SENTENCE_TERMINATORS = new Set(['.', '!', '?', ';', '\n', '\r', '…']);

/**
 * Characters that may sit INSIDE a token.
 *
 * `:` keeps `15:00` whole. `-` keeps `ב-15:00` and `q4_k_m`-shaped identifiers
 * whole and is what the maqaf normalises to. `'` keeps `you're` and `o'clock`
 * whole. `_` and `/` keep identifier shapes whole. Everything else that is not a
 * letter or a digit is a separator.
 */
const TOKEN_INNER_CHARACTERS = new Set([':', '-', "'", '_', '/', '.', '+']);

function isTokenCharacter(character: string): boolean {
  if (TOKEN_INNER_CHARACTERS.has(character)) return true;
  // Unicode-aware on purpose: `\w` is ASCII-only and would split every Hebrew
  // word into nothing at all.
  return /[\p{L}\p{N}]/u.test(character);
}

/**
 * Split text into sentences and tokens.
 *
 * Pure, allocation-only, and the only place in this module that touches the
 * shape of a string. `normalizeScript` runs FIRST, per sentence, so niqqud, bidi
 * controls and the maqaf are gone before any comparison happens - exactly as the
 * scheduling resolver does it.
 */
export function readSentences(text: string): readonly ClaimSentence[] {
  const sentences: ClaimSentence[] = [];
  let current = '';
  let terminator = '';

  const flush = (): void => {
    const raw = current.trim();
    if (raw.length > 0) {
      sentences.push({
        index: sentences.length,
        raw,
        tokens: readTokens(raw),
        interrogative: terminator === '?',
      });
    }
    current = '';
    terminator = '';
  };

  const characters = [...text];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] as string;
    if (SENTENCE_TERMINATORS.has(character)) {
      // A `.` with a digit on BOTH sides is a decimal point or a written date
      // (`15.30`, `5.3`), not a full stop. A `.` with a digit only behind it is
      // a full stop after a number - `booked for 3.` - and must end the
      // sentence, which is why this looks forward as well as back.
      if (character === '.' && isDigit(characters[index - 1]) && isDigit(characters[index + 1])) {
        current += character;
        continue;
      }
      terminator = character;
      flush();
      continue;
    }
    current += character;
  }
  flush();

  return sentences;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && /\p{N}/u.test(character);
}

/** Tokenise one sentence. Exported for the tests that pin the token rules. */
export function readTokens(sentence: string): readonly ClaimToken[] {
  const normalized = normalizeScript(sentence).text;
  const tokens: ClaimToken[] = [];
  let buffer = '';
  let start = 0;

  const flush = (): void => {
    const trimmed = trimTokenEdges(buffer);
    if (trimmed.length > 0) tokens.push({ text: trimmed.toLowerCase(), offset: start });
    buffer = '';
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] as string;
    if (isTokenCharacter(character)) {
      if (buffer.length === 0) start = index;
      buffer += character;
      continue;
    }
    flush();
  }
  flush();

  return tokens;
}

/**
 * Strip inner-characters that ended up on an edge.
 *
 * `(booked)` arrives as `booked`; `"CONF123456".` arrives with a trailing dot;
 * `-15:00` keeps its digits. Only the EDGES are touched, so `ב-15:00` and
 * `you're` survive intact.
 */
function trimTokenEdges(value: string): string {
  let out = value;
  while (out.length > 0 && TOKEN_INNER_CHARACTERS.has(out[0] as string)) out = out.slice(1);
  while (out.length > 0 && TOKEN_INNER_CHARACTERS.has(out.at(-1) as string)) out = out.slice(0, -1);
  return out;
}

/**
 * How many tokens of `forms` match at `position`, longest form first.
 *
 * Returns the matched length and the form that matched, or `null`. The
 * longest-match rule is what keeps `'אחרי הצהריים'` from being read as
 * `'הצהריים'` in the scheduling lexicon and what keeps `'has been booked'` from
 * being read as `'booked'` here.
 */
export function matchLongestForm(
  tokens: readonly ClaimToken[],
  position: number,
  forms: readonly string[],
): { readonly length: number; readonly form: string } | null {
  const first = tokens[position]?.text;
  if (first === undefined) return null;

  // Only forms that BEGIN with the token at this position can possibly match, so
  // only those are looked at. See `formIndex` for why that matters.
  const candidates = formIndex(forms).get(first);
  if (candidates === undefined) return null;

  // Longest first, and earliest-declared among equal lengths, which is exactly
  // what the previous full scan produced.
  for (const candidate of candidates) {
    let matched = true;
    for (let offset = 1; offset < candidate.tokens.length; offset += 1) {
      if (tokens[position + offset]?.text !== candidate.tokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return { length: candidate.tokens.length, form: candidate.form };
  }

  return null;
}

interface IndexedForm {
  readonly form: string;
  readonly tokens: readonly string[];
}

/**
 * One forms array, indexed by FIRST TOKEN - computed once per array.
 *
 * WHY, ON TOP OF `FORM_TOKENS`
 * ---------------------------------------------------------------------------
 * `matchLongestForm` is called at every token position against every forms array
 * of every registered lexicon. The split cache below removed the per-call
 * allocation but left the per-call LOOP: the cost stayed linear in the number of
 * forms, which is fine for a lexicon of 150 and is not fine for one of 800.
 *
 * Adding the English first-person preterite frames took the English completion
 * lexicon from 112 forms to 775 (`lexicon/en.ts` explains why they are generated
 * rather than typed out), and measured on the same 7,402-character worst-case
 * turn the published table uses, the full scan went from a p50 of 6.1 ms to
 * 14.1 ms - a 2.3x regression for a data change that should have been free.
 *
 * Grouping by first token makes the common case - no form starts with this token -
 * one `Map.get` that returns `undefined`, regardless of how many forms there are.
 * The same 7,402-character turn comes back to 3.6 ms - against 3.4 ms for the OLD
 * 152-form lexicon through this same index, so 5.4x the data now costs 5% more
 * time, and both are faster than the 6.1 ms the full scan took before any of this.
 * A lexicon is free to grow. `npm run qa:claim-gate-latency -- --runs 600` reports
 * 3.847 ms p50 on the same sample; the four figures above were taken back to back
 * in one session, which is what makes them comparable to each other.
 *
 * Keyed by array IDENTITY in a `WeakMap`, because every forms array in a lexicon
 * module is a frozen literal built once at import, and a test that passes an
 * ad-hoc array gets its entry collected with it.
 */
const FORM_INDEX = new WeakMap<readonly string[], Map<string, readonly IndexedForm[]>>();

function formIndex(forms: readonly string[]): Map<string, readonly IndexedForm[]> {
  const cached = FORM_INDEX.get(forms);
  if (cached !== undefined) return cached;

  const built = new Map<string, IndexedForm[]>();
  for (const form of forms) {
    const tokens = splitForm(form);
    const first = tokens[0];
    if (first === undefined) continue;
    const bucket = built.get(first);
    if (bucket === undefined) built.set(first, [{ form, tokens }]);
    else bucket.push({ form, tokens });
  }
  // A stable sort, so equal-length forms keep the order they were declared in.
  for (const bucket of built.values()) bucket.sort((left, right) => right.tokens.length - left.tokens.length);

  FORM_INDEX.set(forms, built);
  return built;
}

/**
 * A lexicon form, split into the tokens it has to match - computed ONCE.
 *
 * Every lexicon form is a frozen string literal, so its split is a pure function
 * of a small fixed set of inputs. `matchLongestForm` is called at every token
 * position against every form in every registered lexicon, which on a long turn
 * is hundreds of thousands of calls; splitting inside it allocated an array per
 * call and dominated the whole gate's cost. Measured on a 7,268-character turn -
 * the size of the worst real one in the committed benchmark - this cache took the
 * detector from a p50 of 72.4 ms to 7.7 ms, and a realistic 98-character reply
 * from 0.59 ms to 0.08 ms. The cache is unbounded only in the sense that the set
 * of lexicon forms is: every key is a frozen literal in a lexicon module.
 */
const FORM_TOKENS = new Map<string, readonly string[]>();

function splitForm(form: string): readonly string[] {
  const cached = FORM_TOKENS.get(form);
  if (cached !== undefined) return cached;
  const split = form.split(' ').filter((part) => part.length > 0);
  FORM_TOKENS.set(form, split);
  return split;
}

/** True when any of `forms` matches anywhere in `tokens`. */
export function containsForm(tokens: readonly ClaimToken[], forms: readonly string[]): string | null {
  for (let position = 0; position < tokens.length; position += 1) {
    const hit = matchLongestForm(tokens, position, forms);
    if (hit) return hit.form;
  }
  return null;
}
