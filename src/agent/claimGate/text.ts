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
 *  2. SENTENCES, because that is the widest scope a negation can have. The real
 *     `aya-expanse:8b` defect reads `אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה...`
 *     - a negator (`אין`) in one sentence and a false completion in the next. A
 *     detector that scoped negation to the whole text would be talked out of the
 *     defect by the reassurance in front of it.
 *  3. CLAUSES, because the sentence is not narrow enough either, and that was a
 *     live fail-open defect rather than a theory. `אין דאגה, הכל בסדר! הפגישה
 *     נקבעה בהצלחה.` is caught only because the model happened to type `!`
 *     before the completion; `אין דאגה, הפגישה נקבעה בהצלחה.` - the identical
 *     reassurance with a comma - was RELEASED and persisted, as were
 *     `Don't worry, your meeting is booked for Thursday at 2pm.` and
 *     `I cannot take payments, but I have booked your meeting...`. Independent QA
 *     drove eight such turns through the real `AgentTurnService` against a real
 *     database: the ledger held nothing, and every one reached the caller with
 *     `outcome=NO_MATERIAL_CLAIM`. Punctuation is not a safety property, so the
 *     boundary a negator may not cross is the CLAUSE (`readTokens` marks one on
 *     every token) and not one character class wider.
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
  /**
   * 0-based PUNCTUATION clause this token sits in, within its sentence.
   *
   * Contiguous and monotonically non-decreasing: the first token of a sentence
   * is always clause 0. A language's own coordinating conjunctions break clauses
   * too, but those are locale DATA (`ClaimLexicon.clauseBreakers`) and this
   * module holds no language-specific literal, so the detector layers them on
   * top of this index rather than this module guessing at them.
   */
  readonly clause: number;
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
  /** How many punctuation clauses the sentence has. 0 for a sentence with no tokens. */
  readonly clauseCount: number;
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
 * Characters that end a CLAUSE without ending the sentence.
 *
 * WHY THIS SET EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * A negator governs its own clause, not everything the model typed before the
 * next full stop. With only `SENTENCE_TERMINATORS` to go on, `אין דאגה, הכל
 * בסדר! הפגישה נקבעה בהצלחה.` is detected and `אין דאגה, הפגישה נקבעה בהצלחה.`
 * is not - the same reassurance, the same false completion, one punctuation mark
 * apart. That was reachable in English and Hebrew, released to the caller and
 * persisted (see the header). So a comma has to bound a negation the way a full
 * stop does.
 *
 * WHY THE DASH AND THE COLON ARE HERE TOO
 * ---------------------------------------------------------------------------
 * `No need to worry, I haven't had any trouble - your meeting is booked for
 * Thursday at 2pm.` puts a genuine negation (`haven't`, about the trouble) and a
 * false completion on opposite sides of a DASH. The comma alone would leave that
 * leak open, so every mark a model actually uses to join clauses is listed: the
 * ASCII hyphen, the en and em dashes, the colon, and the brackets a parenthetical
 * sits in.
 *
 * `-` and `:` are also `TOKEN_INNER_CHARACTERS` - they have to be, or `ב-15:00`
 * and `15:00` come apart - so they break a clause only where they are NOT inside
 * a token. `readTokens` resolves that by asking whether the character survived
 * `trimTokenEdges`: an interior `-` is part of the token and separates nothing,
 * an edge or standalone one is punctuation and separates.
 *
 * `"` is deliberately ABSENT. A model quoting the contact - `you said "nothing
 * yet"` - is not changing clause, and `"CONF123456"` must stay one token's worth
 * of one clause.
 */
const CLAUSE_SEPARATORS = new Set([',', '-', '–', '—', ':', '(', ')', '[', ']']);

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
      const tokens = readTokens(raw);
      sentences.push({
        index: sentences.length,
        raw,
        tokens,
        interrogative: terminator === '?',
        clauseCount: (tokens.at(-1)?.clause ?? -1) + 1,
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

/**
 * Tokenise one sentence, marking each token's CLAUSE.
 *
 * Exported for the tests that pin the token rules and the clause rule. The
 * clause counter only ever advances when a token is actually pushed, so the
 * indices are contiguous from 0 and a sentence that opens with punctuation -
 * `- nothing is booked yet`, the bullet shape a model answers in - does not
 * start at clause 1 with nothing in clause 0.
 */
export function readTokens(sentence: string): readonly ClaimToken[] {
  const normalized = normalizeScript(sentence).text;
  const tokens: ClaimToken[] = [];
  let buffer = '';
  let start = 0;
  let clause = 0;
  let pendingBreak = false;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const edges = tokenEdges(buffer);
    const text = buffer.slice(edges.start, edges.end);

    if (text.length === 0) {
      // The whole run was punctuation the token rules would have eaten - ` - `,
      // ` -- `, ` : `. It is a separator and nothing else.
      if (hasClauseSeparator(buffer)) pendingBreak = true;
      buffer = '';
      return;
    }

    // An edge separator belongs to the gap, not to the token: `Details:` ends a
    // clause and `15:00` does not.
    if (hasClauseSeparator(buffer.slice(0, edges.start))) pendingBreak = true;
    if (pendingBreak && tokens.length > 0) clause += 1;
    pendingBreak = false;
    tokens.push({ text: text.toLowerCase(), offset: start, clause });
    if (hasClauseSeparator(buffer.slice(edges.end))) pendingBreak = true;

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
    if (CLAUSE_SEPARATORS.has(character)) pendingBreak = true;
  }
  flush();

  return tokens;
}

function hasClauseSeparator(value: string): boolean {
  for (const character of value) {
    if (CLAUSE_SEPARATORS.has(character)) return true;
  }
  return false;
}

/**
 * Where the token really starts and ends inside a run of token characters.
 *
 * `(booked)` arrives as `booked`; `"CONF123456".` arrives with a trailing dot;
 * `-15:00` keeps its digits. Only the EDGES are touched, so `ב-15:00` and
 * `you're` survive intact.
 *
 * Returns the bounds rather than the trimmed string because the CALLER needs the
 * offcuts: a `-` or a `:` that was trimmed off an edge is punctuation between
 * two clauses, and the identical character left inside the token is not.
 */
function tokenEdges(value: string): { readonly start: number; readonly end: number } {
  let start = 0;
  let end = value.length;
  while (start < end && TOKEN_INNER_CHARACTERS.has(value[start] as string)) start += 1;
  while (end > start && TOKEN_INNER_CHARACTERS.has(value[end - 1] as string)) end -= 1;
  return { start, end };
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
 * Clause scoping later added two more passes over each sentence's tokens - one for
 * the conjunctions of every registered locale, one for the negator and conditional
 * POSITIONS rather than just their presence. The same command on the same sample
 * reports 3.986 ms p50 after it: a 3.6% move, inside this host's run-to-run spread
 * and still well under the 6.1 ms the full scan cost. A realistic 162-character
 * reply is 0.084 ms. The extra passes are cheap for the reason this index exists -
 * each is one `Map.get` per token that usually returns `undefined`.
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
