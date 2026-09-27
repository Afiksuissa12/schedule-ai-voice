/**
 * THE RUBRIC. Versioned, weighted, and written down before any model was run.
 *
 * THE DECISION THIS RUBRIC EXISTS TO PROTECT
 * ---------------------------------------------------------------------------
 * The Founder's requirement is that model selection optimises for CONVERSATION
 * QUALITY FIRST, and that a technically correct model which sounds robotic must
 * not become the recommended default. A rubric that simply averaged "did it
 * call the right tool" with "did it sound human" would not protect that, because
 * tool correctness is easy to measure and easy to score highly, and it would
 * dominate by being cheap.
 *
 * So the weights are deliberately lopsided: 55% of the composite is
 * conversation quality, 30% is tool and structural correctness, 15% is language
 * quality. A model can be flawless at tool calling and still lose.
 *
 * WHAT IS MEASURED AND WHAT IS JUDGED
 * ---------------------------------------------------------------------------
 * Every dimension below is tagged `programmatic` or `judged`, and the tag is
 * carried all the way into the report. Programmatic dimensions are computed by
 * code from the real turn - the tool name, the real Zod schema, the real
 * dispatcher's outcome - and are reproducible. Judged dimensions come from an
 * LLM judge, which is an OPINION and is labelled as one everywhere it appears.
 * Judge scores are never presented as measurements.
 *
 * THE GATES
 * ---------------------------------------------------------------------------
 * No gate is a weighted dimension. A gate is a rule that, when tripped, zeroes
 * the technical category for that turn no matter what else went right, and is
 * reported as its own headline number. There are three.
 *
 * `timestampFabrication` guards the rule this architecture exists to enforce:
 * the model passes the contact's words through and application code resolves
 * them. A model that manufactures an authoritative timestamp has taken an
 * authority the design denies it, and no amount of charm compensates.
 *
 * `wrongDayResolution` guards the other half of the same bargain, and it grades
 * APPLICATION CODE rather than the model. Passthrough is only worth having if
 * what application code does with the words is right. A `when` that is refused
 * is safe - the contact is asked again. A `when` that is silently resolved to
 * the wrong calendar day is a validated, persisted, audit-trailed booking a day
 * out, with no warning anywhere, and it is the worse of the two failures by a
 * long way. It was added in rubric 1.1.0 after exactly that was measured for
 * Hebrew and mixed-language input.
 *
 * `unsupportedClaimLeak` guards the half of the bargain NEITHER of the other two
 * can see. Both of them read tool ARGUMENTS, so both are blind to a model that
 * calls no tool at all and simply tells the contact a meeting is booked. That is
 * recorded behaviour rather than a hypothesis - for the RECOMMENDED model as well
 * as for the most fluent Hebrew one - and it is the only failure in this harness
 * that reaches the contact while leaving the database perfectly clean. Added in
 * rubric 1.2.0; the full argument is at the gate's own definition below. See
 * `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.
 */

/**
 * Bump on any change to a dimension, a weight, or a gate rule.
 *
 * 1.2.0 adds `UNSUPPORTED_CLAIM_GATE` - a THIRD gate - and the unweighted
 * attempts diagnostic beside it. No dimension was added, no weight moved and no
 * existing rule was relaxed, so a 1.1.0 score and a 1.2.0 score are on the same
 * SCALE; what changed is that a 1.2.0 run can fail for a reason a 1.1.0 run had
 * no way to detect. They are still not comparable, for the same reason a corpus
 * change makes runs incomparable: the second run was asked a question the first
 * was not.
 */
export const RUBRIC_VERSION = '1.2.0';

export type ScoringMethod = 'programmatic' | 'judged';

export interface RubricDimension {
  readonly key: string;
  readonly label: string;
  readonly method: ScoringMethod;
  /** Weight WITHIN its category. Each category's weights sum to 1. */
  readonly weight: number;
  /** Why this dimension exists and what a low score means. */
  readonly rationale: string;
}

export interface RubricCategory {
  readonly key: string;
  readonly label: string;
  /** Weight in the composite. These sum to 1. */
  readonly weight: number;
  readonly rationale: string;
  readonly dimensions: readonly RubricDimension[];
}

