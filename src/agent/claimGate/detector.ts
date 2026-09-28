/**
 * THE DETECTOR: does this text assert that something material happened?
 *
 * PURE, AND DELIBERATELY SO
 * ---------------------------------------------------------------------------
 * Text in, claims out. No database, no clock, no provider, no ledger. That is
 * what makes it exhaustively testable as a table of strings, and it is why the
 * detection design chosen here is DETERMINISTIC rather than model-assisted.
 *
 * WHY DETERMINISTIC AND NOT MODEL-ASSISTED
 * ---------------------------------------------------------------------------
 * The whole finding being fixed is that an instruction to a model is a request
 * and not a constraint (`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 9.3
 * point 2, and § 8.8's language-drift evidence). Asking a second model call
 * "does this sentence claim a booking?" would put the guarantee back inside the
 * thing that cannot be relied on, and it would do it at the cost of one extra
 * provider round trip on EVERY turn rather than only on the failing ones. A
 * deterministic detector is free on the happy path, identical on every run, and
 * provable by a test that names the sentence.
 *
 * What it buys up front is the reason the module is shaped the way it is: the
 * detector is pure and cheap, so it runs FIRST, and the ledger - which costs
 * five database reads - is only built when the detector has actually found
 * something to check.
 *
 * THE FIVE RULES, IN ORDER
 * ---------------------------------------------------------------------------
 * Per CLAUSE, because that is the scope a negation really has - see the section
 * after this one for why the sentence was too wide and what it cost:
 *
 *  1. A completion form in the clause a QUESTION MARK terminates asserts
 *     nothing. `Shall I get that booked?` is a question; excluding it is a
 *     property of punctuation, not of a language.
 *  2. A completion form asserts nothing when a NEGATOR stands in the same clause
 *     AT OR BEFORE it AND DEMONSTRABLY GOVERNS IT. `Nothing is booked yet` must
 *     pass through as the truthful sentence it is; `אין בעיה הפגישה נקבעה` must
 *     not, and for three revisions of this module it did. "Governs" is defined by
 *     `suppressionReach` below and the data is `ClaimLexicon.suppressionCarriers`.
 *  3. The same for a CONDITIONAL marker. `Once that is booked I will let you
 *     know` is a plan.
 *  4. Otherwise every completion form that matches produces one claim, carrying
 *     the family, the mode, and any day and time the SENTENCE asserts. Day, time
 *     and identifier reading stay sentence-wide: `הפגישה נקבעה for Thursday, and
 *     the confirmation number is CONF998877.` has to keep reading Thursday onto
 *     the claim in the clause before the comma.
 *  5. AND, in any clause rule 4 found nothing in, a bare completion PARTICIPLE
 *     standing near a DOMAIN OBJECT produces one claim as well - `Right, meeting
 *     booked for Thursday.` A participle alone is ambiguous between a completion
 *     and an intention (`let me get that booked`), and what resolves it is whether
 *     the sentence names a thing this system can actually create.
 *     `matchParticiplesNearObjects` holds the rule and
 *     `lexicon/types.ts` (`CompletionParticipleEntry`) holds the argument for why
 *     this exists on top of rule 4 rather than instead of it.
 *
 * WHAT "A COMPLETION FORM MATCHES" MEANS, AND WHY IT IS NOT "ADJACENT TOKENS"
 * ---------------------------------------------------------------------------
 * Rule 4 says "every completion form that matches". For English that is a
 * multi-token FRAME - `is booked`, `has been booked`, `i have booked` - because the
 * bare participle is honest in `let me get that booked` (`lexicon/en.ts` argues it).
 * Matching those frames as ADJACENT token sequences made ONE word inside a frame
 * defeat the detector outright, and that was fail-OPEN in production:
 *
 *     Your meeting is booked for tomorrow at 3pm.       DETECTED
 *     Your meeting is now booked for tomorrow at 3pm.   RELEASED   <- same claim
 *     I have booked the callback for 3pm tomorrow.      DETECTED
 *     I have now booked the callback for 3pm tomorrow.  RELEASED   <- same claim
 *
 * Independent QA drove seven wordings of that shape through the real
 * `AgentTurnService` against a real database. Every one reached the caller with
 * `outcome=NO_MATERIAL_CLAIM`, was persisted as a spoken AGENT turn, and left
 * `meetings=0` and `futureActions=0`. The control - the same sentence with the
 * adverb deleted - was blocked correctly in the same run. On the pure detector the
 * class was 53 misses out of 56 adverb-by-frame combinations, over five families.
 * Hebrew was never affected, because its passive past is one inflected word and has
 * no inside; that asymmetry is what localises the defect to English FRAMES rather
 * than to any of the scope rules below.
 *
 * So a frame tolerates a bounded run of skipped tokens
 * (`MAX_TOKENS_SKIPPED_INSIDE_A_FRAME`, and `text.ts` holds the matcher). Two
 * properties keep that from becoming a precision disaster, and both are argued where
 * they live:
 *
 *  - WHAT MAY NOT BE SKIPPED is enumerated rather than what may. A missing entry
 *    therefore costs one regeneration of a true sentence and never a leak, which is
 *    the only form of enumeration the fail-safe rule below permits. The set is every
 *    registered locale's negators, conditionals and clause joiners, plus
 *    `ClaimLexicon.frameBlockers` - the modals and intention words.
 *  - THE ADJACENT PASS RUNS FIRST and the interrupted pass only where it found
 *    nothing, so wherever an adjacent form matched the result is byte-for-byte what
 *    it was. Verified rather than reasoned about: all 634 committed corpus, e2e and
 *    release-spec texts were run through both detectors, and NO claim was lost and
 *    no family, mode or locale changed. One `matchedForm` STRING moved - `I just
 *    booked it.` now quotes `i booked` rather than `i just booked` - and that is the
 *    lexicon deletion below rather than this rule; it appears in an audit detail and
 *    nowhere else. `docs/MISSION_2D_CLAIM_GATE.md` § 16.9 records it.
 *
 * WHY THE CLAUSE AND NOT THE SENTENCE, AND WHY "AT OR BEFORE"
 * ---------------------------------------------------------------------------
 * The first revision of this module scoped rules 1-3 to the SENTENCE, and a comma
 * is not a sentence terminator. That made the gate's verdict depend on which
 * punctuation mark a 7B model happened to type:
 *
 *     אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה.   DETECTED
 *     אין דאגה, הפגישה נקבעה בהצלחה.              RELEASED   <- same claim
 *     Your meeting is booked for Thursday at 2pm.             DETECTED
 *     Don't worry, your meeting is booked for Thursday at 2pm. RELEASED
 *
 * Independent QA drove eight wordings of that shape through the real
 * `AgentTurnService` against a real database. In every one the ledger held
 * nothing - `meetings=0`, `futureActions=0` - and in every one the gate reported
 * `NO_MATERIAL_CLAIM` and the false sentence was returned to the caller AND
 * persisted as a spoken agent turn. English, Hebrew and mixed were all reachable.
 * That is fail-OPEN, and it inverts the rule the brief sets for this detector:
 * uncertainty is treated as UNSUPPORTED. A negator governing a different clause
 * is exactly scope uncertainty, and the sentence rule resolved it to RELEASE.
 *
 * Two independent narrowings close it, and BOTH are needed:
 *
 *  - CLAUSE. A negator reaches only to the end of its own clause. `text.ts`
 *    bounds a clause with punctuation (comma, dash, colon, bracket) and
 *    `ClaimLexicon.clauseBreakers` adds the locale's own conjunctions (`but`,
 *    `so`, `אבל`), so `I cannot take payments, but I have booked your meeting`
 *    and the same sentence without the comma both land the negator and the
 *    completion in different clauses.
 *  - AT OR BEFORE. Negation is pre-verbal in both registered languages - `is not
 *    booked`, `לא נקבעה`, `nothing is booked`, `cannot give you` - so a negator
 *    standing AFTER a completion form is not negating it. That is what catches
 *    `I've booked the callback for 3pm without any issue.` and `קבעתי לך פגישה
 *    ליום חמישי בלי שום בעיה.`, which carry no clause boundary at all and were
 *    both released.
 *
 * Both narrowings are STRICT subsets of the old suppression: every claim the
 * sentence rule detected is still detected, and the only behaviour that can
 * change is a miss becoming a detection. `tests/claimGate/claimGateCorpus.ts`
 * asserts that in both directions, and `DOCUMENTED_MISSES` there recorded ten
 * spellings of this defect before it was fixed.
 *
 * WHY NEITHER OF THOSE WAS ENOUGH, AND WHY SUPPRESSION NOW NEEDS GOVERNANCE
 * ---------------------------------------------------------------------------
 * Clause scope and precedence are both about WHERE a negator stands. Neither asks
 * whether the negator has anything to do with the form it silences, so suppression
 * was still FAIL-OPEN BY DEFAULT: a negator anywhere at or before a completion form
 * in the same clause silenced it, which means any filler containing a negator word
 * released everything after it to the end of the clause. Hebrew's ordinary
 * reassurances are built on exactly the two words `negators` cannot omit:
 *
 *     אין בעיה, הפגישה נקבעה למחר בשעה 14:00.       DETECTED  <- the comma is doing it
 *     אין בעיה הפגישה נקבעה למחר בשעה 14:00.        RELEASED  <- same claim
 *     אין דאגה הפגישה נקבעה למחר בשעה 14:00.        RELEASED
 *     לא נורא הפגישה נקבעה למחר בשעה 14:00.         RELEASED
 *     אין צורך לדאוג הפגישה נקבעה למחר בשעה 14:00.  RELEASED
 *     אין בעיה הפגישה בוטלה.                        RELEASED  (CANCELLATION)
 *     אין בעיה אתקשר אליך מחר בשעה 15:00.           RELEASED  (CALLBACK)
 *     No problem your meeting is booked for Thursday at 2pm.  DETECTED
 *
 * Independent QA drove five of those through the real `AgentTurnService`, the real
 * `ToolDispatcher` and real SQLite: every one was returned to the caller AND
 * PERSISTED as a spoken AGENT turn, with `outcome=NO_MATERIAL_CLAIM`, `meetings=0`
 * and `futureActions=0`. The English analogue was caught, which localises the cause
 * to the Hebrew negator list rather than to any rule above: `lexicon/en.ts` could
 * afford to omit bare `no`, and Hebrew cannot omit `אין` or `לא`.
 *
 * So a negator now suppresses a form only when it GOVERNS it, and the test is
 * `suppressionReach`: every token strictly between the negator and the form must be
 * material this locale declares as able to stand between a negator and the predicate
 * it negates (`ClaimLexicon.suppressionCarriers`, plus the determiners, domain
 * objects, modals, negators and conditionals the engine pools automatically). A
 * reassurance's own complement - `בעיה`, `דאגה`, `צורך`, `נורא`, `worry`, `problem`,
 * `trouble` - is not such material and is not listed, so it ENDS the negator's reach
 * and the completion after it is detected.
 *
 * THE ENUMERATION IS INVERTED, WHICH IS THE WHOLE POINT. Three previous fixes
 * enumerated the reported strings and the next finding arrived one phrasing sideways
 * (`docs/MISSION_2D_CLAIM_GATE.md` § 16.6). Listing the reassurance collocations
 * would have been a fourth round of that, and a filler nobody listed would be a
 * LEAK. Listing what may be CROSSED inverts the failure: a function word missing
 * from `suppressionCarriers` costs one regeneration of a sentence that was true, and
 * can never cost a released false claim.
 *
 * WHAT IT COSTS, NAMED
 * ---------------------------------------------------------------------------
 * `I have booked nothing.` - a post-verbal negation that really does negate -
 * is now DETECTED, and if the ledger is empty the turn is regenerated. It is
 * listed in the corpus as a priced false positive rather than left to be
 * discovered: the fail-safe rule resolves an ambiguous scope towards detecting,
 * the cost is one provider round trip on a wording no model in the committed
 * evidence produced, and `Nothing has been booked.` - the phrasing a model
 * actually writes - is unaffected.
 *
 * IDENTIFIERS ARE NOT SUBJECT TO 2 OR 3
 * ---------------------------------------------------------------------------
 * An identifier read out to a contact has been read out whether the sentence
 * around it was hedged or not, and a contact who writes `CONF123456` down will
 * quote it back to somebody. So identifier-shaped tokens are collected from the
 * whole text regardless of negation, and only the identifier MARKER phrases
 * (`confirmation number`) are suppressed by a negator - because `I cannot give
 * you a confirmation number` is an honest sentence.
 *
 * A MARKER PHRASE WIDENS WHAT COUNTS AS AN IDENTIFIER, IN THAT SENTENCE ONLY
 * ---------------------------------------------------------------------------
 * `483921` cannot be in `IDENTIFIER_SHAPES`: a bare digit run is a price, a
 * duration and a house number. But `Your confirmation number is 483921.` has
 * ANNOUNCED that the next thing is a reference, so the number beside it is either
 * one the system issued or one the model made up - a checkable mismatch rather
 * than an ambiguity. `MARKER_ADJACENT_SHAPES` is consulted only for the claim a
 * marker phrase produced, which bounds the widening to sentences that say
 * `confirmation number` in so many words.
 *
 * FAIL-SAFE DIRECTION
 * ---------------------------------------------------------------------------
 * Where detection is uncertain it DETECTS, and the verifier then decides against
 * real state. Detecting a claim that turns out to be supported costs nothing at
 * all: the text is released byte-identical. Missing one costs a customer being
 * told something false. So the asymmetry is resolved towards detecting, and the
 * only places this module deliberately declines to fire are the ones where a
 * form is genuinely ambiguous between a claim and an intention - which are
 * enumerated, with reasons, in the lexicon modules.
 */
