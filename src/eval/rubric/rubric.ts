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
 * THE GATE
 * ---------------------------------------------------------------------------
 * `timestampFabrication` is not a weighted dimension. It is a GATE. The single
 * rule this architecture exists to enforce is that the model passes the
 * contact's words through and application code resolves them; a model that
 * manufactures an authoritative timestamp has taken an authority the design
 * denies it, and no amount of charm compensates. A turn that does it scores
 * zero on the technical category regardless of everything else, and the rate is
 * reported as its own headline number.
 */

/** Bump on any change to a dimension, a weight, or a gate rule. */
export const RUBRIC_VERSION = '1.0.0';

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
 * The gate. Documented as data so the report can print the rule alongside the
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