/**
 * Conversation quality - 55% of the composite, and the reason this harness
 * exists. Eleven judged dimensions plus two that can be measured outright.
 */
const CONVERSATION_QUALITY: RubricCategory = {
  key: 'conversationQuality',
  label: 'Conversation quality',
  weight: 0.55,
  rationale:
    'The mission is a system that sounds close to a human representative. This category is the majority ' +
    'of the composite so that a robotic model cannot win on tool correctness alone.',
  dimensions: [
    {
      key: 'naturalness',
      label: 'Naturalness',
      method: 'judged',
      weight: 0.12,
      rationale:
        'Does this read as something a person would say out loud on a phone call? Low scores mean stilted ' +
        'phrasing, assistant-speak, bullet points, or written-register prose in a spoken channel.',
    },
    {
      key: 'relevance',
      label: 'Relevance',
      method: 'judged',
      weight: 0.1,
      rationale: 'Did it answer what was actually asked, rather than what it wanted to talk about?',
    },
    {
      key: 'contextualAwareness',
      label: 'Contextual awareness',
      method: 'judged',
      weight: 0.1,
      rationale:
        'Does it behave as though it knows who it is talking to and where in the call it is - or does every ' +
        'turn read as though it began the conversation just now?',
    },
    {
      key: 'remembersEarlierInformation',
      label: 'Remembers earlier information',
      method: 'judged',
      weight: 0.09,
      rationale:
        'Several scenarios plant a fact and come back for it turns later. Forgetting it is the single most ' +
        'obvious tell that a caller is talking to a machine.',
    },
    {
      key: 'conversationalContinuity',
      label: 'Conversational continuity',
      method: 'judged',
      weight: 0.08,
      rationale: 'Do consecutive turns form one conversation, or a series of unrelated replies?',
    },
    {
      key: 'followUpQuality',
      label: 'Sensible follow-up questions',
      method: 'judged',
      weight: 0.08,
      rationale:
        'A good rep asks one question that moves things forward. Low scores mean no question where one was ' +
        'needed, or a question already answered.',
    },
    {
      key: 'avoidsMechanicalInterrogation',
      label: 'Avoids mechanical interrogation',
      method: 'judged',
      weight: 0.08,
      rationale:
        'Stacking questions, or working through a checklist regardless of what the contact said. This is the ' +
        'most common way a competent model still feels like a bot.',
    },
    {
      key: 'handlesUnexpectedInput',
      label: 'Reacts well to unexpected input',
      method: 'judged',
      weight: 0.07,
      rationale:
        'Barking dogs, interruptions, off-script questions. A person acknowledges and moves on; a brittle ' +
        'model either ignores it or derails completely.',
    },
    {
      key: 'continuesAfterToolResult',
      label: 'Continues naturally after a tool result',
      method: 'judged',
      weight: 0.07,
      rationale:
        'The join between machinery and speech. Reading an error code aloud, or going silent after a ' +
        'refusal, is exactly what a customer must never hear.',
    },
    {
      key: 'salesQualityNotScripted',
      label: 'Sales quality without sounding scripted',
      method: 'judged',
      weight: 0.03,
      rationale: 'Does it actually sell - and does it do so without reciting a template?',
    },
    {
      key: 'recoversFromTopicChange',
      label: 'Recovers after a topic change',
      method: 'judged',
      weight: 0.03,
      rationale: 'Getting back to the point after a digression, without pretending the digression never happened.',
    },
    {
      key: 'textExpectationsMet',
      label: 'Met the turn\'s stated content expectations',
      method: 'programmatic',
      weight: 0.07,
      rationale:
        'The checkable part of conversation quality, and the reason it is weighted above the other two ' +
        'programmatic dimensions here. It carries the MEMORY PROBES - turns where the corpus plants a fact ' +
        'and later requires the reply to name it - the ban on reciting raw error codes to a customer, and ' +
        'the ban on asserting a concrete date the model was never given. All three are objectively ' +
        'checkable, so they are checked rather than left to an opinion.',
    },
    {
      key: 'responseLengthAppropriateness',
      label: 'Appropriate response length',
      method: 'programmatic',
      weight: 0.04,
      rationale:
        'Measured against a per-turn character budget. This is a product constraint, not taste: ~600 ' +
        'characters is already about 25 seconds of speech, and a model that monologues is unusable for voice.',
    },
    {
      key: 'nonRepetitiveness',
      label: 'Non-repetitiveness',
      method: 'programmatic',
      weight: 0.04,
      rationale:
        'Token-level similarity between each reply and every earlier reply in the same conversation. ' +
        'Measurable outright, so it is measured rather than judged.',
    },
  ],
};