import { REGISTERED_LEXICONS, type LocaleLexicon } from '../../scheduling/lexicon/index.js';
import {
  REGISTERED_CLAIM_LEXICONS,
  type ClaimAssertionMode,
  type ClaimEffectFamily,
  type ClaimLexicon,
  type CompletionMarkerEntry,
} from './lexicon/index.js';
import {
  matchLongestForm,
  readSentences,
  type ClaimSentence,
  type ClaimToken,
  type FrameGapAllowance,
} from './text.js';

/** What kind of thing the text asserted. */
export type MaterialClaimKind = 'EFFECT_ASSERTED' | 'IDENTIFIER_ASSERTED';

/** A day the text names, in whatever way it named it. */
export interface AssertedDay {
  /** Weekday, Luxon numbering, when the text named one. */
  readonly isoWeekday: number | null;
  /** Days from the turn's `now`, when the text used a relative anchor. */
  readonly offsetDays: number | null;
  readonly dayOfMonth: number | null;
  readonly month: number | null;
  readonly year: number | null;
  /** The forms that produced this, for an audit detail. */
  readonly forms: readonly string[];
}

/** A time of day the text names. */
export interface AssertedTime {
  readonly hour: number | null;
  readonly minute: number | null;
  /**
   * True when the hour was written without am/pm and without a day part, so
   * 3 could mean 03:00 or 15:00. The verifier treats a 12-hour match as
   * agreement in that case, because the ambiguity is the CONTACT's phrasing and
   * not a contradiction.
   */
  readonly hourIsAmbiguous: boolean;
  /** `morning` / `afternoon` / `evening`, when the text named one. */
  readonly dayPart: string | null;
  readonly forms: readonly string[];
}

