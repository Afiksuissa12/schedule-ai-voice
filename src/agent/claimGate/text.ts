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
  /**
   * The character that ENDED this sentence, or `''` at the end of the text.
   *
   * Carried so `bridgeSegments` can rebuild a readable audit excerpt and, more
   * importantly, so it can ask which terminator stands at the END of a frame that
   * crosses a cut. `Is your meeting\nbooked?` and `Your meeting is? booked for
   * Thursday at 2pm.` differ in nothing else: in the first the question mark
   * terminates the span, in the second it stands in the middle of it. § 19.
   */
  readonly terminator: string;
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
        terminator,
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
 * Invisible formatting characters that `normalizeScript` does NOT remove.
 *
 * U+00AD SOFT HYPHEN, U+180E MONGOLIAN VOWEL SEPARATOR, U+2060 WORD JOINER.
 * `normalizeScript` strips the bidi controls and the zero-width block, and these
 * three are the remainder of the invisible set. One of them inside a verb -
 * `boo­ked` - splits the token in two and the claim disappears, which is the
 * same fail-open shape as the cut this module's `bridgeSegments` is about: a
 * representational step erasing a claim.
 *
 * They are handled HERE, in the flattened view, rather than in `normalizeScript` -
 * which is shared with the scheduling resolver - precisely because a view may only
 * ADD suspicion. Fixing it in the shared normaliser would change what the RESOLVER
 * sees too, and that is a different guarantee with a different test.
 */
const INVISIBLE_FORMAT_CHARACTERS = /[­᠎⁠]/gu;

/** Markdown emphasis and code runs, which may sit INSIDE a word. */
const EMPHASIS_MARKERS = /[*~]+/gu;