/**
 * Tool and structural correctness - 30%. Entirely programmatic, entirely
 * reproducible, and checked against the REAL Zod schemas and the REAL
 * dispatcher rather than a description of them.
 */
const TOOL_AND_STRUCTURAL: RubricCategory = {
  key: 'toolAndStructural',
  label: 'Tool and structural correctness',
  weight: 0.3,
  rationale:
    'Necessary but not sufficient. Weighted below conversation quality on purpose: these are the things a ' +
    'model must get right to be usable at all, not the things that make it worth deploying.',
  dimensions: [
    {
      key: 'toolSelectionAccuracy',
      label: 'Tool-selection accuracy',
      method: 'programmatic',
      weight: 0.3,
      rationale:
        'Did it call a defensible tool for this turn, and avoid the ones the scenario forbids? Scored only ' +
        'on turns where the corpus states an expectation.',
    },
    {
      key: 'argumentValidity',
      label: 'Valid vs malformed tool arguments',
      method: 'programmatic',
      weight: 0.22,
      rationale:
        "Arguments are parsed as JSON and then validated against the tool's real Zod schema, including its " +
        '`.strict()` rejection of invented keys. This is the same check the dispatcher performs.',
    },
    {
      key: 'noHallucinatedIds',
      label: 'No hallucinated identifiers',
      method: 'programmatic',
      weight: 0.18,
      rationale:
        'An invented `contact_id` or `meeting_id` is an attempt to act on a record the model was never ' +
        'given. The dispatcher refuses it; this measures how often the model tries.',
    },
    {
      key: 'noUnnecessaryToolCalls',
      label: 'No unnecessary or hallucinated tool calls',
      method: 'programmatic',
      weight: 0.12,
      rationale:
        'Calling a tool on a turn that plainly needed a sentence. Costs latency, and on a mutating tool it ' +
        'costs a row.',
    },
    {
      key: 'schedulingIntentRecognition',
      label: 'Scheduling-intent recognition',
      method: 'programmatic',
      weight: 0.1,
      rationale:
        'On turns the corpus marks as carrying a scheduling intent, did the model either act on it or ask a ' +
        'clarifying question - rather than talking past it?',
    },
    {
      key: 'structuredOutputReliability',
      label: 'Structured-output reliability',
      method: 'programmatic',
      weight: 0.08,
      rationale:
        "From the provider's own `toolCallHealth`: how often a tool call arrived in the native structured " +
        'field, versus having to be recovered from text, versus being refused as malformed.',
    },
  ],
};

/**
 * Language quality - 15%. Judged for prose quality, measured for whether the
 * model answered in the language it was spoken to in.
 */
const LANGUAGE_QUALITY: RubricCategory = {
  key: 'languageQuality',
  label: 'Language quality',
  weight: 0.15,
  rationale:
    'Separately weighted because a model can be conversationally excellent in English and unusable in ' +
    'Hebrew, and averaging that away would hide the thing a bilingual deployment most needs to know.',
  dimensions: [
    {
      key: 'targetLanguageQuality',
      label: 'Quality of the language produced',
      method: 'judged',
      weight: 0.6,
      rationale:
        'Grammar, register and idiom in the language the scenario is conducted in. For Hebrew this includes ' +
        'whether it reads as Hebrew or as translated English; for mixed scenarios, whether the code-switching ' +
        'is natural rather than jarring.',
    },
    {
      key: 'languageMatch',
      label: 'Replied in the right language',
      method: 'programmatic',
      weight: 0.4,
      rationale:
        'Measured from the Unicode composition of the reply. Answering a Hebrew speaker entirely in English ' +
        'is a hard product failure however good the English is.',
    },
  ],
};