export interface DetectedClaim {
  readonly kind: MaterialClaimKind;
  readonly family: ClaimEffectFamily;
  readonly mode: ClaimAssertionMode;
  /** Which registered lexicon's form fired. */
  readonly locale: string;
  /** The form as written in the lexicon. Never a customer-facing sentence. */
  readonly matchedForm: string;
  /** 0-based sentence position, so two claims in one sentence are distinguishable. */
  readonly sentenceIndex: number;
  /**
   * The sentence, as the model wrote it.
   *
   * Recorded for the audit trail and for `AgentTurnResult.claimGate`, which the
   * benchmark task needs in order to separate a model's unsupported attempts
   * from claims that leaked. It is NOT put into the regeneration instruction -
   * see `stateInstruction.ts`.
   */
  readonly excerpt: string;
  readonly assertedDay: AssertedDay | null;
  readonly assertedTime: AssertedTime | null;
  /** Identifier-shaped tokens found in this sentence, verbatim. */
  readonly identifiers: readonly string[];
}

export interface DetectClaimsOptions {
  /** Defaults to `REGISTERED_CLAIM_LEXICONS`. Overridden only by tests. */
  readonly lexicons?: readonly ClaimLexicon[];
  /**
   * The DAY and TIME vocabulary. Defaults to the scheduling resolver's own
   * `REGISTERED_LEXICONS`, on purpose: the gate must not be able to disagree
   * with the resolver about what `מחר` or `afternoon` means.
   */
  readonly schedulingLexicons?: readonly LocaleLexicon[];
}

/**
 * Every material claim in `text`.
 *
 * Returns an empty array for text that asserts nothing, which is the common
 * case and the reason this function is cheap.
 */
export function detectMaterialClaims(text: string, options: DetectClaimsOptions = {}): readonly DetectedClaim[] {
  const claimLexicons = options.lexicons ?? REGISTERED_CLAIM_LEXICONS;
  const schedulingLexicons = options.schedulingLexicons ?? REGISTERED_LEXICONS;
  const sentences = readSentences(text);
  const out: DetectedClaim[] = [];

  // WHAT MAY STAND INSIDE A FRAME is read from EVERY registered locale at once,
  // for the reason `clauseIndices` reads the conjunctions that way: an English
  // `and` inside a Hebrew sentence still joins two clauses, and a Hebrew `לא`
  // inside an English frame still negates it.
  const gap = frameGapAllowance(claimLexicons);

  // HOW FAR A NEGATOR OR A CONDITIONAL REACHES, read from every registered locale
  // at once for the same reason: `אין בעיה your meeting is booked` puts a Hebrew
  // negator in front of an English frame, and `Don't worry הפגישה נקבעה` does the
  // reverse. Both are shapes the eval corpus actually contains.
  const reach = suppressionReach(claimLexicons);

  for (const sentence of sentences) {
    const identifiers = identifierShapedTokens(sentence);
    const day = detectDay(sentence.tokens, schedulingLexicons, claimLexicons);
    const time = detectTime(sentence.tokens, schedulingLexicons);

    // WHERE THE CLAUSES ARE is a property of the TEXT, so it is read ONCE from
    // every registered locale at the same time, outside the per-lexicon loop.
    // WHAT SUPPRESSES is a property of a language, so that stays inside it. A
    // corpus sample like `לא צריך לדאוג and קבעתי לך פגישה למחר` is why: the
    // Hebrew negator and the Hebrew completion are divided by an ENGLISH
    // conjunction, and a Hebrew-only view of the clauses cannot see it.
    const clauses = clauseIndices(sentence, claimLexicons);

    for (const lexicon of claimLexicons) {
      const suppression = readSuppression(sentence, clauses, lexicon, reach);

      // The dedup by family:mode happens AFTER suppression, not before it, so
      // that a suppressed first match cannot swallow an asserted second one:
      // `הפגישה לא נקבעה, אבל הפגישה נקבעה למחר.` asserts the second.
      const seen = new Set<string>();
      const clausesWithAFrame = new Set<number>();
      for (const match of matchCompletionMarkers(sentence, lexicon, gap)) {
        if (suppression.suppresses(match.position)) continue;
        const key = `${match.claim.family}:${match.claim.mode}`;
        clausesWithAFrame.add(clauses[match.position] ?? -1);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...match.claim, assertedDay: day, assertedTime: time, identifiers });
      }

      // THE FALLBACK: a bare participle beside a domain object, in a clause no frame
      // could read. `lexicon/types.ts` (`CompletionParticipleEntry`) carries the
      // argument and `matchParticiplesNearObjects` carries the rules. It runs AFTER
      // the frames and is skipped in any clause a frame already spoke for, so it can
      // neither double-count a claim nor change a verdict a frame produced.
      for (const match of matchParticiplesNearObjects(sentence, clauses, lexicon, claimLexicons, gap, reach)) {
        if (clausesWithAFrame.has(clauses[match.position] ?? -1)) continue;
        if (suppression.suppresses(match.position)) continue;
        const key = `${match.claim.family}:${match.claim.mode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...match.claim, assertedDay: day, assertedTime: time, identifiers });
      }

      // An identifier MARKER is an assertion that the system has an identifier
      // to give. Suppressed by negation, like a completion form, and by the same
      // clause rule - so `I cannot take payments, but your confirmation number
      // is 483921.` is a claim and `I cannot give you a confirmation number` is
      // not. The FIRST unsuppressed marker in the sentence is the one recorded.
      const marker = formMatches(sentence.tokens, lexicon.identifierMarkers).find(
        (hit) => !suppression.suppresses(hit.position),
      );
      if (marker !== undefined) {
        out.push({
          kind: 'IDENTIFIER_ASSERTED',
          family: 'ANY',
          mode: 'COMPLETED',
          locale: lexicon.locale,
          matchedForm: marker.form,
          sentenceIndex: sentence.index,
          excerpt: sentence.raw,
          assertedDay: day,
          assertedTime: time,
          // The marker's OWN claim carries the looser shapes as well - see
          // `markerAdjacentIdentifiers`. Only this claim does; the effect
          // claims above and the bare-shape claim below keep the strict list.
          identifiers: markerAdjacentIdentifiers(sentence, identifiers, day, time),
        });
      }
    }

    // An identifier-shaped token stands on its own, in any language, hedged or
    // not. Recorded once per sentence rather than once per registered lexicon.
    if (identifiers.length > 0) {
      out.push({
        kind: 'IDENTIFIER_ASSERTED',
        family: 'ANY',
        mode: 'COMPLETED',
        locale: 'any',
        matchedForm: IDENTIFIER_SHAPE_FORM,
        sentenceIndex: sentence.index,
        excerpt: sentence.raw,
        assertedDay: day,
        assertedTime: time,
        identifiers,
      });
    }
  }

  return out;
}

/** The `matchedForm` recorded when a bare identifier shape fired. */
export const IDENTIFIER_SHAPE_FORM = '(identifier-shaped token)';

// ---------------------------------------------------------------------------
// Completion forms
// ---------------------------------------------------------------------------

/** One completion form that matched, and the token position it matched at. */
interface CompletionMatch {
  readonly position: number;
  readonly claim: Omit<DetectedClaim, 'assertedDay' | 'assertedTime' | 'identifiers'>;
}

/**
 * How many tokens may be skipped inside ONE completion frame.
 *
 * WHY TWO, NAMED RATHER THAN TUNED
 * ---------------------------------------------------------------------------
 * TWO is what the wordings a model actually writes need. One covers the whole
 * reported class - `is NOW booked`, `has NOW been booked`, `I have NOW booked`,
 * `is SUCCESSFULLY booked`. The second is for the frames that carry an adverb at
 * each of their two seams: `has NOW been SUCCESSFULLY booked`, `I have NOW
 * SUCCESSFULLY booked`.
 *
 * THREE was rejected, and not on taste. At three, `i booked` reaches `I will get
 * that booked for you.` and `I can get that booked for you.` through the modal -
 * honest intentions, and the exact wording the prompt clause
 * `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` asks the model to use. Those two are
 * also held off by `ClaimLexicon.frameBlockers` (`will`, `can`, `get`), so the two
 * defences are independent and the bound is the one that does not depend on a word
 * list being complete. A frame is a frame; at some width it is just two words in a
 * sentence.
 */
