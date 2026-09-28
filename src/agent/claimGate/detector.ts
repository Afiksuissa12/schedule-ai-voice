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
  type SuppressionCarrierRole,
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
        if (suppression.suppresses(suppressedForm(match))) continue;
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
        if (suppression.suppresses(suppressedForm(match))) continue;
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
        (hit) =>
          !suppression.suppresses({ position: hit.position, formTokens: hit.length, kind: 'NOUN_PHRASE' }),
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
  /**
   * Tokens the FORM's own text spans, not counting any the frame skipped.
   *
   * Carried so § 18's governance test can ask whether the form brings its own
   * SUBJECT (`i have booked`) or is a bare predicate (`booked`, `נקבעה`). The
   * skipped tokens are deliberately not counted: `I have now booked` brings the
   * same subject as `I have booked`.
   */
  readonly formTokens: number;
  /** A finite predicate, or the bare participle the fallback rule reads. */
  readonly formKind: 'FINITE' | 'PARTICIPLE';
  readonly claim: Omit<DetectedClaim, 'assertedDay' | 'assertedTime' | 'identifiers'>;
}

/** The `SuppressedForm` a completion match asks the suppression rules about. */
function suppressedForm(match: CompletionMatch): SuppressedForm {
  return { position: match.position, formTokens: match.formTokens, kind: match.formKind };
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
      formTokens: best.formTokens,
      formKind: 'FINITE',
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

    for (const entry of lexicon.completionParticiples) {
      const hit = matchLongestForm(sentence.tokens, position, entry.forms);
      if (hit === null) continue;
      // Tested HERE rather than before the loop because § 18's governance rule
      // needs the form's width, and that is only known once a participle matched.
      if (blockerStandsBefore(sentence.tokens, clauses, position, hit.length, gap, reach)) break;

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
        formTokens: hit.length,
        formKind: 'PARTICIPLE',
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
 * governs the word `בעיה` and nothing else. `governs` is the same test and the same
 * data, applied here, so there is one definition of "governs" in this module rather
 * than two that can drift apart.
 *
 * WHICH KIND OF MOOD TOKEN IT IS DECIDES WHICH RULE APPLIES, and that is the § 18
 * half. `moodTokens` pools three different things - negators, conditionals and
 * `frameBlockers` - and only the first two are scope-taking operators looking for
 * a predicate. A modal or an intention verb turns its whole clause into a plan and
 * takes the noun phrase after it as its own OBJECT, so it keeps the § 17 carrier
 * test unchanged: `Let me get your meeting booked for Thursday.` and `We haven't
 * been able to get your meeting booked yet.` are both clean only because `get`
 * swallows `your meeting`. A negator does not get that, which is what catches
 * `Not at all meeting booked for Thursday at 2pm.`
 */
function blockerStandsBefore(
  tokens: readonly ClaimToken[],
  clauses: readonly number[],
  position: number,
  span: number,
  gap: FrameGapAllowance,
  reach: SuppressionReach,
): boolean {
  const clause = clauses[position];
  const form: SuppressedForm = { position, formTokens: span, kind: 'PARTICIPLE' };
  for (let index = 0; index < position; index += 1) {
    if (clauses[index] !== clause) continue;
    const text = (tokens[index] as ClaimToken).text;
    if (!gap.moodTokens.has(text)) continue;
    // A mood token is one token wide, so its span ends where it starts. Negator
    // and conditional are tested for FIRST, so a token that is both a blocker and
    // a negator gets the stricter of the two rules.
    const kind: SuppressorKind = reach.negatorTokens.has(text)
      ? 'NEGATOR'
      : reach.conditionalTokens.has(text)
        ? 'CONDITIONAL'
        : 'MOOD';
    const suppressor: Suppressor = {
      kind,
      from: index + 1,
      opensItsClause: index === 0 || clauses[index - 1] !== clause,
      canBeASubject: reach.subjectNegatorTokens.has(text),
    };
    if (governs(tokens, suppressor, form, reach)) return true;
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
  /**
   * True when rule 1, 2 or 3 silences `form`.
   *
   * Takes the whole form rather than just its position, because § 18's governance
   * test needs to know how wide the form is and whether it is a finite predicate,
   * a bare participle or a noun phrase.
   */
  suppresses(form: SuppressedForm): boolean;
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
  /**
   * What each token DOES between a suppressor and the form, pooled from every
   * registered locale. `SUBJECT` for anything unlisted, which is the fail-safe
   * answer - see `lexicon/types.ts` (`SuppressionCarrierRole`).
   */
  readonly roles: ReadonlyMap<string, TokenRole>;
  /** Single-token negators, pooled. Which suppressor fired decides the rule. */
  readonly negatorTokens: ReadonlySet<string>;
  /** Single-token conditionals, pooled. */
  readonly conditionalTokens: ReadonlySet<string>;
  /** The negators that can themselves be a SUBJECT. `ClaimLexicon.subjectNegators`. */
  readonly subjectNegatorTokens: ReadonlySet<string>;
}

/**
 * A carrier role, plus the one the engine assigns rather than a locale.
 *
 * `DETERMINER` is not declarable because it is not a judgement call: it is
 * exactly `ClaimLexicon.frameDeterminers`, which every locale already declares
 * for the frame rule. A determiner OPENS a noun phrase without being its head,
 * which is the one behaviour none of the four declarable roles describes.
 */
type TokenRole = SuppressionCarrierRole | 'DETERMINER';

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
 * IT DOES NOT STOP THE ALL-CARRIER FILLER, AND THIS COMMENT USED TO SAY IT DID.
 * The sentence here read: "it also stops the one pathological case the carrier list
 * alone allows - a filler built entirely out of carriers would otherwise reach any
 * distance". That was false, and independent QA quoted it back while reporting the
 * fifth fail-open defect in this gate. A bound in TOKENS only stops a LONG filler,
 * and the leaking ones are two to four tokens long: `Not at all` crosses two
 * carriers to reach `i have booked`, `לא צריך כלום` crosses three to reach
 * `הפגישה נקבעה`. Both sit comfortably inside four and both released a false
 * booking to a real caller. What actually stops them is `governs` below - a
 * question about what the crossed tokens ARE rather than how many there are - and
 * `docs/MISSION_2D_CLAIM_GATE.md` § 18.7 records the correction.
 *
 * The bound is kept because it is still the belt: it is the only defence that does
 * not depend on a word list being complete, and it costs nothing to keep.
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
  const roles = new Map<string, TokenRole>();
  const negatorTokens = new Set<string>();
  const conditionalTokens = new Set<string>();
  const subjectNegatorTokens = new Set<string>();

  const add = (forms: readonly string[]): void => {
    for (const form of forms) {
      for (const token of form.split(' ')) {
        if (token.length > 0) carriers.add(token);
      }
    }
  };
  // FIRST WRITER WINS, and the order below is the precedence. A locale's OWN
  // `suppressionCarriers` role is the considered answer and goes first; the roles
  // the engine derives from the other fields only fill the gaps. `את` is the
  // sentence that needs it: Hebrew declares it as a pronoun AND as a
  // `frameDeterminer`, and the pronoun reading is the one its own file argued.
  const claim = (forms: readonly string[], role: TokenRole, firstTokenOnly = false): void => {
    for (const form of forms) {
      const tokens = form.split(' ').filter((token) => token.length > 0);
      if (tokens.length === 0) continue;
      // A MULTI-TOKEN form gets a role only for the token the caller names. A
      // conditional like `would you like` must never put `you` or `i` into
      // `MODIFIER` - that is the § 17 `addSingleTokenFormsOnly` lesson one field
      // over, and here it would silence a real subject.
      for (const token of firstTokenOnly ? [tokens[0] as string] : tokens) {
        if (!roles.has(token)) roles.set(token, role);
      }
    }
  };
  const singleTokenForms = (forms: readonly string[]): readonly string[] =>
    forms.filter((form) => !form.includes(' '));

  for (const lexicon of lexicons) {
    for (const entry of lexicon.suppressionCarriers) {
      add(entry.forms);
      claim(entry.forms, entry.role ?? 'SUBJECT');
    }
  }
  for (const lexicon of lexicons) {
    // The four the engine supplies so a locale does not have to repeat itself,
    // each with the role its own field already implies.
    add(lexicon.frameDeterminers);
    add(lexicon.frameBlockers);
    add(lexicon.negators);
    add(lexicon.conditionalMarkers);
    // A modal or an intention verb IS a predicate, so it satisfies the one a
    // negator is looking for - which is what keeps `I don't have your meeting
    // booked.` and `Let me get your meeting booked for Thursday.` clean.
    claim(singleTokenForms(lexicon.frameBlockers), 'VERB');
    claim(singleTokenForms(lexicon.frameDeterminers), 'DETERMINER');
    claim(singleTokenForms(lexicon.conditionalMarkers), 'MODIFIER');
    for (const negator of singleTokenForms(lexicon.negators)) {
      negatorTokens.add(negator);
      if (lexicon.subjectNegators.includes(negator)) subjectNegatorTokens.add(negator);
      claim([negator], lexicon.subjectNegators.includes(negator) ? 'SUBJECT' : 'MODIFIER');
    }
    for (const conditional of singleTokenForms(lexicon.conditionalMarkers)) conditionalTokens.add(conditional);
    // The HEAD of a domain object is its first token - `call back`, `follow-up` -
    // and the head is what can be a subject. `back` is already a preposition in
    // `en.ts` and keeps that role, which is first-writer-wins doing its job.
    for (const entry of lexicon.domainObjects) {
      add(entry.forms);
      claim(entry.forms, 'SUBJECT', true);
    }
  }

  const reach: SuppressionReach = {
    carriers,
    maxCarriers: MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS,
    roles,
    negatorTokens,
    conditionalTokens,
    subjectNegatorTokens,
  };
  SUPPRESSION_REACHES.set(lexicons, reach);
  return reach;
}

/** What a token does between a suppressor and the form. `SUBJECT` when unlisted. */
function roleAt(tokens: readonly ClaimToken[], index: number, reach: SuppressionReach): TokenRole {
  const token = tokens[index];
  if (token === undefined) return 'SUBJECT';
  return reach.roles.get(token.text) ?? 'SUBJECT';
}

/** True for the two roles that can begin a noun phrase. */
function opensANounPhrase(role: TokenRole): boolean {
  return role === 'SUBJECT' || role === 'DETERMINER';
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

// ---------------------------------------------------------------------------
// § 18: the carrier test is not enough, because a filler can be ALL carriers
// ---------------------------------------------------------------------------

/**
 * Which kind of suppressor is asking, because the answer differs by kind.
 *
 * `MOOD` is a `frameBlocker` - a modal or an intention verb - reaching a bare
 * participle through `blockerStandsBefore`. It differs from the other two in one
 * way and it is the way that matters: a modal IS a predicate, so it starts the
 * scan with its predicate already found and the noun phrase after it is its own
 * OBJECT. `Let me get your meeting booked for Thursday.` and `We haven't been able
 * to get your meeting booked yet.` are the two sentences that make that
 * load-bearing. A negator and a conditional start the scan still LOOKING for a
 * predicate, which is why a noun phrase in front of them is a new clause.
 */
type SuppressorKind = 'NEGATOR' | 'CONDITIONAL' | 'MOOD';

/** A suppressor, with everything the § 18 rule needs to know about it. */
interface Suppressor {
  readonly kind: SuppressorKind;
  /** The token after the suppressor's own span - where its reach starts. */
  readonly from: number;
  /**
   * True when the suppressor is the FIRST token of its own clause, so there is
   * nothing before it that could be its subject.
   */
  readonly opensItsClause: boolean;
  /** True when the suppressor can itself be the SUBJECT of the predicate it seeks. */
  readonly canBeASubject: boolean;
}

/** The thing a suppressor may or may not govern. */
interface SuppressedForm {
  readonly position: number;
  /** Tokens the form's OWN text spans, not counting any it skipped. */
  readonly formTokens: number;
  readonly kind: 'FINITE' | 'PARTICIPLE' | 'NOUN_PHRASE';
}

/**
 * Does this suppressor GOVERN this form?
 *
 * WHY THE § 17 CARRIER TEST WAS NOT THE WHOLE ANSWER - THE FIFTH FAIL-OPEN DEFECT
 * ---------------------------------------------------------------------------
 * § 17 asked one question: is everything between the negator and the form material
 * this locale declares as able to stand between a negator and the predicate it
 * negates. A filler built ENTIRELY out of that material therefore passed, and the
 * canonical one is the most ordinary English reply to "thank you":
 *
 *     Not at all I have booked your meeting for Thursday at 2pm.   RELEASED, persisted
 *     Not at all, I have booked your meeting for Thursday at 2pm.  the CONTROL - blocked
 *     לא צריך כלום הפגישה נקבעה למחר בשעה 14:00.                    RELEASED, persisted
 *
 * `not` is a declared negator; `at` and `all` are declared `suppressionCarriers`;
 * `i` is a declared `suppressionCarrier`. `לא` is a declared negator, `צריך` a
 * declared `frameBlocker`, `כלום` a declared carrier and `הפגישה` a declared
 * `domainObject`. Independent QA drove six English and seven Hebrew wordings
 * through the real `AgentTurnService`, the real `ToolDispatcher` and real SQLite:
 * every one came back `NO_MATERIAL_CLAIM` with `meetings` 0, was returned to the
 * caller AND persisted as a spoken AGENT turn. The comma version of each was
 * blocked in the same run. `MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS` was named
 * below as the mitigation for precisely this case and does not mitigate it: these
 * fillers are two to four tokens long.
 *
 * WHY THE FIX IS NOT A SHORTER CARRIER LIST
 * ---------------------------------------------------------------------------
 * Deleting `at`, `all`, `else`, `more`, `כלום`, `יותר` would close the leaks and
 * break `Nothing at all has been booked yet.`, `Nothing at all is booked yet.` and
 * `לא צריך כלום הפגישה לא נקבעה עדיין.` - all clean today, all needing exactly
 * those tokens carried across. The difference between the honest and the leaking
 * set is structural: in the honest ones the negator's complement IS the predicate
 * that follows it, and in the leaking ones a NEW PREDICATION intervenes.
 *
 * THE TWO RULES, BOTH SPLIT BY SUPPRESSOR KIND
 * ---------------------------------------------------------------------------
 *  1. A NEGATOR THAT OPENS ITS CLAUSE AND CANNOT BE A SUBJECT governs only its
 *     own modifiers. It has no subject - there is nothing before it in the clause
 *     to be one - so it is a stand-alone negative reply and the finite clause
 *     after it is somebody else's. That is the whole of `Not at all ...`, and in
 *     Hebrew, which is pro-drop and declares `subjectNegators` empty, it is the
 *     whole of `לא צריך כלום ...` and `אין יותר כלום ...` too. `nothing`, `none`
 *     and `nobody` are exempt because they ARE subjects, which is what keeps
 *     `Nothing at all has been booked yet.` clean.
 *  2. OTHERWISE, the reach ends at a FRESH PREDICATION - `freshPredicationStands`
 *     below holds that scan and its argument.
 *
 * A CONDITIONAL IS NOT A NEGATOR, and this is the split QA named. A subordinating
 * conditional EXISTS to open a clause, so it may cross that clause's subject:
 * `Once your meeting is booked I will let you know.` is a plan and must stay one.
 * Rule 1 therefore does not apply to a conditional at all, and rule 2 lets it
 * cross ONE subject - but only the one that starts where the conditional ends,
 * which is what separates it from `Once more your meeting is booked for Thursday
 * at 2pm.`, where an adverbial intervenes and the completion is an assertion.
 *
 * AN IDENTIFIER MARKER IS EXEMPT, and the reason is the reason `en.ts` lists the
 * verbs of giving at all: a marker is a NOUN PHRASE in object position rather than
 * a predicate, so "does the negator govern the predicate after it" is not the
 * question being asked. `I cannot give you a confirmation number for that.` is the
 * honest refusal that has to stay clean, and it is ditransitive - two object noun
 * phrases - which no predication scan reads correctly. The residual is stated in
 * `docs/MISSION_2D_CLAIM_GATE.md` § 18.6: a marker behind an all-carrier filler is
 * still suppressed, and what catches those sentences in practice is the
 * identifier SHAPE rule, which no negation touches at all.
 *
 * THE DIRECTION IS THE SAME ONE THE REST OF THIS MODULE TAKES. Every clause above
 * can only make suppression STRICTER, so it can only turn a miss into a detection.
 * A role declared wrong, a subject-capable negator left off `subjectNegators`, a
 * fresh predication this scan cannot see - each of those costs the coverage the
 * fix claims, or one regeneration of a true sentence, and none of them can cost a
 * claim that used to be detected. `tests/claimGate/claimGateCorpus.ts` asserts
 * that direction over every committed text.
 */
function governs(
  tokens: readonly ClaimToken[],
  suppressor: Suppressor,
  form: SuppressedForm,
  reach: SuppressionReach,
): boolean {
  if (!reachesForward(tokens, suppressor.from, form.position, reach)) return false;
  if (form.kind === 'NOUN_PHRASE') return true;
  // Adjacent. `לא קבעתי כלום עדיין.`, `nothing is booked yet`, `Not booked yet.` -
  // nothing stands between, so there is no new predication to find.
  if (suppressor.from >= form.position) return true;
  if (suppressor.kind === 'NEGATOR' && suppressor.opensItsClause && !suppressor.canBeASubject) return false;
  return !freshPredicationStands(tokens, suppressor, form, reach);
}

/**
 * Does a NEW PREDICATION stand between this suppressor and this form?
 *
 * THE SCAN, AND WHAT EACH STATE IS FOR
 * ---------------------------------------------------------------------------
 * A negator or a conditional is looking for exactly ONE predicate. The scan walks
 * the tokens between it and the form and asks, at each one, whether that predicate
 * has been found yet and whether its complements are used up:
 *
 *  - `SEEKING_PREDICATE` - the suppressor still needs its predicate. A MODIFIER
 *    does not supply one (`at all`, `else`, `more`, `יותר`), a PREPOSITION takes a
 *    noun phrase of its own and gives it back (`Nothing in the diary is booked.`,
 *    `None of your meetings are booked.`), a VERB supplies one, and a NOUN PHRASE
 *    standing here is a SUBJECT where a predicate was due - which is a new clause,
 *    and the answer is yes. `Nothing else your meeting is booked for Thursday at
 *    2pm.` is that case.
 *  - `PREDICATE_FOUND` / `SATURATED` - the suppressor has its predicate, so the
 *    first noun phrase after it is that verb's complement and a SECOND one is a
 *    new subject. `I don't have your meeting booked.` is why the first is
 *    swallowed; `לא היה כלום הפגישה נקבעה למחר.` is why the second is not. A MOOD
 *    suppressor STARTS here, because a modal or an intention verb IS a predicate:
 *    `Let me get your meeting booked for Thursday.` and `We haven't been able to
 *    get your meeting booked yet.` are the two sentences that require it.
 *  - `SUBJECT_SLOT_OPEN` - a CONDITIONAL only, and only when the noun phrase
 *    starts where the conditional ends. A subordinator opens a clause and that
 *    clause has a subject: `Once your meeting is booked I will let you know.`
 *    Requiring the noun phrase to be ADJACENT to the conditional is what stops
 *    `Once more your meeting is booked for Thursday at 2pm.` getting the same
 *    exemption, because `more` is a MODIFIER and not the start of a subject.
 *
 * AND THEN THE FORM ITSELF, WHICH IS THE HALF THAT CATCHES `Not at all I have
 * booked`. The frame `i have booked` carries its OWN subject, so there is nothing
 * between the negator and the new clause to find - the new clause starts at the
 * form. A form is read as bringing its own subject when it spans more than one
 * token and its first token can open a noun phrase: `i have booked`, `i'll call
 * you`, `callback is arranged`, `you are all set`. `has been booked`, `is booked`
 * and `all set` do not, because `has`, `is` and `all` are a VERB, a VERB and a
 * MODIFIER - which is exactly what keeps `Nothing at all has been booked yet.`
 * clean. A ONE-token form is never read this way: it is a bare predicate, and
 * `booked` in `I don't have your meeting booked.` is the sentence that requires it.
 *
 * WHERE THE SUPPRESSOR ALREADY HAS ITS PREDICATE, the form is a SECOND one - so a
 * FINITE form is a new clause and a bare PARTICIPLE is not. That single line is
 * what separates `לא צריך כלום קבעתי לך פגישה למחר בשעה 14:00.` (finite, and
 * pro-drop, so there is no subject token to find) from `I don't have your meeting
 * booked.` (a participle, which is a secondary predicate of `have`'s object).
 */
function freshPredicationStands(
  tokens: readonly ClaimToken[],
  suppressor: Suppressor,
  form: SuppressedForm,
  reach: SuppressionReach,
): boolean {
  const limit = form.position;
  /** The end of the noun phrase starting at `start`, or `start` if there is none. */
  const nounPhraseEnd = (start: number): number => {
    let index = start;
    while (index < limit && roleAt(tokens, index, reach) === 'DETERMINER') index += 1;
    if (index < limit && roleAt(tokens, index, reach) === 'SUBJECT') index += 1;
    return index;
  };

  let state: 'SEEKING_PREDICATE' | 'PREDICATE_FOUND' | 'SATURATED' | 'SUBJECT_SLOT_OPEN' =
    suppressor.kind === 'MOOD'
      ? 'PREDICATE_FOUND'
      : suppressor.kind === 'CONDITIONAL' && opensANounPhrase(roleAt(tokens, suppressor.from, reach))
        ? 'SUBJECT_SLOT_OPEN'
        : 'SEEKING_PREDICATE';

  let index = suppressor.from;
  while (index < limit) {
    const role = roleAt(tokens, index, reach);
    if (role === 'MODIFIER') {
      index += 1;
      continue;
    }
    if (role === 'VERB') {
      // A verb ALWAYS opens a fresh complement slot, including after a previous
      // one was filled. `Let me get your meeting booked for Thursday.` needs it:
      // `me` fills `let`'s slot, and `get` then has its own for `your meeting`.
      state = 'PREDICATE_FOUND';
      index += 1;
      continue;
    }
    if (role === 'PREPOSITION') {
      // The preposition's own complement, given straight back. `at all` has none -
      // `all` is a MODIFIER - so the scan simply moves on to it.
      index = Math.max(nounPhraseEnd(index + 1), index + 1);
      continue;
    }
    const end = nounPhraseEnd(index);
    if (state === 'SUBJECT_SLOT_OPEN') state = 'SEEKING_PREDICATE';
    else if (state === 'SEEKING_PREDICATE') return true;
    else if (state === 'PREDICATE_FOUND') state = 'SATURATED';
    else return true;
    index = Math.max(end, index + 1);
  }

  if (state === 'SEEKING_PREDICATE' || state === 'SUBJECT_SLOT_OPEN') {
    // The form brings its own SUBJECT, so the new clause starts at the form.
    if (form.formTokens > 1 && opensANounPhrase(roleAt(tokens, form.position, reach))) return true;
    // A bare PARTICIPLE is the negated predicate itself - `Nothing at all booked
    // for your meeting.` - so it is governed whatever it is made of.
    if (form.kind === 'PARTICIPLE') return false;
    // A FINITE form is the suppressor's predicate only if it OPENS like one. In
    // both registered languages a predicate a negator reaches across modifiers is
    // introduced by an auxiliary or a copula (`has been booked`, `is booked`), and
    // this is where Hebrew's pro-drop shows: `Not at all קבעתי לך פגישה למחר.`
    // puts a complete finite clause, subject and all, into one inflected word, so
    // there is no subject token for the scan above to find and the form's own
    // shape is the only evidence there is.
    return roleAt(tokens, form.position, reach) !== 'VERB';
  }
  return form.kind === 'FINITE';
}

/**
 * Read one sentence's suppression map for one locale.
 *
 * Computed once per sentence per lexicon rather than once per candidate form,
 * because the negator positions are the same for every form in the sentence and
 * finding them costs a pass over the tokens.
 *
 * FOUR CONDITIONS NOW, AND THE FOURTH IS THE § 18 FIX. A blocker suppresses a form
 * only when it stands in the SAME CLAUSE (§ 15), AT OR BEFORE it (§ 15), REACHES it
 * across carrier material only (§ 17), and GOVERNS it rather than a filler in front
 * of it (§ 18). The first two are about where the negator stands, the third about
 * what lies between, and only the fourth asks whether the thing it silences is its
 * own predicate or somebody else's clause.
 */
function readSuppression(
  sentence: ClaimSentence,
  clauses: readonly number[],
  lexicon: ClaimLexicon,
  reach: SuppressionReach,
): Suppression {
  const opensItsClause = (position: number): boolean =>
    position === 0 || clauses[position - 1] !== clauses[position];
  const blockers: readonly (Suppressor & { readonly position: number })[] = [
    ...formMatches(sentence.tokens, lexicon.negators).map((hit) => ({
      kind: 'NEGATOR' as const,
      position: hit.position,
      from: hit.position + hit.length,
      opensItsClause: opensItsClause(hit.position),
      canBeASubject: lexicon.subjectNegators.includes(hit.form),
    })),
    ...formMatches(sentence.tokens, lexicon.conditionalMarkers).map((hit) => ({
      kind: 'CONDITIONAL' as const,
      position: hit.position,
      from: hit.position + hit.length,
      opensItsClause: opensItsClause(hit.position),
      canBeASubject: false,
    })),
  ];
  // The clause a trailing `?` terminates is the LAST one, because `?` is a
  // sentence terminator and can therefore only stand at the end.
  const interrogativeClause = sentence.interrogative ? (clauses.at(-1) ?? null) : null;

  return {
    suppresses(form: SuppressedForm): boolean {
      const clause = clauses[form.position];
      if (clause === undefined) return false;
      // Rule 1 keeps its clause scope and needs no governance test: a question mark
      // is punctuation and it makes the WHOLE clause interrogative, so there is no
      // sense in which it governs some of the clause and not the rest.
      if (clause === interrogativeClause) return true;
      return blockers.some(
        (blocker) =>
          blocker.position <= form.position &&
          clauses[blocker.position] === clause &&
          governs(sentence.tokens, blocker, form, reach),
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