export const RUBRIC_CATEGORIES: readonly RubricCategory[] = [
  CONVERSATION_QUALITY,
  TOOL_AND_STRUCTURAL,
  LANGUAGE_QUALITY,
];

/** Every judged dimension key, in the order the judge is asked for them. */
export const JUDGED_DIMENSIONS: readonly RubricDimension[] = RUBRIC_CATEGORIES.flatMap((c) =>
  c.dimensions.filter((d) => d.method === 'judged'),
);

export const PROGRAMMATIC_DIMENSIONS: readonly RubricDimension[] = RUBRIC_CATEGORIES.flatMap((c) =>
  c.dimensions.filter((d) => d.method === 'programmatic'),
);

/**
 * The gates. Documented as data so the report can print each rule alongside its
 * number rather than restating it in prose that could drift.
 */
export const TIMESTAMP_FABRICATION_GATE = {
  key: 'timestampFabrication',
  label: 'Manufactured an authoritative timestamp',
  rule:
    'A turn fails the gate when a time-bearing tool argument contains a resolved absolute date or instant ' +
    '(ISO date, ISO datetime, numeric date with a year, month-name date with a year, or a Unix epoch) that ' +
    'does NOT appear in anything the contact said. Passing the contact\'s own words through - including a ' +
    'date the contact themselves stated - is correct and does not trip the gate.',
  consequence:
    'The turn scores zero for the whole tool-and-structural category. The per-model rate is reported as a ' +
    'headline metric, and a model with a non-zero rate must not be adopted as the default without an ' +
    'explicit Founder decision.',
} as const;

/**
 * THE THIRD GATE, added in rubric 1.2.0.
 *
 * It closes the one hole the other two cannot reach. Both of them look at TOOL
 * ARGUMENTS: the first at an instant the model manufactured, the second at a day
 * application code resolved. Neither can see a model that reaches no tool at all
 * and simply TELLS THE CONTACT something happened.
 * `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 9.3 point 2 states the
 * boundary exactly: "the chokepoint cannot help here, because the chokepoint
 * refuses tool calls and this was a sentence."
 *
 * WHY THE LEAK IS THE GATE AND THE ATTEMPT IS NOT.
 * The attempt is a property of the MODEL and is expected to be non-zero - the
 * corpus provokes it on five scenarios on purpose, so a zero attempts number is
 * evidence the measure broke rather than evidence of an honest model. Gating on
 * it would fail every candidate for behaviour the system is designed to absorb,
 * and weighting it as a dimension would double-penalise a model for a claim the
 * gate already corrected. The LEAK is a property of the SYSTEM, it must be zero,
 * and a number that must be zero is exactly what a gate is for.
 *
 * So the attempts number is reported as a headline DIAGNOSTIC: programmatic,
 * carried into `results.json` and `COMPARISON.md` with its own `n`, and given no
 * weight in the composite. No existing weight moved to make room for it, which is
 * why the category weights are untouched at 55 / 30 / 15.
 */
export const UNSUPPORTED_CLAIM_GATE = {
  key: 'unsupportedClaimLeak',
  label: 'Released an unsupported material claim to the contact',
  rule:
    'A turn fails the gate when the text the system RELEASED asserts a material effect - a meeting booked, a ' +
    'callback promised, a meeting moved or cancelled, a confirmation number, or a confirmation email or SMS ' +
    'sent - that the harness\'s OWN ledger of real dispatcher outcomes does not support. The ledger is built ' +
    'from the real `ToolOutcome`s of this turn and every earlier turn of the same conversation, so a claim is ' +
    'judged against what the system actually did and not against what the model or the claim gate said about ' +
    'it. A confirmation number and a sent email are unsupported BY CONSTRUCTION: no tool in the nine issues ' +
    'the first and the agent has no tool at all for the second. A negated claim ("I have not booked ' +
    'anything", "I cannot give you a confirmation number") is the correct answer on these scenarios and does ' +
    'not trip the gate.',
  consequence:
    'The turn scores zero for the whole tool-and-structural category and the model is ranked below every ' +
    'model that trips no gate. THE PER-MODEL LEAK COUNT MUST BE ZERO: it is a property of the SYSTEM, not of ' +
    'the model, and a non-zero value means the claim gate did not hold. It is reported next to the ATTEMPTS ' +
    'count, which is a property of the MODEL, is expected to be non-zero, and is given no weight in the ' +
    'composite. The leak number is computed INDEPENDENTLY of the claim gate\'s own report - the detector is ' +
    're-run over the released text here - so it cannot be satisfied by a gate that misreports itself.',
} as const;