const MAX_TOKENS_SKIPPED_INSIDE_A_FRAME = 2;

/**
 * The frame allowance for one set of lexicons - computed once per array.
 *
 * Keyed by array IDENTITY, exactly as `FORM_INDEX` in `text.ts` is and for the same
 * reason: `REGISTERED_CLAIM_LEXICONS` is a frozen module constant, and a test that
 * passes an ad-hoc array gets its entry collected with it.
 */
const FRAME_GAP_ALLOWANCES = new WeakMap<readonly ClaimLexicon[], FrameGapAllowance>();

function frameGapAllowance(lexicons: readonly ClaimLexicon[]): FrameGapAllowance {
  const cached = FRAME_GAP_ALLOWANCES.get(lexicons);
  if (cached !== undefined) return cached;

  // A negator, a conditional or a clause joiner inside a frame is blocked HERE
  // rather than left to the suppression rules, and that is load-bearing rather
  // than tidy. Suppression only applies a blocker that stands AT OR BEFORE the
  // form's first token, so `I have NOT booked anything` - where `not` sits INSIDE
  // the frame, after `i` - would be detected as a claim by a rule that let the
  // frame swallow it. `tests/claimGate/claimGateCorpus.ts` asserts that sentence
  // stays clean in MUST_NOT_FLAG.
  //
  // TWO SETS, because "may not be inside a frame" and "may not stand in front of
  // one" are different questions - `FrameGapAllowance.moodTokens` argues it, and
  // `I will have your call back booked shortly.` is the sentence that forced it.
  const blockedTokens = new Set<string>();
  const moodTokens = new Set<string>();
  const add = (into: Set<string>, forms: readonly string[]): void => {
    for (const form of forms) {
      for (const token of form.split(' ')) {
        if (token.length > 0) into.add(token);
      }
    }
  };
  /**
   * The same, for fields whose entries may be MULTI-token - and only the
   * single-token ones are taken.
   *
   * WHY, AND IT WAS A LEAK. `conditionalMarkers` contains `would you like`,
   * `do you want`, `shall i` and `as soon as`. Splitting those to single tokens
   * put `you`, `i`, `do`, `like`, `as` and `soon` into `moodTokens`, where each
   * one suppresses on its own - so `If that works for you meeting booked for
   * Thursday at 2pm.` was silenced by `you`, a word that is not a conditional
   * marker in any reading. Found by `SUPPRESSION_MATRIX` rather than reasoned
   * about, and it is the same mistake in miniature as the one § 17 fixes: a
   * suppressor that governs nothing silencing a claim.
   *
   * A multi-token suppressor is not lost - `readSuppression` matches whole forms
   * through `formMatches`, which is where a phrase belongs. What is dropped is
   * only the per-TOKEN test, which a phrase cannot meaningfully take part in.
   */
  const addSingleTokenFormsOnly = (into: Set<string>, forms: readonly string[]): void => {
    for (const form of forms) {
      if (form.includes(' ')) continue;
      if (form.length > 0) into.add(form);
    }
  };
  for (const lexicon of lexicons) {
    // MOOD: what makes a clause non-assertive. Used in front of a frame, and by the
    // bare-participle rule for the whole clause.
    addSingleTokenFormsOnly(moodTokens, lexicon.negators);
    addSingleTokenFormsOnly(moodTokens, lexicon.conditionalMarkers);
    addSingleTokenFormsOnly(moodTokens, lexicon.frameBlockers);
    // INSIDE: the mood words, plus the two classes that are only ever wrong INTERIOR
    // to a verb phrase - a clause joiner, and a determiner.
    add(blockedTokens, lexicon.clauseBreakers);
    add(blockedTokens, lexicon.frameDeterminers);
  }
  for (const token of moodTokens) blockedTokens.add(token);

  const allowance: FrameGapAllowance = {
    maxSkippedTokens: MAX_TOKENS_SKIPPED_INSIDE_A_FRAME,
    blockedTokens,
    moodTokens,
  };
  FRAME_GAP_ALLOWANCES.set(lexicons, allowance);
  return allowance;
}

function matchCompletionMarkers(
  sentence: ClaimSentence,
  lexicon: ClaimLexicon,
  gap: FrameGapAllowance,
): readonly CompletionMatch[] {
  const out: CompletionMatch[] = [];

  for (let position = 0; position < sentence.tokens.length; position += 1) {
    // ADJACENT FIRST, INTERRUPTED ONLY IF NOTHING ADJACENT MATCHED. Two passes
    // rather than one combined comparison, so that every text this detector
    // already fired on fires identically - same family, same mode, same
    // `matchedForm` - and the only behaviour this change can produce is a miss
    // becoming a detection. A merge gate whose existing verdicts move is a merge
    // gate that has to be re-argued from scratch.
    const best = bestCompletionAt(sentence.tokens, position, lexicon)
      ?? bestCompletionAt(sentence.tokens, position, lexicon, gap);
    if (best === null) continue;

    out.push({
      position,
      claim: {
        kind: 'EFFECT_ASSERTED',
        family: best.entry.family,
        mode: best.entry.mode,
        locale: lexicon.locale,
        matchedForm: best.form,
        sentenceIndex: sentence.index,
        excerpt: sentence.raw,
      },
    });
    position += best.span - 1;
  }

  return out;
}

interface BestCompletion {
  readonly entry: CompletionMarkerEntry;
  /** Tokens the match COVERS, including any it skipped. Drives the cursor. */
  readonly span: number;
  /** Tokens the FORM itself has. Drives which form wins. */
  readonly formTokens: number;
  readonly form: string;
}

/**
 * The best completion form at one token position, across every family.
 *
 * THE LONGEST FORM AT THIS POSITION WINS, ACROSS FAMILIES, AND CONSUMES ITS
 * TOKENS. Without that, `the callback is booked` fires twice: once as CALLBACK
 * (`callback is booked`, three tokens from position 1) and once as MEETING
 * (`is booked`, two tokens from position 2) - so a correctly booked callback would
 * be reported as an unsupported MEETING claim and a truthful sentence would be
 * regenerated. Same rule, same reason, as the scheduling resolver's
 * longest-match-at-a-position.
 *
 * "Longest" is counted in the FORM's own tokens rather than in the span it covers,
 * because once a frame may be interrupted the two differ and only the first one is
 * specificity: `callback is booked` has to keep beating `is booked` whether or not
 * an adverb sits inside either of them.
 */
