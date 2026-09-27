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
 * THE FOUR RULES, IN ORDER
 * ---------------------------------------------------------------------------
 * Per SENTENCE, because that is the scope a negation really has:
 *
 *  1. An INTERROGATIVE sentence asserts nothing. `Shall I get that booked?` is a
 *     question; excluding it is a property of punctuation, not of a language.
 *  2. A sentence carrying a NEGATOR asserts no completion. `Nothing is booked
 *     yet` must pass through as the truthful sentence it is.
 *  3. A sentence carrying a CONDITIONAL marker asserts no completion. `Once that
 *     is booked I will let you know` is a plan.
 *  4. Otherwise every completion form that matches produces one claim, carrying
 *     the family, the mode, and any day and time the sentence asserts.
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
} from './lexicon/index.js';
import { matchLongestForm, readSentences, type ClaimSentence, type ClaimToken } from './text.js';

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

  for (const sentence of sentences) {
    const identifiers = identifierShapedTokens(sentence);
    const day = detectDay(sentence.tokens, schedulingLexicons, claimLexicons);
    const time = detectTime(sentence.tokens, schedulingLexicons);

    for (const lexicon of claimLexicons) {
      const negated = anyFormPresent(sentence.tokens, lexicon.negators);
      const conditional = anyFormPresent(sentence.tokens, lexicon.conditionalMarkers);
      const asserting = !sentence.interrogative && negated === null && conditional === null;

      if (asserting) {
        for (const claim of matchCompletionMarkers(sentence, lexicon)) {
          out.push({ ...claim, assertedDay: day, assertedTime: time, identifiers });
        }
      }

      // An identifier MARKER is an assertion that the system has an identifier
      // to give. Suppressed by negation, like a completion form.
      if (asserting) {
        const marker = anyFormPresent(sentence.tokens, lexicon.identifierMarkers);
        if (marker !== null) {
          out.push({
            kind: 'IDENTIFIER_ASSERTED',
            family: 'ANY',
            mode: 'COMPLETED',
            locale: lexicon.locale,
            matchedForm: marker,
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

function matchCompletionMarkers(
  sentence: ClaimSentence,
  lexicon: ClaimLexicon,
): readonly Omit<DetectedClaim, 'assertedDay' | 'assertedTime' | 'identifiers'>[] {
  const out: Omit<DetectedClaim, 'assertedDay' | 'assertedTime' | 'identifiers'>[] = [];
  const seen = new Set<string>();

  for (let position = 0; position < sentence.tokens.length; position += 1) {
    // THE LONGEST FORM AT THIS POSITION WINS, ACROSS FAMILIES, AND CONSUMES ITS
    // TOKENS. Without that, `the callback is booked` fires twice: once as
    // CALLBACK (`callback is booked`, three tokens from position 1) and once as
    // MEETING (`is booked`, two tokens from position 2) - so a correctly booked
    // callback would be reported as an unsupported MEETING claim and a truthful
    // sentence would be regenerated. Same rule, same reason, as the scheduling
    // resolver's longest-match-at-a-position.
    let best: { entry: (typeof lexicon.completionMarkers)[number]; length: number; form: string } | null = null;
    for (const entry of lexicon.completionMarkers) {
      const hit = matchLongestForm(sentence.tokens, position, entry.forms);
      if (hit === null) continue;
      if (best === null || hit.length > best.length) best = { entry, length: hit.length, form: hit.form };
    }
    if (best === null) continue;

    const key = `${best.entry.family}:${best.entry.mode}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        kind: 'EFFECT_ASSERTED',
        family: best.entry.family,
        mode: best.entry.mode,
        locale: lexicon.locale,
        matchedForm: best.form,
        sentenceIndex: sentence.index,
        excerpt: sentence.raw,
      });
    }
    position += best.length - 1;
  }

  return out;
}

function anyFormPresent(tokens: readonly ClaimToken[], forms: readonly string[]): string | null {
  if (forms.length === 0) return null;
  for (let position = 0; position < tokens.length; position += 1) {
    const hit = matchLongestForm(tokens, position, forms);
    if (hit) return hit.form;
  }
  return null;
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