/** What opens a markdown block at the start of a line: bullets, headings, quotes, numbering. */
const LINE_LEADING_MARKERS = /^[ \t]*(?:[-*+•·>#]+[ \t]*|\d{1,3}[.)][ \t]+)/gmu;

/**
 * THE SECOND VIEW: the same text with its LAYOUT collapsed.
 *
 * WHY A SECOND VIEW AND NOT A BETTER FIRST ONE
 * ---------------------------------------------------------------------------
 * `bridgeSegments` above closes a terminator standing inside a frame ACROSS ONE
 * CUT, which is the shape independent QA drove end to end. It cannot close a frame
 * spread over three segments - `Your meeting\nis\nbooked for Thursday.` - and it
 * cannot close a marker that sits inside a WORD rather than between two.
 *
 * Those are all the same class, and the class is not "line breaks". It is: **a
 * representational choice made for precision silently removes a claim.** Where
 * sentences are cut is one such choice; so is which characters may sit inside a
 * token, and so is whether a `1.` at the start of a line is a list number or a full
 * stop after a number. Closing them one at a time is the pattern
 * `docs/MISSION_2D_CLAIM_GATE.md` § 16.6 names and that has now cost six findings.
 *
 * So the rule is stated at the level of the axis: **THE GATE MAY LOOK AT THE TEXT
 * THROUGH SEVERAL VIEWS, AND A VIEW MAY ONLY EVER ADD SUSPICION, NEVER REMOVE IT.**
 * `detector.ts` runs detection over the text as segmented today AND over this view,
 * and unions the results. A union cannot make a currently-detected claim disappear,
 * so no precision control can regress except by an extra REGENERATION - which is
 * measured rather than assumed (§ 19.4).
 *
 * WHAT IS COLLAPSED, AND WHY EACH ONE
 * ---------------------------------------------------------------------------
 *  1. INVISIBLE FORMAT CHARACTERS the shared normaliser leaves behind. A soft
 *     hyphen inside `booked` is not a word boundary to any reader.
 *  2. LINE-LEADING MARKERS - bullets, headings, blockquotes, list numbering. The
 *     numbering matters most and is the least obvious: `1. Meeting booked` puts a
 *     FULL STOP after a digit, which `readSentences` correctly reads as the end of
 *     a sentence (`booked for 3.`) and which is a list marker here.
 *  3. EMPHASIS RUNS, which may sit inside a word: `**bo**oked` tokenises as two
 *     words and matches nothing.
 *  4. LINE BREAKS and runs of whitespace, to single spaces.
 *
 * WHAT IS DELIBERATELY NOT COLLAPSED
 * ---------------------------------------------------------------------------
 * `.`, `!`, `?`, `;` and `…` STAY. They are sentence punctuation rather than
 * layout, and flattening them would merge two genuinely separate sentences into
 * one - which is the direction `NEGATION_THEN_CLAIM_LINES` exists to forbid. They
 * are reached by `bridgeSegments` instead, one cut at a time, which is the narrow
 * tool for a narrow job. The two mechanisms are complementary on purpose.
 *
 * A BACKTICK BECOMES AN APOSTROPHE rather than disappearing, which is the one
 * substitution here that is not a deletion: independent QA found `I\`ve booked`
 * missed, and a backtick is the key next to the apostrophe on a US keyboard and the
 * character a markdown-trained model reaches for. `` `booked` `` is unaffected
 * either way, because a backtick at a token edge was never part of the token.
 *
 * Returns the input UNCHANGED when there is nothing to collapse, which is the
 * common case - an ordinary one-line reply - and lets the caller skip the second
 * view entirely.
 */
export function flattenLayout(text: string): string {
  const flattened = text
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(/`/gu, "'")
    .replace(LINE_LEADING_MARKERS, ' ')
    .replace(EMPHASIS_MARKERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return flattened === text ? text : flattened;
}

/** Two adjacent segments read as one, with the cut between them located. */
export interface BridgedSegments {
  /** The pair as a single sentence. Tokens of the first, then of the second. */
  readonly sentence: ClaimSentence;
  /**
   * Index of the first token that came from the SECOND segment.
   *
   * A match "crosses the cut" when it begins strictly before this and ends
   * strictly after it. That is the only thing the bridged pass is allowed to
   * report - see `detector.ts` § 19.
   */
  readonly boundary: number;
}

/**
 * Two adjacent segments, joined so that a completion frame can SEE across the cut.
 *
 * WHY THIS EXISTS - THE SIXTH FAIL-OPEN DEFECT, NOT A REFINEMENT
 * ---------------------------------------------------------------------------
 * `readSentences` cuts on every `SENTENCE_TERMINATORS` character, and it does that
 * BEFORE any completion form is looked for. Every English completion form is a
 * multi-token FRAME, so a terminator standing INSIDE one silenced the whole
 * detector - not by suppressing it, but by making the frame unmatchable at any
 * `FrameGapAllowance` bound. The gap rule tolerates intervening TOKENS, and a cut
 * is not a token; it is the segmentation the gap rule runs inside.
 *
 *     Your meeting is booked for Thursday at 2pm.        DETECTED
 *     Your meeting is\nbooked for Thursday at 2pm.       RELEASED   <- same claim
 *     The meeting has been\nbooked for Thursday at 2pm.  RELEASED
 *     Your meeting is; booked for Thursday at 2pm.       RELEASED
 *     I'll\ncall you tomorrow at 3pm.                    RELEASED
 *
 * Independent QA drove four of those through the real `AgentTurnService`, the real
 * `ToolDispatcher` and real SQLite: every one reached the caller with
 * `outcome=NO_MATERIAL_CLAIM`, was persisted as a spoken AGENT turn, and left
 * `meetings=0` and `futureActions=0`. The control - the same bytes with a SPACE
 * where the break is - was withheld and regenerated in the same run. Hebrew was
 * immune again, and for the § 16 reason: its completion verbs are single inflected
 * words with no inside for a cut to land in.
 *
 * The class is wider than a hard wrap, and that is the half that matters. A model
 * answering in the register `docs/MISSION_2D_AYA_ROOT_CAUSE.md` is about - labels,
 * bullets, headings, `Action:` lists - puts a line break between a domain object and
 * its participle as a matter of LAYOUT: `Your meeting:\nbooked for Thursday at 2pm.`,
 * `- Meeting\n- booked for Thursday at 2pm`, `## Confirmation\nThe meeting has
 * been\nbooked ...`. None of those is an evasion; all of them leaked.
 *
 * WHY NOT "STOP SPLITTING ON NEWLINES"
 * ---------------------------------------------------------------------------
 * Because splitting is load-bearing in the other direction, and the argument above
 * `SENTENCE_TERMINATORS` is correct: a model that answers in bullet points separates
 * an honest negation from a false completion by a line break and nothing else, so
 * merging the two lines would let the negator in one silence the claim in the next.
 * `tests/claimGate/claimGateCorpus.ts` pins that as a CRLF pair.
 *
 * So the cut STAYS, and a second pass re-reads each ADJACENT PAIR as one sentence.
 * Only matches that CROSS the cut are reported from it, which is what keeps the two
 * rules from contradicting each other: a claim standing wholly inside one segment is
 * the first pass's business and is judged exactly as it was before this existed.
 *
 * SUPPRESSION IS NOT WIDENED BY THIS, AND THAT WAS THE CONSTRAINT
 * ---------------------------------------------------------------------------
 * The second segment's clauses are renumbered to CONTINUE the first segment's last
 * clause rather than to open a new one, so inside a bridged pair a negator does
 * reach across the cut. That sounds like the thing §§ 15, 17 and 18 forbid and it is
 * the opposite of it, for one structural reason: the bridged pass may only EMIT a
 * match that crosses the cut, and such a match always BEGINS in the first segment.
 * So the only suppressor that can act on it is one standing at or before its first
 * token, in that token's own clause - which is ordinary same-clause suppression, and
 * it is what keeps `Nothing is\nbooked yet.` clean. A negator can never silence a
 * claim that lies wholly in the other segment, because no such claim is reported
 * here at all. Nothing that was detected before can stop being detected.
 *
 * Returns `null` when there is nothing to bridge, so the caller does no work on the
 * common case of a segment with no tokens.
 */
export function bridgeSegments(first: ClaimSentence, second: ClaimSentence): BridgedSegments | null {
  if (first.tokens.length === 0 || second.tokens.length === 0) return null;

  // A whitespace terminator is shown as a line break, a mark is shown followed by a
  // space, and the end of the text has neither. Only the audit excerpt reads this.
  const separator =
    first.terminator === '' ? ' ' : /\s/u.test(first.terminator) ? '\n' : `${first.terminator} `;
  const raw = `${first.raw}${separator}${second.raw}`;
  const shift = first.raw.length + separator.length;
  // CONTINUE the last clause rather than opening a new one - see the header.
  const clauseShift = first.clauseCount - 1;

  const tokens: ClaimToken[] = [...first.tokens];
  for (const token of second.tokens) {
    tokens.push({ text: token.text, offset: token.offset + shift, clause: token.clause + clauseShift });
  }

  return {
    sentence: {
      index: first.index,
      raw,
      tokens,
      // THE TERMINATOR THAT GOVERNS A SPAN IS THE ONE AT ITS END. `Is your
      // meeting\nbooked?` is a question and must stay clean; `Your meeting is?
      // booked for Thursday at 2pm.` puts the mark in the MIDDLE of the frame and
      // asserts a booking. Reading the second segment's terminator is what tells
      // those two apart, and reading the first segment's would have kept the second
      // one open.
      interrogative: second.interrogative,
      clauseCount: (tokens.at(-1)?.clause ?? -1) + 1,
      terminator: second.terminator,
    },
    boundary: first.tokens.length,
  };
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
 * Permission to match a form whose tokens are NOT adjacent in the text.
 *
 * WHY THIS EXISTS - A FAIL-OPEN DEFECT, NOT A REFINEMENT
 * ---------------------------------------------------------------------------
 * Every English completion form is a multi-token FRAME (`is booked`, `has been
 * booked`, `i have booked`) for the reason `lexicon/en.ts` argues at length: the
 * bare participle `booked` is honest in `let me get that booked`. Adjacent-only
 * matching therefore made ONE adverb inside the frame defeat the whole detector:
 *
 *     Your meeting is booked for tomorrow at 3pm.        DETECTED
 *     Your meeting is now booked for tomorrow at 3pm.    RELEASED   <- same claim
 *     I have booked the callback for 3pm tomorrow.       DETECTED
 *     I have now booked the callback for 3pm tomorrow.   RELEASED   <- same claim
 *
 * Independent QA drove seven wordings of that shape through the real
 * `AgentTurnService` against a real database: every one reached the caller with
 * `outcome=NO_MATERIAL_CLAIM`, was persisted as a spoken AGENT turn, and left
 * `meetings=0` and `futureActions=0` behind it. Measured on the pure detector, 8
 * adverbs crossed with 7 frames missed 53 of 56 sentences. Hebrew was immune
 * throughout, because its passive past is one inflected word - which localises the
 * defect to ENGLISH FRAMES rather than to any rule about scope.
 *
 * WHY A BLOCK LIST AND NOT A SKIP LIST
 * ---------------------------------------------------------------------------
 * The first attempt at this hand-listed the adverbial into the SUBJECT prefixes
 * (`i already`, `i've already`, `i have already`), which is why exactly those
 * three spellings were caught and every other adverb and every passive frame
 * stayed open. Enumerating what MAY be skipped repeats that mistake one level up:
 * an adverb nobody listed is a LEAK.
 *
 * So the enumeration is inverted. Any token may be skipped UNLESS it is named,
 * and what is named is the set of tokens whose presence changes what the frame
 * asserts - negators, conditionals, clause joiners and the locale's modal and
 * intention words (`ClaimLexicon.frameBlockers`). An incomplete block list
 * therefore costs PRECISION - one regeneration of a sentence that was true - and
 * can never cost a leak, which is the direction the brief's fail-safe rule
 * requires (`detector.ts`, "FAIL-SAFE DIRECTION").
 *
 * WHY THE RUN IS BOUNDED
 * ---------------------------------------------------------------------------
 * Unbounded, `i ... booked` would match `I can get that booked for you` - an
 * honest intention - across four tokens. The bound is what keeps a FRAME a frame
 * rather than a bag of words in one sentence; `detector.ts` names the number and
 * says which wordings set it.
 */
export interface FrameGapAllowance {
  /** Most tokens that may be skipped inside ONE form match, in total. */
  readonly maxSkippedTokens: number;
  /**
   * Tokens that may never be skipped INSIDE a frame, already split to single tokens.
   *
   * Locale DATA, assembled by the caller. This module holds no language-specific
   * literal and this field is why it still does not have to.
   */
  readonly blockedTokens: ReadonlySet<string>;
  /**
   * Tokens that may not stand IMMEDIATELY IN FRONT of an interrupted frame.
   *
   * A STRICT SUBSET of `blockedTokens`, and the two are separate because they do
   * different jobs. A DETERMINER may not appear inside a frame - `I will have your
   * call back booked shortly.` closed `i will call` across `have your`, which is an
   * honest intention read as a callback promise - but a determiner in FRONT of a
   * frame is ordinary English and must not silence anything: `That is now booked.`
   * asserts a booking and `that` is the subject.
   *
   * So the inside test is the wide set and the in-front test is this narrow one:
   * the words that change a clause's MOOD (modals, intention verbs, negators,
   * conditionals) rather than the words that merely cannot be interior to a verb
   * phrase.
   */
  readonly moodTokens: ReadonlySet<string>;
}

/**
 * How many tokens of `forms` match at `position`, longest form first.
 *
 * Returns the matched SPAN, the form that matched, and how many tokens inside the
 * span were skipped, or `null`. The longest-match rule is what keeps
 * `'אחרי הצהריים'` from being read as `'הצהריים'` in the scheduling lexicon and
 * what keeps `'has been booked'` from being read as `'booked'` here.
 *
 * `gap` is OPTIONAL and the adjacent pass runs FIRST and unchanged, so a caller
 * that passes nothing gets byte-identical behaviour and a caller that passes an
 * allowance can only ever match MORE text - never less, and never differently
 * where an adjacent match already existed. That ordering is deliberate: it is
 * what makes this change provably incapable of turning a detection into a miss.
 */
export function matchLongestForm(
  tokens: readonly ClaimToken[],
  position: number,
  forms: readonly string[],
  gap?: FrameGapAllowance,
): { readonly length: number; readonly form: string; readonly skipped: number } | null {
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
    if (matched) return { length: candidate.tokens.length, form: candidate.form, skipped: 0 };
  }

  if (gap === undefined || gap.maxSkippedTokens <= 0) return null;

  // AN INTERRUPTED FRAME MAY NOT ITSELF SIT INSIDE A MODAL FRAME, and this is not
  // decoration - it was found by running the precision half of this fix before
  // shipping it. `have booked` is a form of its own, so `I can have that booked for
  // you in a moment.` and `I will have that booked shortly.` closed it across
  // `that` - two honest intentions, and the second is almost word for word what
  // `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` asks the model to say. The modal is
  // OUTSIDE the matched form there, so the gap rule could not see it.
  //
  // A modal governs the verb phrase after it, so a blocker immediately in front of
  // an interrupted frame cancels it. Applied to the INTERRUPTED pass only: an
  // adjacent frame behaves exactly as it did before this change, which is what keeps
  // this fix incapable of turning any existing detection into a miss.
  //
  // SAME CLAUSE ONLY, because a modal does not reach across a comma: `If not, I have
  // now booked it for Thursday.` puts `not` immediately before the frame and in a
  // different clause, where it governs nothing about the booking. Without the clause
  // test that sentence would be a miss - and a miss here is the fail-open direction,
  // which is the one this whole rule exists to close.
  // `moodTokens` and not `blockedTokens`, and the difference is argued on the field:
  // a determiner may not be INSIDE a frame and is perfectly ordinary in front of one.
  const preceding = tokens[position - 1];
  if (
    preceding !== undefined &&
    preceding.clause === (tokens[position] as ClaimToken).clause &&
    gap.moodTokens.has(preceding.text)
  ) {
    return null;
  }

  // The interrupted pass, in the same order: the form with the MOST tokens of its
  // own wins, because that is the specificity the adjacent rule is about
  // (`callback is booked` must beat `is booked`, or a correctly booked callback is
  // reported as an unsupported meeting). A single-token form can never reach here -
  // it either matched above or its first token differed.
  for (const candidate of candidates) {
    const span = matchWithGaps(tokens, position, candidate.tokens, gap);
    if (span !== null) {
      return { length: span, form: candidate.form, skipped: span - candidate.tokens.length };
    }
  }

  return null;
}

/**
 * The span `formTokens` covers from `position` when interruptions are allowed.
 *
 * Returns `null` when the form cannot be completed inside the allowance. Matching
 * is GREEDY - the first token that satisfies the next form token is taken - which
 * is a bounded approximation rather than a search: with a budget of two skips and
 * forms of at most five tokens, the case where backtracking would find a match
 * that greed misses needs the same word twice inside one frame, and the cost of
 * missing it is one regeneration that did not happen on a wording no model in the
 * committed evidence produced. A search would be unbounded work on every token of
 * every turn for that.
 */
function matchWithGaps(
  tokens: readonly ClaimToken[],
  position: number,
  formTokens: readonly string[],
  gap: FrameGapAllowance,
): number | null {
  let cursor = position + 1;
  let remaining = gap.maxSkippedTokens;

  for (let index = 1; index < formTokens.length; index += 1) {
    const wanted = formTokens[index] as string;
    for (;;) {
      const token = tokens[cursor];
      if (token === undefined) return null;
      if (token.text === wanted) {
        cursor += 1;
        break;
      }
      if (remaining === 0) return null;
      if (gap.blockedTokens.has(token.text)) return null;
      remaining -= 1;
      cursor += 1;
    }
  }

  return cursor - position;
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

/**
 * A written contraction that fuses a COPULA or an AUXILIARY onto the word before it.
 *
 * WHY THIS EXISTS - THE EIGHTH FAIL-OPEN DEFECT, AND IT IS A TOKENISATION FACT
 * ---------------------------------------------------------------------------
 * `TOKEN_INNER_CHARACTERS` keeps an apostrophe INSIDE a token, deliberately, so that
 * `you're`, `i've` and `o'clock` survive as one word each. That decision has a
 * consequence nobody followed through: a copula fused to a NOUN subject is inside
 * the noun's token too.
 *
 *     Your meeting is booked for Thursday at 2pm.    your | meeting | is | booked | ...
 *     Your meeting's booked for Thursday at 2pm.     your | meeting's | booked | ...
 *
 * The second one was RELEASED to a caller and PERSISTED as a spoken agent turn while
 * the first was blocked in the same run. BOTH routes to the claim fail on the same
 * token: the FRAME route, because `is booked` needs an `is` token and the copula is
 * inside `meeting's`; and the bare-participle fallback (§ 16.3b), which exists
 * precisely to catch a participle whose frame was defeated, because
 * `domainObjectMatches` looks for the declared form `meeting` and the token says
 * `meeting's`. `appointment's`, `callback's` and every other noun behave identically.
 *
 * `lexicon/en.ts` had ALREADY reasoned about this tokenisation - `that's`, `it's` and
 * `you're` are listed there as whole forms with that argument written beside them -
 * but only for PRONOUN subjects. A noun subject is the commonest third-person
 * spelling a model writes, and the same argument was never applied to it.
 *
 * WHY THIS IS NOT A LIST OF NOUNS
 * ---------------------------------------------------------------------------
 * Adding `meeting's`, `appointment's` and `callback's` as three more strings is the
 * § 16.6 pattern for the eighth time: the coverage would be exactly as wide as the
 * nouns somebody typed, and the next noun leaks. The clitic is a property of the
 * WRITING SYSTEM, not of the vocabulary, so it is declared once per locale - the
 * suffix, and the copulas it may stand for - and the engine reads a token carrying it
 * BOTH as itself and as its stem plus that copula. No rule downstream is taught a
 * noun list; `domainObjectMatches`, the frame route and the participle fallback all
 * simply see the stem and the copula as separate tokens.
 *
 * WHY IT IS A SECOND READING AND NOT A REWRITE
 * ---------------------------------------------------------------------------
 * `'s` is genuinely ambiguous - `is`, `has`, the possessive, and `let's`. Choosing one
 * would be a guess this module cannot make. So the expansion is an extra VIEW, unioned
 * with the text as written, exactly as `flattenLayout` is: the original tokens are read
 * first and entire, and a reading may only ADD a claim. Three consequences follow, and
 * all three are the direction the fail-safe rule asks for:
 *
 *  - the forms `en.ts` declares as whole tokens on purpose - `it's`, `that's`,
 *    `you're`, `i've`, `o'clock` - still match in the view where they are whole, so
 *    none of them can be regressed by being read a second way, and none of them needs
 *    to be named in an exclusion list that would then be one more enumeration to keep
 *    complete;
 *  - a supported claim still passes BYTE-IDENTICAL, because the gate withholds or
 *    releases and never edits;
 *  - a possessive read as a copula can only over-detect, which costs at most one
 *    regeneration.
 */
export interface CopulaClitic {
  /** The written suffix, apostrophe included, lower-cased: `'s`. */
  readonly suffix: string;
  /**
   * The whole tokens this suffix may stand for, one reading each.
   *
   * ORDERED, and the order is part of the data: the readings this produces are
   * positional, so the same index means the same copula for every sentence in a
   * turn - which is what lets the bridged pass pair a reading of one segment with
   * the matching reading of the next.
   */
  readonly copulas: readonly string[];
}

const CLITIC_STEM_HAS_A_LETTER = /\p{L}/u;
const CLITIC_STEM_HAS_A_DIGIT = /\p{N}/u;

/**
 * The stem of `text` when it carries `suffix`, or `null`.
 *
 * A STEM IS A WORD: AT LEAST ONE LETTER, AND NO DIGIT. That is the identifier guard,
 * and it is stated as a property rather than as a copy of the identifier rules. Every
 * shape `detector.ts` recognises as an identifier - `CODE_LIKE`, `PREFIXED_CODE`, and
 * the three marker-adjacent shapes - requires a DIGIT, and `15:00`, `ב-15:00`, `2pm`
 * and `483921` all carry one too. So refusing a stem with a digit in it excludes every
 * one of them structurally, without this module holding the identifier table and
 * without the two having to be kept in step.
 *
 * It does NOT exclude a hyphenated word, and that is deliberate: `your follow-up's
 * arranged for 3pm` is the same claim as `your callback's arranged for 3pm`, and a
 * guard that required unbroken letters would have made the rule exactly as wide as
 * the nouns that happen to be spelled without a hyphen - which is the enumeration
 * this whole design is trying not to repeat. `CUID_LIKE` is the one identifier shape
 * with no digit in it, and it is a 21-character run starting with `c`; reading one as
 * a stem plus a copula can only ADD an identifier claim, which is the fail-safe
 * direction.
 */
function cliticStem(text: string, suffix: string): string | null {
  if (!text.endsWith(suffix)) return null;
  const stem = text.slice(0, text.length - suffix.length);
  if (stem.length === 0) return null;
  if (!CLITIC_STEM_HAS_A_LETTER.test(stem)) return null;
  return CLITIC_STEM_HAS_A_DIGIT.test(stem) ? null : stem;
}

/**
 * The sentence read again with every declared clitic expanded - one reading per copula.
 *
 * Returns `[]` when no token in the sentence carries a declared clitic, which is the
 * common case and the reason this costs nothing on ordinary text. When one DOES, the
 * full grid is returned - one reading per `(clitic, copula)` pair, in declaration
 * order, including the pairs that changed nothing - so that reading `k` of one
 * sentence and reading `k` of the next were produced by the same copula and can be
 * bridged against each other.
 *
 * `raw`, `index`, `interrogative` and `terminator` are carried over UNCHANGED: the
 * audit excerpt must stay the bytes the model wrote, and a reading is a way of reading
 * those bytes rather than a different text. The inserted copula takes the offset of
 * the apostrophe it stands for, and both halves keep the original token's CLAUSE, so
 * every clause-scoped rule behaves as it would have on the spelled-out sentence.
 */
export function expandCopulaClitics(
  sentence: ClaimSentence,
  clitics: readonly CopulaClitic[],
): readonly ClaimSentence[] {
  if (clitics.length === 0) return [];

  let carries = false;
  for (const clitic of clitics) {
    for (const token of sentence.tokens) {
      if (cliticStem(token.text, clitic.suffix) !== null) {
        carries = true;
        break;
      }
    }
    if (carries) break;
  }
  if (!carries) return [];

  const readings: ClaimSentence[] = [];
  for (const clitic of clitics) {
    for (const copula of clitic.copulas) {
      const tokens: ClaimToken[] = [];
      for (const token of sentence.tokens) {
        const stem = cliticStem(token.text, clitic.suffix);
        if (stem === null) {
          tokens.push(token);
          continue;
        }
        tokens.push({ text: stem, offset: token.offset, clause: token.clause });
        tokens.push({ text: copula, offset: token.offset + stem.length, clause: token.clause });
      }
      readings.push({ ...sentence, tokens });
    }
  }
  return readings;
}

/** True when any of `forms` matches anywhere in `tokens`. */
export function containsForm(tokens: readonly ClaimToken[], forms: readonly string[]): string | null {
  for (let position = 0; position < tokens.length; position += 1) {
    const hit = matchLongestForm(tokens, position, forms);
    if (hit) return hit.form;
  }
  return null;
}