function bestCompletionAt(
  tokens: readonly ClaimToken[],
  position: number,
  lexicon: ClaimLexicon,
  gap?: FrameGapAllowance,
): BestCompletion | null {
  let best: BestCompletion | null = null;
  for (const entry of lexicon.completionMarkers) {
    const hit = matchLongestForm(tokens, position, entry.forms, gap);
    if (hit === null) continue;
    const formTokens = hit.length - hit.skipped;
    if (
      best === null ||
      formTokens > best.formTokens ||
      (formTokens === best.formTokens && hit.length > best.span)
    ) {
      best = { entry, span: hit.length, formTokens, form: hit.form };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The fallback: a bare participle beside a domain object
// ---------------------------------------------------------------------------

/**
 * How far a domain object may stand from the participle it disambiguates.
 *
 * WHY EIGHT, NAMED RATHER THAN TUNED
 * ---------------------------------------------------------------------------
 * The two sentences this rule exists for set it. `I have finally and officially booked
 * your meeting for Thursday.` puts the object two tokens after the participle, and
 * `Your meeting has, at long last, finally been booked.` puts it SEVEN before. Eight
 * covers both with one token to spare and still keeps the pair inside a single clause
 * or its immediate neighbour.
 *
 * It is not the precision defence, which is why it can be this generous: what keeps
 * `let me get that booked` clean is that the sentence names no domain object at all,
 * and what keeps `Let me get your meeting booked for Thursday.` clean is that `let`
 * and `get` are `frameBlockers` standing in front of the participle in its own clause.
 * The distance bound is only here so that a participle in one half of a long sentence
 * cannot be paired with an object in the other half that has nothing to do with it.
 */
const MAX_TOKENS_FROM_PARTICIPLE_TO_OBJECT = 8;

/**
 * Every bare participle in the sentence that stands near a domain object.
 *
 * THE FOUR CONDITIONS, AND EVERY ONE OF THEM IS A PRECISION DEFENCE
 * ---------------------------------------------------------------------------
 *  1. A DOMAIN OBJECT within `MAX_TOKENS_FROM_PARTICIPLE_TO_OBJECT`. This is the
 *     condition that makes a bare participle readable at all: `let me get that booked`
 *     names nothing this system creates, and `I have booked your MEETING` does.
 *     Objects are pooled across every registered locale, so a Hebrew object can
 *     disambiguate an English participle in a code-switched sentence.
 *  2. NO `frameBlocker` AT OR BEFORE IT IN ITS OWN CLAUSE. This is what keeps the
 *     intention readings clean - `Let me get your meeting booked`, `I can have your
 *     meeting booked`, `your callback is being arranged`, `I need to get your meeting
 *     booked`. Clause-scoped and at-or-before for the reason § 15 gives for negation:
 *     a modal governs the verb phrase after it and stops at a comma.
 *     Applied ONLY to this rule. A FRAME is explicit enough to survive a modal
 *     elsewhere in its clause (`I can confirm your meeting is booked` must still
 *     fire), and a bare participle is not.
 *  3. The caller then applies rules 1-3 - interrogative, negator, conditional -
 *     unchanged, so `Shall I get your meeting booked?` and `nothing is booked` need
 *     nothing special here.
 *  4. The caller skips any clause a FRAME already spoke for, so this cannot
 *     double-count or relabel.
 *
 * THE OBJECT ALSO REFINES THE FAMILY, which is the one thing this rule does BETTER
 * than the frames. § 8 limit 9 exists because `matchCompletionMarkers` reads a form
 * from the position it starts at and cannot see the object that decides the family, so
 * `I booked the callback` is read as MEETING and a real callback does not satisfy it.
 * Here the object is in hand by construction, so a generic MEETING participle beside
 * `callback` is reported as CALLBACK. It does not close limit 9 - that limit is about
 * the FRAMES, which still win wherever they match, and `KNOWN_FALSE_POSITIVES` asserts
 * it is still a false positive.
 */
function matchParticiplesNearObjects(
  sentence: ClaimSentence,
  clauses: readonly number[],
  lexicon: ClaimLexicon,
  allLexicons: readonly ClaimLexicon[],
  gap: FrameGapAllowance,
  reach: SuppressionReach,
): readonly CompletionMatch[] {
  if (lexicon.completionParticiples.length === 0) return [];

  const objects = domainObjectMatches(sentence.tokens, allLexicons);
  if (objects.length === 0) return [];

  const out: CompletionMatch[] = [];
  for (let position = 0; position < sentence.tokens.length; position += 1) {
    const clause = clauses[position];
    if (clause === undefined) continue;
    if (blockerStandsBefore(sentence.tokens, clauses, position, gap, reach)) continue;

    for (const entry of lexicon.completionParticiples) {
      const hit = matchLongestForm(sentence.tokens, position, entry.forms);
      if (hit === null) continue;

      // The TOKENS BETWEEN the two spans, in whichever order they appear, must be at
      // most the bound. Written as two comparisons rather than an absolute difference
      // so that a multi-token object (`call back`, `follow-up`) is measured from its
      // near edge and not from its start.
      const nearby = objects.find(
        (object) =>
          object.position + object.length + MAX_TOKENS_FROM_PARTICIPLE_TO_OBJECT >= position &&
          position + hit.length + MAX_TOKENS_FROM_PARTICIPLE_TO_OBJECT >= object.position,
      );
      if (nearby === undefined) continue;

      out.push({
        position,
        claim: {
          kind: 'EFFECT_ASSERTED',
          // A generic MEETING participle defers to the object; anything more specific
          // keeps its own family, because `cancelled` is a CANCELLATION whatever it
          // cancelled and the object cannot say otherwise.
          family: entry.family === 'MEETING' && nearby.family !== 'ANY' ? nearby.family : entry.family,
          mode: entry.mode,
          locale: lexicon.locale,
          // The audit quotes BOTH halves, because neither on its own is the finding.
          matchedForm: `${hit.form} + ${nearby.form}`,
          sentenceIndex: sentence.index,
          excerpt: sentence.raw,
        },
      });
      break;
    }
  }

  return out;
}

/** One domain object that matched, with where it matched and what family it names. */
interface DomainObjectMatch extends FormMatch {
  readonly family: ClaimEffectFamily;
}

/** Every domain object in the sentence, from every registered locale. */
function domainObjectMatches(
  tokens: readonly ClaimToken[],
  lexicons: readonly ClaimLexicon[],
): readonly DomainObjectMatch[] {
  const out: DomainObjectMatch[] = [];
  for (const lexicon of lexicons) {
    for (const entry of lexicon.domainObjects) {
      for (const hit of formMatches(tokens, entry.forms)) {
        out.push({ ...hit, family: entry.family });
      }
    }
  }
  return out;
}

/**
 * True when a MOOD token stands at or before `position` in the same clause AND
 * reaches it.
 *
 * `FrameGapAllowance.moodTokens` and deliberately NOT `blockedTokens`, for two
 * reasons that were both found by running the precision and coverage halves of this
 * rule rather than by reading it:
 *
 *  - A CLAUSE JOINER must not suppress. `I have finally AND officially booked your
 *    meeting.` puts `and` at the head of the clause the participle sits in, because
 *    `clauseIndices` gives a joiner to the clause it OPENS. Testing it as a blocker
 *    silenced the sentence this whole fallback exists to catch.
 *  - A DETERMINER must not suppress either, for the same reason it must not appear
 *    inside a frame but may stand in front of one: `I have THE meeting booked for
 *    Thursday.` is a claim.
 *
 * What is left is what actually changes a clause's mood: modals, intention verbs,
 * negators and conditionals.
 *
 * AND IT HAS TO PASS THE SAME GOVERNANCE TEST THE SUPPRESSION RULES DO. Without it
 * this function is the same fail-open shape one rule over: `אין` is a mood token
 * pooled from every locale, so `אין בעיה meeting booked for Thursday at 2pm.` -
 * a Hebrew filler in front of an English bare participle, which is exactly the
 * code-switching the eval corpus contains - would be silenced by a negator that
 * governs the word `בעיה` and nothing else. `reachesForward` is the same test and
 * the same data, applied here, so there is one definition of "governs" in this
 * module rather than two that can drift apart.
 */
function blockerStandsBefore(
  tokens: readonly ClaimToken[],
  clauses: readonly number[],
  position: number,
  gap: FrameGapAllowance,
  reach: SuppressionReach,
): boolean {
  const clause = clauses[position];
  for (let index = 0; index < position; index += 1) {
    if (clauses[index] !== clause) continue;
    if (!gap.moodTokens.has((tokens[index] as ClaimToken).text)) continue;
    // A mood token is one token wide, so its span ends where it starts.
    if (reachesForward(tokens, index + 1, position, reach)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Suppression: rules 1, 2 and 3, scoped to the clause
// ---------------------------------------------------------------------------

/** One form of `forms` that matched, with where it matched. */
interface FormMatch {
  readonly position: number;
  readonly length: number;
  readonly form: string;
}

/** Every position in `tokens` at which one of `forms` matches, left to right. */
function formMatches(tokens: readonly ClaimToken[], forms: readonly string[]): readonly FormMatch[] {
  if (forms.length === 0) return [];
  const out: FormMatch[] = [];
  for (let position = 0; position < tokens.length; position += 1) {
    const hit = matchLongestForm(tokens, position, forms);
    if (hit) out.push({ position, length: hit.length, form: hit.form });
  }
  return out;
}

/** Whether a completion form starting at a token position asserts anything. */
interface Suppression {
  /** True when rule 1, 2 or 3 silences a form that starts at `position`. */
  suppresses(position: number): boolean;
}

/**
 * How far a negator or a conditional reaches forward, as pooled locale DATA.
 *
 * `carriers` is the union of every registered locale's `suppressionCarriers` plus
 * the four fields the engine adds without being asked - `frameDeterminers`,
 * `domainObjects`, `negators` and `conditionalMarkers` - and `frameBlockers`.
 * `lexicon/types.ts` argues each addition on the field itself; in one line: a
 * determiner, a domain-object head, a second negator and a modal are all material
 * that legitimately stands between a negator and the predicate it negates, and all
 * four are already declared, so re-declaring them per locale would be duplication
 * that can drift.
 */
interface SuppressionReach {
  readonly carriers: ReadonlySet<string>;
  readonly maxCarriers: number;
}

/**
 * The most carrier tokens a negator or conditional may reach across.
 *
 * WHY FOUR, NAMED RATHER THAN TUNED, AND WHY A BOUND AT ALL
 * ---------------------------------------------------------------------------
 * The carrier list is the rule; this bound is the belt on top of it. Its only
 * effect is to make suppression STRICTER, so it can never turn a detection into a
 * miss - it can only cost one regeneration of a sentence that was true. That is
 * what makes it safe to state a number here at all, and it is the difference
 * between this bound and `MAX_TOKENS_SKIPPED_INSIDE_A_FRAME`, which is load-bearing
 * in both directions.
 *
 * FOUR is the longest carrier run any honest sentence in the measured corpus needs.
 * `Would you like me to get that booked for Thursday?` crosses `me to get that`
 * from the conditional `would you like` to the participle - four - and
 * `I cannot give you a confirmation number for that.` crosses `give you a` to the
 * identifier marker. Five was not needed by anything measured; three would have
 * cost the interrogative wording above, which is the exact register the guardrail
 * clause asks a model to use. The number is therefore set by the honest corpus and
 * not by the adversarial one, which is the right way round for a precision knob.
 *
 * It also stops the one pathological case the carrier list alone allows: a long run
 * of pooled domain objects and determiners (`אין בעיה` is safe because `בעיה` is not
 * a carrier, but a filler built entirely out of carriers would otherwise reach any
 * distance).
 */
const MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS = 4;

/**
 * The reach for one set of lexicons - computed once per array.
 *
 * Keyed by array IDENTITY in a `WeakMap`, exactly as `FRAME_GAP_ALLOWANCES` and
 * `FORM_INDEX` are and for the same reason: `REGISTERED_CLAIM_LEXICONS` is a frozen
 * module constant, and a test that passes an ad-hoc array gets its entry collected
 * with it.
 */
const SUPPRESSION_REACHES = new WeakMap<readonly ClaimLexicon[], SuppressionReach>();

function suppressionReach(lexicons: readonly ClaimLexicon[]): SuppressionReach {
  const cached = SUPPRESSION_REACHES.get(lexicons);
  if (cached !== undefined) return cached;

  const carriers = new Set<string>();
  const add = (forms: readonly string[]): void => {
    for (const form of forms) {
      for (const token of form.split(' ')) {
        if (token.length > 0) carriers.add(token);
      }
    }
  };
  for (const lexicon of lexicons) {
    add(lexicon.suppressionCarriers);
    // The four the engine supplies so a locale does not have to repeat itself.
    add(lexicon.frameDeterminers);
    add(lexicon.frameBlockers);
    add(lexicon.negators);
    add(lexicon.conditionalMarkers);
    for (const entry of lexicon.domainObjects) add(entry.forms);
  }

  const reach: SuppressionReach = { carriers, maxCarriers: MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS };
  SUPPRESSION_REACHES.set(lexicons, reach);
  return reach;
}

/**
 * True when a suppressor whose span ends at `from` reaches the form starting at
 * `to` - i.e. when everything strictly between them is carrier material.
 *
 * THE UNCERTAIN ANSWER IS `false`, WHICH MEANS DETECTED. That is the fail-safe
 * direction stated at the top of this file, applied to the one question this
 * function answers: a token nobody declared could be a reassurance's nominal
 * complement (`בעיה`), could be the verb of a separate predication (`worry`), or
 * could be an adverb nobody thought of. Two of those three mean the negator
 * governs nothing here, so the rule declines to suppress and the verifier decides
 * against real state. Over-detection costs one regeneration; under-detection
 * released five false bookings to real callers and persisted them.
 */
function reachesForward(
  tokens: readonly ClaimToken[],
  from: number,
  to: number,
  reach: SuppressionReach,
): boolean {
  // Adjacent, or overlapping the form itself - `הפגישה לא נקבעה`, `nothing is
  // booked yet`, and a negator the frame rule already refused to swallow. Nothing
  // stands between, so there is nothing to govern across.
  if (from >= to) return true;
  if (to - from > reach.maxCarriers) return false;
  for (let index = from; index < to; index += 1) {
    if (!reach.carriers.has((tokens[index] as ClaimToken).text)) return false;
  }
  return true;
}

/**
 * Read one sentence's suppression map for one locale.
 *
 * Computed once per sentence per lexicon rather than once per candidate form,
 * because the negator positions are the same for every form in the sentence and
 * finding them costs a pass over the tokens.
 *
 * THREE CONDITIONS, AND THE THIRD IS THE § 17 FIX. A blocker suppresses a form only
 * when it stands in the SAME CLAUSE (§ 15), AT OR BEFORE it (§ 15), and REACHES it
 * (§ 17). The first two are about where the negator stands; only the third asks
 * whether it has anything to do with the form, and without it every filler built on
 * a negator word silenced the rest of its clause.
 */
function readSuppression(
  sentence: ClaimSentence,
  clauses: readonly number[],
  lexicon: ClaimLexicon,
  reach: SuppressionReach,
): Suppression {
  const blockers = [
    ...formMatches(sentence.tokens, lexicon.negators),
    ...formMatches(sentence.tokens, lexicon.conditionalMarkers),
  ];
  // The clause a trailing `?` terminates is the LAST one, because `?` is a
  // sentence terminator and can therefore only stand at the end.
  const interrogativeClause = sentence.interrogative ? (clauses.at(-1) ?? null) : null;

  return {
    suppresses(position: number): boolean {
      const clause = clauses[position];
      if (clause === undefined) return false;
      // Rule 1 keeps its clause scope and needs no governance test: a question mark
      // is punctuation and it makes the WHOLE clause interrogative, so there is no
      // sense in which it governs some of the clause and not the rest.
      if (clause === interrogativeClause) return true;
      return blockers.some(
        (blocker) =>
          blocker.position <= position &&
          clauses[blocker.position] === clause &&
          reachesForward(sentence.tokens, blocker.position + blocker.length, position, reach),
      );
    },
  };
}

/**
 * The clause each token belongs to: punctuation clauses plus every registered
 * locale's conjunctions.
 *
 * `text.ts` has already marked the boundaries punctuation makes, which is every
 * boundary that is not a language. A `clauseBreakers` form starts a new clause at
 * its own first token - `..., but I have booked ...` - except at position 0,
 * where there is no earlier clause for it to be separating from.
 *
 * Every registered locale contributes, because a clause boundary is a fact about
 * the text rather than about the language a claim happens to be written in, and
 * this system's real traffic mixes the two in one sentence.
 */
function clauseIndices(sentence: ClaimSentence, lexicons: readonly ClaimLexicon[]): readonly number[] {
  const tokens = sentence.tokens;
  const breaks = new Set<number>();
  for (let position = 1; position < tokens.length; position += 1) {
    if ((tokens[position] as ClaimToken).clause !== (tokens[position - 1] as ClaimToken).clause) {
      breaks.add(position);
    }
  }
  for (const lexicon of lexicons) {
    for (const hit of formMatches(tokens, lexicon.clauseBreakers)) {
      if (hit.position > 0) breaks.add(hit.position);
    }
  }

  const out: number[] = [];
  let clause = 0;
  for (let position = 0; position < tokens.length; position += 1) {
    if (breaks.has(position)) clause += 1;
    out.push(clause);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identifier shapes
// ---------------------------------------------------------------------------

/**
 * The identifier shapes this gate recognises, each named.
 *
 * ENUMERATED RATHER THAN HEURISTIC, and that is a deliberate trade. A rule as
 * loose as "any token mixing letters and digits" fires on a product name
 * (`Fieldpoint360`) and a version (`v2`), and a check that flags the company's
 * own product line gets switched off. So the shapes are listed, and a novel
 * invented identifier in some other shape is a stated limit rather than a
 * pretended guarantee.
 *
 *  - `CODE_LIKE` is the shape the recommended model actually produced under
 *    adversarial pressure: `CONF123456` (§ 6.5.4). Letters then at least four
 *    digits.
 *  - `PREFIXED_CODE` is the same idea with a separator: `REF-4821`.
 *  - `CUID_LIKE` is this repository's own primary-key shape, so a database id
 *    recited into a phone call is recognised as an id even when it is a REAL
 *    one the ledger happens not to contain.
 */
const IDENTIFIER_SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'CUID_LIKE', pattern: /^c[a-z0-9]{20,}$/u },
  { name: 'CODE_LIKE', pattern: /^[a-z]{2,10}\d{4,}$/u },
  { name: 'PREFIXED_CODE', pattern: /^[a-z]{1,10}[-_]\d{2,}$/u },
];

/**
 * Shapes that count as an identifier ONLY next to an identifier MARKER.
 *
 * WHY THESE ARE SEPARATE FROM `IDENTIFIER_SHAPES`
 * ---------------------------------------------------------------------------
 * A bare digit run cannot be in the table above: it is a price, a duration, a
 * house number and a year, and a rule that fired on it everywhere would flag
 * `that is 45 minutes` as an invented reference. § 4.4's trade stands.
 *
 * But `Your confirmation number is 483921.` is not uncertain. The sentence has
 * ANNOUNCED that the next thing is a reference, and a number-shaped token beside
 * that announcement either is an identifier the system issued or is one the model
 * made up - a checkable mismatch, not an ambiguity. Independent QA found this
 * released as affirmatively SUPPORTED: `483921` matched no shape, so
 * `claim.identifiers` was empty, so `INVENTED_IDENTIFIER` had nothing to test and
 * `hasIssuedOperationalIdentifier` then satisfied the marker with an unrelated
 * `FutureAction` id from a genuine booking. Reporting a fabricated reference as
 * verified is worse than missing it.
 *
 * So these shapes are collected only when a marker phrase fired in the same
 * sentence, which bounds the false-positive surface to sentences that say
 * `confirmation number` / `booking reference` / `מספר אישור` in so many words.
 *
 *  - `DIGIT_RUN` - three or more digits. `483921`.
 *  - `GROUPED_DIGITS` - the same behind a separator. `48-3921`.
 *  - `LETTER_LED_CODE` - a letter-first mix with at least two digits, which is
 *    the gap below `CODE_LIKE`'s four. `AB12`. Letter-FIRST on purpose: `3pm` and
 *    `2pm` are times, and a time in a sentence about a reference is still a time.
 */
const MARKER_ADJACENT_SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'DIGIT_RUN', pattern: /^\d{3,}$/u },
  { name: 'GROUPED_DIGITS', pattern: /^\d{2,}[-_/]\d{2,}$/u },
  { name: 'LETTER_LED_CODE', pattern: /^[a-z][a-z0-9]*\d[a-z0-9]*\d[a-z0-9]*$/u },
];

/** Identifier-shaped tokens in one sentence, in the order they appear. */
function identifierShapedTokens(sentence: ClaimSentence): readonly string[] {
  const out: string[] = [];
  for (const token of sentence.tokens) {
    if (IDENTIFIER_SHAPES.some((shape) => shape.pattern.test(token.text))) out.push(token.text);
  }
  return out;
}

/**
 * The strict identifiers of a sentence, plus the looser marker-only shapes.
 *
 * A token the DAY or the TIME reading already consumed is excluded, and that is
 * load-bearing rather than tidy: `2026` is a year and `1500` is a clock reading,
 * and both would otherwise be reported as invented references in a sentence that
 * happens to mention a booking reference. The exclusion is taken from the day and
 * time the detector itself just read, so the gate and the scheduling vocabulary
 * cannot disagree about which tokens were dates.
 */
function markerAdjacentIdentifiers(
  sentence: ClaimSentence,
  strict: readonly string[],
  day: AssertedDay | null,
  time: AssertedTime | null,
): readonly string[] {
  const alreadyRead = new Set<string>([...(day?.forms ?? []), ...(time?.forms ?? [])]);
  const out = [...strict];
  for (const token of sentence.tokens) {
    if (alreadyRead.has(token.text) || out.includes(token.text)) continue;
    if (MARKER_ADJACENT_SHAPES.some((shape) => shape.pattern.test(token.text))) out.push(token.text);
  }
  return out;
}

/**
 * Exported so a test can assert the marker-only table is the thing that fired.
 *
 * Returns `null` for a token no marker-only shape matches, exactly as
 * `identifierShapeOf` does for the strict table.
 */
export function markerAdjacentShapeOf(token: string): string | null {
  const normalized = token.toLowerCase();
  return MARKER_ADJACENT_SHAPES.find((shape) => shape.pattern.test(normalized))?.name ?? null;
}

/** Exported so a test can assert the shape table is the thing that fired. */
export function identifierShapeOf(token: string): string | null {
  const normalized = token.toLowerCase();
  return IDENTIFIER_SHAPES.find((shape) => shape.pattern.test(normalized))?.name ?? null;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

function detectDay(
  tokens: readonly ClaimToken[],
  schedulingLexicons: readonly LocaleLexicon[],
  claimLexicons: readonly ClaimLexicon[],
): AssertedDay | null {
  let isoWeekday: number | null = null;
  let offsetDays: number | null = null;
  let dayOfMonth: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  const forms: string[] = [];

  for (let position = 0; position < tokens.length; position += 1) {
    for (const lexicon of schedulingLexicons) {
      for (const entry of lexicon.weekdays) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (hit && isoWeekday === null) {
          isoWeekday = entry.isoWeekday;
          forms.push(hit.form);
        }
      }
      for (const entry of lexicon.dayAnchors) {
        if (entry.kind !== 'RELATIVE_DAY' || entry.offsetDays === undefined) continue;
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (hit && offsetDays === null) {
          offsetDays = entry.offsetDays;
          forms.push(hit.form);
        }
      }
    }

    for (const lexicon of claimLexicons) {
      for (const entry of lexicon.months) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (hit && month === null) {
          month = entry.month;
          forms.push(hit.form);
        }
      }
    }

    const token = tokens[position];
    if (token === undefined) continue;

    // An ISO date the model echoed back out of a tool result.
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(token.text);
    if (iso && dayOfMonth === null) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      dayOfMonth = Number(iso[3]);
      forms.push(token.text);
      continue;
    }

    // A written ordinal - `5th`, `21st`.
    for (const lexicon of claimLexicons) {
      for (const suffix of lexicon.ordinalSuffixes) {
        const ordinal = new RegExp(`^(\\d{1,2})${suffix}$`, 'u').exec(token.text);
        if (ordinal && dayOfMonth === null) {
          dayOfMonth = Number(ordinal[1]);
          forms.push(token.text);
        }
      }
    }

    // A four-digit year, which only ever means a year in this context.
    if (year === null && /^\d{4}$/u.test(token.text)) {
      const value = Number(token.text);
      if (value >= 2000 && value <= 2999) {
        year = value;
        forms.push(token.text);
      }
    }
  }

  // A bare number next to a month name is a day of the month: `5 March`,
  // `March 5`, `5 במרץ`. Checked after the pass above so the month is known.
  if (month !== null && dayOfMonth === null) {
    const nearby = bareDayOfMonthNearMonth(tokens, claimLexicons);
    if (nearby !== null) {
      dayOfMonth = nearby;
      forms.push(String(nearby));
    }
  }

  if (isoWeekday === null && offsetDays === null && dayOfMonth === null && month === null && year === null) {
    return null;
  }
  return { isoWeekday, offsetDays, dayOfMonth, month, year, forms };
}

/**
 * A 1..31 number sitting within two tokens of a month name.
 *
 * Two tokens, because a language may put a preposition between them - Hebrew
 * writes `5 במרץ` and English writes both `5 March` and `March the 5th`.
 */
function bareDayOfMonthNearMonth(
  tokens: readonly ClaimToken[],
  claimLexicons: readonly ClaimLexicon[],
): number | null {
  for (let position = 0; position < tokens.length; position += 1) {
    for (const lexicon of claimLexicons) {
      for (const entry of lexicon.months) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (!hit) continue;
        for (const offset of [-1, -2, hit.length, hit.length + 1]) {
          const candidate = tokens[position + offset];
          if (candidate === undefined) continue;
          if (!/^\d{1,2}$/u.test(candidate.text)) continue;
          const value = Number(candidate.text);
          if (value >= 1 && value <= 31) return value;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

function detectTime(
  tokens: readonly ClaimToken[],
  schedulingLexicons: readonly LocaleLexicon[],
): AssertedTime | null {
  let hour: number | null = null;
  let minute: number | null = null;
  let meridiem: 'am' | 'pm' | null = null;
  let dayPart: string | null = null;
  let hourWasBare = false;
  const forms: string[] = [];

  // ---- pass A: day parts, which CONSUME their tokens ---------------------
  // Order and consumption are both load-bearing, and for the reason the
  // scheduling lexicon spells out: Hebrew `אחרי הצהריים` (afternoon, two
  // tokens) contains `הצהריים` (noon, one token). A pass that read named times
  // at every position would report noon inside a phrase that says afternoon,
  // and then judge a correct 14:00 booking to be at the wrong time.
  const consumed = new Set<number>();
  for (let position = 0; position < tokens.length; position += 1) {
    if (consumed.has(position)) continue;
    for (const lexicon of schedulingLexicons) {
      for (const entry of lexicon.dayParts) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (!hit) continue;
        for (let offset = 0; offset < hit.length; offset += 1) consumed.add(position + offset);
        if (dayPart === null) {
          dayPart = entry.dayPart;
          forms.push(hit.form);
        }
      }
    }
  }

  // ---- pass B: everything else, skipping what a day part already took ----
  for (let position = 0; position < tokens.length; position += 1) {
    if (consumed.has(position)) continue;

    for (const lexicon of schedulingLexicons) {
      for (const entry of lexicon.namedTimes) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (hit && hour === null) {
          hour = entry.hour;
          minute = entry.minute;
          forms.push(hit.form);
        }
      }
      for (const entry of lexicon.meridiems) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (hit && meridiem === null) {
          meridiem = entry.meridiem;
          forms.push(hit.form);
        }
      }
    }

    const token = tokens[position];
    if (token === undefined) continue;

    // `15:00`, and the same thing behind an attaching clock prefix - `ב-15:00`.
    const clock = readClockToken(token.text, schedulingLexicons);
    if (clock !== null && hour === null) {
      hour = clock.hour;
      minute = clock.minute;
      if (clock.meridiem !== null) meridiem = clock.meridiem;
      hourWasBare = clock.bare;
      forms.push(token.text);
      continue;
    }
  }

  // A bare hour introduced by a clock prefix - `at 3`, `בשעה 14`.
  if (hour === null) {
    const bare = readBareHourAfterPrefix(tokens, schedulingLexicons);
    if (bare !== null) {
      hour = bare.hour;
      minute = 0;
      hourWasBare = true;
      forms.push(String(bare.hour));
    }
  }

  if (hour === null && dayPart === null) return null;

  const resolvedHour = hour === null ? null : applyMeridiem(hour, meridiem);
  return {
    hour: resolvedHour,
    minute: hour === null ? null : (minute ?? 0),
    // Ambiguous whenever the hour was written bare on a 12-hour reading and no
    // am/pm pinned it. A day part MAY pin it - `3 in the afternoon` is 15:00 -
    // but that resolution needs the day-part WINDOWS, which are policy and live
    // on the ledger. So the detector reports the ambiguity as a fact and
    // `verifier.ts` resolves it against the same windows the scheduler used.
    hourIsAmbiguous: hour !== null && hourWasBare && meridiem === null && hour >= 1 && hour <= 12,
    dayPart,
    forms,
  };
}

function applyMeridiem(hour: number, meridiem: 'am' | 'pm' | null): number {
  if (meridiem === 'pm') return hour === 12 ? 12 : hour + 12;
  if (meridiem === 'am') return hour === 12 ? 0 : hour;
  return hour;
}

interface ClockReading {
  readonly hour: number;
  readonly minute: number;
  readonly meridiem: 'am' | 'pm' | null;
  /** True when the token carried only an hour, so am/pm may still be missing. */
  readonly bare: boolean;
}

/**
 * Read one token as a clock time, stripping any ATTACHING clock prefix first.
 *
 * The prefix list is locale data (`src/scheduling/lexicon/he.ts` declares `ב`
 * with `''` and `'-'` as separators, which is what covers `ב15:00`, `ב-15:00`
 * and the maqaf spelling `normalizeScript` turns into a hyphen). Reading it from
 * the same data the resolver reads is the point: a time the resolver understood
 * is a time this gate can compare.
 */
function readClockToken(token: string, schedulingLexicons: readonly LocaleLexicon[]): ClockReading | null {
  const candidates = new Set<string>([token]);

  for (const lexicon of schedulingLexicons) {
    for (const entry of lexicon.clockPrefixes) {
      if (!entry.attaches) continue;
      for (const form of entry.forms) {
        for (const separator of entry.attachedSeparators ?? ['']) {
          const prefix = `${form}${separator}`;
          if (prefix.length > 0 && token.startsWith(prefix) && token.length > prefix.length) {
            candidates.add(token.slice(prefix.length));
          }
        }
      }
    }
  }

  for (const candidate of candidates) {
    const withMinutes = /^(\d{1,2}):(\d{2})$/u.exec(candidate);
    if (withMinutes) {
      const hour = Number(withMinutes[1]);
      const minute = Number(withMinutes[2]);
      if (hour <= 23 && minute <= 59) return { hour, minute, meridiem: null, bare: false };
    }

    // `3pm`, `3:30pm`, `3am` - one token in English.
    const withMeridiem = /^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m|p\.m)$/u.exec(candidate);
    if (withMeridiem) {
      const hour = Number(withMeridiem[1]);
      const minute = withMeridiem[2] === undefined ? 0 : Number(withMeridiem[2]);
      const meridiem = (withMeridiem[3] as string).startsWith('p') ? 'pm' : 'am';
      if (hour <= 23 && minute <= 59) return { hour, minute, meridiem, bare: false };
    }
  }

  return null;
}

/** A bare 0..23 hour immediately after a standalone clock prefix. */
function readBareHourAfterPrefix(
  tokens: readonly ClaimToken[],
  schedulingLexicons: readonly LocaleLexicon[],
): { readonly hour: number } | null {
  for (let position = 0; position < tokens.length; position += 1) {
    for (const lexicon of schedulingLexicons) {
      for (const entry of lexicon.clockPrefixes) {
        const hit = matchLongestForm(tokens, position, entry.forms);
        if (!hit) continue;
        const next = tokens[position + hit.length];
        if (next === undefined) continue;
        if (!/^\d{1,2}$/u.test(next.text)) continue;
        const hour = Number(next.text);
        if (hour <= 23) return { hour };
      }
    }
  }
  return null;
}