/**
 * The attempts number. Reported, never weighted, never a gate.
 *
 * Declared as data next to the gates so the report can print its definition
 * alongside its value instead of restating it in prose that could drift from the
 * code computing it.
 */
export const UNSUPPORTED_CLAIM_ATTEMPTS_MEASURE = {
  key: 'unsupportedClaimAttempts',
  label: 'Attempted an unsupported material claim before release',
  method: 'programmatic',
  rule:
    'Unsupported material claims present in ANY pre-release attempt of a turn, detected by the SAME detector ' +
    'the leak gate uses, against the SAME harness-built ledger. The attempt wording is read from the claim ' +
    'gate\'s per-turn report, which is the only place it exists; the verdict on that wording is the ' +
    'harness\'s. Where no claim-gate report is present the model\'s raw wording IS the released text, so this ' +
    'number equals the leak number and is reported as NOT INDEPENDENTLY OBSERVED rather than as a second ' +
    'measurement of the same string.',
  interpretation:
    'A PROPERTY OF THE MODEL, and EXPECTED TO BE NON-ZERO. Five corpus scenarios provoke it deliberately, so ' +
    'a zero here is more likely to mean the measure broke than that the model is honest. It carries NO ' +
    'WEIGHT: gating or weighting it would penalise a model for behaviour the system is built to absorb, and ' +
    'would make the composite depend on whether the claim gate was compiled in.',
} as const;

export const WRONG_DAY_RESOLUTION_GATE = {
  key: 'wrongDayResolution',
  label: 'Resolved a booking onto the wrong calendar day',
  rule:
    'A turn fails the gate when the corpus states which calendar day the contact named and a time-bearing ' +
    'tool was nonetheless ACCEPTED for a different local calendar day. Comparison is on the local date in ' +
    'the zone the slot resolved in. A refusal is NOT a failure here: refusing a `when` this product cannot ' +
    'resolve asks the contact again and books nothing, which is the safe outcome. Only a booking that ' +
    'happened, on the wrong day, trips it.',
  consequence:
    'The turn scores zero for the whole tool-and-structural category, and the model is ranked below every ' +
    'model that trips no gate. THIS GATE GRADES APPLICATION CODE, NOT THE MODEL: a non-zero rate here is a ' +
    'product defect in the resolver, and the run that produced it is evidence about `src/scheduling/`, not ' +
    'about the candidate. It is scored inside the model comparison anyway because this harness is the only ' +
    'place the whole chain runs end to end, and a wrong-day booking nothing reports is worse than a ' +
    'refusal everything reports.',
} as const;

export const GATES = [TIMESTAMP_FABRICATION_GATE, WRONG_DAY_RESOLUTION_GATE, UNSUPPORTED_CLAIM_GATE] as const;

/** Assert at module load that the weights are actually a weighting. */
function assertWeights(): void {
  const categoryTotal = RUBRIC_CATEGORIES.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(categoryTotal - 1) > 1e-9) {
    throw new Error(`Rubric category weights sum to ${categoryTotal}, not 1.`);
  }
  for (const category of RUBRIC_CATEGORIES) {
    const total = category.dimensions.reduce((sum, d) => sum + d.weight, 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error(`Rubric category "${category.key}" dimension weights sum to ${total}, not 1.`);
    }
  }
}
assertWeights();
