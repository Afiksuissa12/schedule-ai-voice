/**
 * What the model is told, as a STRUCTURE - and the one function that turns that
 * structure into prompt text.
 *
 * THE SHAPE OF THIS FILE IS THE ARGUMENT
 * ---------------------------------------------------------------------------
 * `ContextFacts` is a bag of facts and goals. Read the type and notice what it
 * cannot express: there is no `nextQuestion`, no `stage`, no `step`, no
 * `script`, no ordered `agenda`, and no field anywhere that holds a sentence
 * for the agent to utter. A conversation state machine cannot be built out of
 * this type, because the type has nowhere to put the state or the transitions.
 *
 * That is deliberate and it is the mission's governing rule expressed as a data
 * structure rather than as a warning comment. The pieces that LOOK like they
 * might be a flow are specifically not one:
 *
 *  - `openKnowledgeGoals` is what we do not yet know. It is rendered in a fixed
 *    ALPHABETICAL order, chosen precisely because alphabetical is not a
 *    priority order and cannot be mistaken for one, and the prompt says in
 *    words that it is not a queue to work through. The fixed order exists for
 *    byte-determinism (see `npm run context:prove`), nothing else.
 *  - `unresolved` is a set of loose ends, tagged with who left them. Raising
 *    one, all of them, or none is the model's call.
 *  - `objective` is a GOAL ("get a conversation with a solutions engineer into
 *    the diary where it makes sense"), never a line to deliver.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY
 * ---------------------------------------------------------------------------
 * The phone number and the email address, for the reasons `turnContext.ts`
 * already gives: the model never dials and never sends, so a dialable number in
 * a context window is pure downside - it can be read out loud and it cannot be
 * used. `npm run context:prove` asserts their absence from both the rendered
 * text and the disclosure map rather than trusting this paragraph.
 *
 * DISCLOSURE IS DERIVED, NOT WRITTEN TWICE
 * ---------------------------------------------------------------------------
 * `renderContext` returns the text and the disclosure record built in ONE pass
 * from ONE structure. A disclosure map maintained separately from the renderer
 * drifts on the first edit and then lies on every audit afterwards, which is
 * worse than having none.
 *
 * The record is split in two, and the split is what makes it checkable:
 *
 *  - `disclosed` - what the prompt SAYS. Every string leaf of it is a
 *    substring of `text`, and `npm run context:prove` fails if one is not.
 *  - `disclosureMetadata` - ids, enum tags, counts, budget outcomes. Just as
 *    durable and on the same audit event, but never claimed to be in the
 *    prompt, because none of it is.
 *
 * Without that separation the invariant would have to be softened to "most
 * strings appear", and an invariant with an exceptions list is not one.
 */
import type { IsoUtcString } from '../ports/clock.js';

// ---------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------

export interface ContactFacts {
  /** Included because every tool call has to name a contact. */
  readonly id: string;
  readonly displayName: string;
  readonly timezone: string;
  /** Their wall clock, right now, in words. From the injected Clock. */
  readonly localNow: string;
  readonly isDecisionMaker: boolean;
  /** `Contact.notes` - a durable CRM note a human wrote. */
  readonly crmNote: string | null;
  /** `Lead.source` / `Lead.status`, when a lead exists. */
  readonly lead: { readonly source: string; readonly status: string } | null;
}

export interface QualificationFacts {
  readonly band: string;
  readonly score: number;
  readonly rawScore: number;
  readonly cappedScore: number;
  readonly capApplied: boolean;
  readonly rubricVersion: string;
  /** Rubric factors with evidence behind them. */
  readonly evidenced: readonly string[];
  /** Rubric factors nobody has evidenced yet. */
  readonly unevidenced: readonly string[];
}

/** Something we want to learn. A noun phrase, never a question to put. */
export interface OpenKnowledgeGoal {
  readonly id: string;
  readonly whatWeWantToKnow: string;
  readonly whyItMatters: string;
}

export type DurableFactOrigin = 'THIS_CONVERSATION' | 'EARLIER_CONVERSATION' | 'CRM_RECORD';

export interface DurableFactView {
  readonly id: string;
  readonly fact: string;
  readonly origin: DurableFactOrigin;
}

export interface RunningSummaryFacts {
  readonly narrative: string;
  /** Highest turn index the narrative accounts for. */
  readonly coversThroughTurnIndex: number;
  /** How the memory was stored: a real envelope, or a Baseline V1 plain recap. */
  readonly source: string;
}

export interface PreviousConversationFacts {
  readonly conversationId: string;
  readonly status: string;
  readonly startedLocal: string;
  readonly endedLocal: string | null;
  /** `CallOutcome.outcome`, when the previous conversation had a call. */
  readonly callOutcome: string | null;
  readonly callOutcomeNotes: string | null;
  /** The previous conversation's own narrative, if it left one. */
  readonly narrative: string | null;
}

export type UnresolvedSource =
  /** The rolling summary of THIS conversation noticed it. */
  | 'REMEMBERED'
  /** An EARLIER conversation left it hanging, and nobody has closed it since. */
  | 'REMEMBERED_EARLIER'
  /** Derived with no model at all: a tool call that failed and never succeeded. */
  | 'FAILED_TOOL_CALL';

export interface UnresolvedTopicView {
  readonly id: string;
  readonly topic: string;
  readonly raisedBy: 'CONTACT' | 'AGENT';
  readonly source: UnresolvedSource;
}

/** Something the SYSTEM has already persisted a promise about. */
export interface CommitmentFacts {
  readonly kind: 'MEETING' | 'CALLBACK';
  readonly id: string;
  readonly whenLocal: string;
  readonly status: string;
  readonly title: string | null;
}

export interface BusinessFactsView {
  readonly profileRef: string;
  readonly companyName: string;
  readonly whatWeAre: string;
  readonly whatWeDo: string;
  readonly proofPoints: readonly string[];
  readonly operatingRegions: readonly string[];
  readonly personaName: string;
  readonly personaRole: string;
  readonly voiceTraits: readonly string[];
  readonly mustDisclose: readonly string[];
  readonly outOfScope: readonly string[];
  readonly products: readonly {
    readonly name: string;
    readonly summary: string;
    readonly bestFor: string;
    readonly capabilities: readonly string[];
    readonly limitations: readonly string[];
    readonly integrations: readonly string[];
  }[];
  readonly currency: string;
  readonly plans: readonly {
    readonly name: string;
    readonly headlinePrice: string;
    readonly billingPeriod: string;
    readonly includes: readonly string[];
    readonly notes: readonly string[];
  }[];
  readonly discountFacts: readonly string[];
  readonly agentMayNotCommit: readonly string[];
  readonly policies: readonly { readonly topic: string; readonly fact: string }[];
  readonly topics: readonly { readonly topic: string; readonly facts: readonly string[] }[];
  readonly meetingTypes: readonly {
    readonly name: string;
    readonly durationMinutes: number;
    readonly whatHappens: string;
    readonly whoAttends: string;
  }[];
  readonly objectivePrimary: string;
  readonly objectiveSupporting: readonly string[];
  readonly acceptableOutcomes: readonly string[];
}

export interface TranscriptFacts {
  readonly totalTurnCount: number;
  readonly includedTurnCount: number;
  readonly droppedTurnCount: number;
  readonly droppedThroughIndex: number | null;
  readonly charCount: number;
  readonly budgetChars: number;
  readonly limitedBy: string;
}

/** Everything the turn-scoped context message is built from. */
export interface ContextFacts {
  readonly contact: ContactFacts;
  readonly qualification: QualificationFacts | null;
  readonly runningSummary: RunningSummaryFacts | null;
  readonly durableFacts: readonly DurableFactView[];
  readonly previousConversation: PreviousConversationFacts | null;
  readonly unresolved: readonly UnresolvedTopicView[];
  readonly commitments: readonly CommitmentFacts[];
  readonly openKnowledgeGoals: readonly OpenKnowledgeGoal[];
  readonly business: BusinessFactsView | null;
  readonly transcript: TranscriptFacts;
  readonly nowUtc: IsoUtcString;
}

export interface RenderedContext {
  readonly text: string;
  /**
   * WHAT THE MODEL WAS TOLD, for the audit event.
   *
   * THE INVARIANT: every string leaf of this object is a substring of `text`.
   * That is what makes it a record rather than a claim, and
   * `npm run context:prove` fails if it stops holding.
   *
   * The invariant is only worth having if it is exact, which is why the
   * internal labels live next door in `disclosureMetadata` instead. A map that
   * mixed "the fact we told them we run twelve technicians" with "we filed that
   * fact under crew_size" could not support the invariant, and a weakened
   * invariant ("most strings appear, except the ones that do not") proves
   * nothing at all.
   */
  readonly disclosed: Record<string, unknown>;
  /**
   * HOW IT WAS LABELLED INTERNALLY. Ids, enum tags, counts, budget outcomes.
   *
   * Recorded on the same audit event and just as durable - an auditor asking
   * "which stored fact produced that sentence" needs the id - but deliberately
   * NOT claimed to appear in the prompt, because none of it does.
   */
  readonly disclosureMetadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The frame.
 *
 * This paragraph is doing real work on a 7B model, which is much more inclined
 * than a frontier model to treat a list it was handed as a list it should work
 * through out loud. Saying "these are facts, not a script, and not an order"
 * explicitly - and then saying that a fact the conversation does not need
 * should simply go unused - measurably reduces the failure mode where the model
 * recites the business profile at a person who asked about parking.
 */
const FRAME = [
  'Everything in this message is BACKGROUND, assembled for you by the application from its own records.',
  'It is a set of facts and goals. It is not a script, not an agenda, and not an order of play.',
  'Nothing here is a sentence for you to read out. Put anything you use into your own words, in the',
  'register of the conversation you are actually having.',
  'Most of it will not be needed. A fact you do not need is a fact you do not mention.',
  'Headings and lists are for your benefit only - a person on a phone call has never heard a bullet point.',
];

/**
 * The anti-date-arithmetic reinforcement.
 *
 * The contact's current local time is given because "tomorrow afternoon" is
 * meaningless without it and because times must be spoken back in their zone.
 * But handing a model a clock is also an invitation to do arithmetic with it,
 * and a model that computes an instant has to be right about the date, the
 * zone, and any DST transition in between - which it will eventually not be,
 * silently. So the clock arrives already bolted to the rule about what to do
 * with it. `SchedulingValidator` is what actually enforces this; the words
 * exist so that a cooperative model produces fewer rejections.
 */
const TIME_DISCIPLINE = [
  'That clock is context for understanding them, not arithmetic for you to do.',
  'When a time comes up, pass the words the contact used - their phrasing, unchanged - to the tool.',
  'Working out a date or a timestamp yourself is not your job and it will be rejected.',
];

export function renderContext(facts: ContextFacts): RenderedContext {
  const lines: string[] = [];
  // `disclosed` carries only what the prompt actually says; `metadata` carries
  // the ids and tags that let an auditor trace a sentence back to a row. The
  // split is what keeps the "every disclosed string is in the text" invariant
  // exact rather than approximate.
  const disclosed: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  lines.push('# Background for this turn', '', ...FRAME, '');

  // ---- who ---------------------------------------------------------------
  const { contact } = facts;
  lines.push('## The person you are speaking with', '');
  lines.push(`Name: ${contact.displayName}`);
  lines.push(`Contact id: ${contact.id} - use exactly this id in every tool call, and never any other.`);
  lines.push(`Timezone: ${contact.timezone}. Their local clock right now reads ${contact.localNow}.`);
  lines.push(...TIME_DISCIPLINE);
  lines.push(
    contact.isDecisionMaker
      ? 'Our record has them able to make the buying decision themselves.'
      : 'Our record has them NOT as the decision maker, so their qualification score is capped until we are ' +
          'talking to whoever signs.',
  );
  if (contact.crmNote) lines.push(`A colleague's note on their record: ${contact.crmNote}`);
  if (contact.lead) lines.push(`They came to us through ${contact.lead.source}; the lead is ${contact.lead.status}.`);
  lines.push('');

  disclosed['contact'] = {
    // The id IS disclosed and IS in the text: every tool call has to name a
    // contact, and the alternative is a model guessing at identifiers.
    id: contact.id,
    displayName: contact.displayName,
    timezone: contact.timezone,
    localNow: contact.localNow,
    isDecisionMaker: contact.isDecisionMaker,
    crmNote: contact.crmNote,
    leadSource: contact.lead?.source ?? null,
    leadStatus: contact.lead?.status ?? null,
  };

  // ---- where this conversation has got to --------------------------------
  if (facts.runningSummary && facts.runningSummary.narrative) {
    lines.push('## Earlier in this same conversation', '');
    lines.push(
      'The live transcript below holds only the most recent stretch. This is the recap of what came before it,',
      'so that returning to an earlier subject does not start from nothing.',
      '',
    );
    lines.push(facts.runningSummary.narrative, '');
    disclosed['runningSummary'] = { narrative: facts.runningSummary.narrative };
    metadata['runningSummary'] = {
      coversThroughTurnIndex: facts.runningSummary.coversThroughTurnIndex,
      source: facts.runningSummary.source,
    };
  } else {
    disclosed['runningSummary'] = null;
    metadata['runningSummary'] = null;
  }

  // ---- last time ----------------------------------------------------------
  if (facts.previousConversation) {
    const previous = facts.previousConversation;
    lines.push('## The last time we spoke', '');
    lines.push(`That conversation started ${previous.startedLocal} their time and ended ${previous.status}.`);
    if (previous.callOutcome) {
      lines.push(
        `The call itself was recorded as ${previous.callOutcome}` +
          (previous.callOutcomeNotes ? `, noted as: ${previous.callOutcomeNotes}` : '.'),
      );
    }
    if (previous.narrative) lines.push(`What it came to: ${previous.narrative}`);
    lines.push(
      'They are not a stranger. Opening as though this is a first contact is the single most obvious way to',
      'sound like a machine.',
      '',
    );
    disclosed['previousConversation'] = {
      status: previous.status,
      startedLocal: previous.startedLocal,
      callOutcome: previous.callOutcome,
      // Rendered only when there is an outcome to attach it to, so it is
      // disclosed only then too.
      callOutcomeNotes: previous.callOutcome ? previous.callOutcomeNotes : null,
      narrative: previous.narrative,
    };
    metadata['previousConversation'] = {
      conversationId: previous.conversationId,
      // Read from the row but not rendered: which instant a past conversation
      // ended is bookkeeping, and the model has no use for it.
      endedLocal: previous.endedLocal,
      suppressedCallOutcomeNotes: previous.callOutcome ? null : previous.callOutcomeNotes,
    };
  } else {
    disclosed['previousConversation'] = null;
    metadata['previousConversation'] = null;
  }

  // ---- durable facts ------------------------------------------------------
  if (facts.durableFacts.length > 0) {
    lines.push('## What we already know about them', '');
    lines.push('Recorded from earlier conversations and from the CRM. Treat it as what we believe, not as gospel:');
    lines.push(
      'if something here turns out to be wrong or out of date, the person in front of you is the authority.',
      '',
    );
    for (const entry of facts.durableFacts) {
      lines.push(`- ${entry.fact} (${originLabel(entry.origin)})`);
    }
    lines.push('');
  }
  disclosed['durableFacts'] = facts.durableFacts.map((entry) => ({ fact: entry.fact }));
  metadata['durableFacts'] = facts.durableFacts.map((entry) => ({ id: entry.id, origin: entry.origin }));

  // ---- commitments --------------------------------------------------------
  if (facts.commitments.length > 0) {
    lines.push('## What the system has already promised', '');
    lines.push(
      'These are saved records, not intentions. They will happen whether or not this call goes well, so',
      'contradicting one would make us look unreliable in a way the contact can verify:',
      '',
    );
    for (const commitment of facts.commitments) {
      const label = commitment.kind === 'MEETING' ? 'Meeting' : 'Callback';
      const title = commitment.title ? ` - ${commitment.title}` : '';
      lines.push(`- ${label}${title}, ${commitment.whenLocal} their time (${commitment.status}).`);
    }
    lines.push('');
  }
  disclosed['commitments'] = facts.commitments.map((commitment) => ({
    whenLocal: commitment.whenLocal,
    status: commitment.status,
    title: commitment.title,
  }));
  metadata['commitments'] = facts.commitments.map((commitment) => ({ kind: commitment.kind, id: commitment.id }));

  // ---- unresolved ---------------------------------------------------------
  if (facts.unresolved.length > 0) {
    lines.push('## Loose ends', '');
    lines.push(
      'Subjects that came up and were never settled. This is a set, not a queue: it has no order and it is',
      'not a list to work through. Pick one up if the conversation goes near it, and let the rest lie.',
      '',
    );
    for (const entry of facts.unresolved) {
      const who =
        entry.raisedBy === 'CONTACT'
          ? 'they raised it and we never came back to it'
          : 'we raised it and they never came back to it';
      // Whether it is from today or from a previous call changes how it can be
      // brought up, so the model is told which.
      const when = entry.source === 'REMEMBERED_EARLIER' ? ', from an earlier conversation' : '';
      lines.push(`- ${entry.topic} (${who}${when})`);
    }
    lines.push('');
  }
  disclosed['unresolved'] = facts.unresolved.map((entry) => ({ topic: entry.topic }));
  metadata['unresolved'] = facts.unresolved.map((entry) => ({
    id: entry.id,
    raisedBy: entry.raisedBy,
    source: entry.source,
  }));

  // ---- qualification ------------------------------------------------------
  if (facts.qualification) {
    const q = facts.qualification;
    lines.push('## Where their qualification stands', '');
    lines.push(`Band ${q.band}, ${q.score} out of 100 (rubric ${q.rubricVersion}).`);
    if (q.capApplied) {
      lines.push(
        `The rubric produced ${q.rawScore} and policy capped it to ${q.cappedScore}, because our record does ` +
          'not have this person as the one who signs.',
      );
    }
    if (q.evidenced.length > 0) lines.push(`Evidenced so far: ${q.evidenced.join(', ')}.`);
    if (q.unevidenced.length > 0) lines.push(`Nothing recorded yet for: ${q.unevidenced.join(', ')}.`);
    lines.push('');
    disclosed['qualification'] = {
      band: q.band,
      score: q.score,
      rubricVersion: q.rubricVersion,
      // Rendered only when the cap actually bit, so disclosed only then.
      rawScore: q.capApplied ? q.rawScore : null,
      cappedScore: q.capApplied ? q.cappedScore : null,
      evidenced: [...q.evidenced],
      unevidenced: [...q.unevidenced],
    };
    metadata['qualification'] = {
      capApplied: q.capApplied,
      rawScore: q.rawScore,
      cappedScore: q.cappedScore,
    };
  } else {
    lines.push('## Where their qualification stands', '', 'Nothing has been recorded for them yet.', '');
    disclosed['qualification'] = null;
    metadata['qualification'] = null;
  }

  // ---- open unknowns ------------------------------------------------------
  if (facts.openKnowledgeGoals.length > 0) {
    lines.push('## What we still do not know', '');
    lines.push(
      'Gaps in what we have recorded, listed alphabetically because alphabetical is not a priority order and',
      'must not be read as one. There is no sequence to follow here and no box to tick.',
      'A gap closes when the contact volunteers something, and a natural conversation closes several at once',
      'without any of them being asked about directly. Leaving every one of them open is an acceptable outcome',
      'for a single call.',
      '',
    );
    for (const goal of facts.openKnowledgeGoals) {
      // The rationale is the first thing the budget ladder takes off a goal, so
      // it is rendered only when it survived.
      lines.push(goal.whyItMatters ? `- ${goal.whatWeWantToKnow} Why it matters: ${goal.whyItMatters}` : `- ${goal.whatWeWantToKnow}`);
    }
    lines.push('');
  }
  disclosed['openKnowledgeGoals'] = facts.openKnowledgeGoals.map((goal) => ({
    whatWeWantToKnow: goal.whatWeWantToKnow,
    // Dropped by the budget ladder before the goals themselves are, so it is
    // disclosed only when it was rendered.
    whyItMatters: goal.whyItMatters || null,
  }));
  metadata['openKnowledgeGoals'] = facts.openKnowledgeGoals.map((goal) => ({ id: goal.id }));

  // ---- the business -------------------------------------------------------
  if (facts.business) {
    lines.push(...renderBusiness(facts.business));
    disclosed['business'] = { companyName: facts.business.companyName };
    metadata['business'] = { profileRef: facts.business.profileRef };
  } else {
    disclosed['business'] = null;
    metadata['business'] = null;
  }

  // ---- the objective, last, because last is what gets attended to ---------
  if (facts.business) {
    lines.push('## What this conversation is for', '');
    lines.push(facts.business.objectivePrimary);
    for (const supporting of facts.business.objectiveSupporting) lines.push(`- ${supporting}`);
    if (facts.business.acceptableOutcomes.length > 0) {
      lines.push('', 'Outcomes that count as a good call:');
      for (const outcome of facts.business.acceptableOutcomes) lines.push(`- ${outcome}`);
    }
    lines.push(
      '',
      'That is the destination, not the route. The route is whatever this particular person needs it to be,',
      'and a call that reaches none of it while leaving them better disposed to us was still worth making.',
      '',
    );
    (disclosed['business'] as Record<string, unknown>)['objectivePrimary'] = facts.business.objectivePrimary;
  }

  metadata['transcript'] = { ...facts.transcript };
  metadata['nowUtc'] = facts.nowUtc;

  // The transcript note goes last so the model reads the window it is about to
  // be handed. Omitted entirely when nothing was dropped - telling a model that
  // nothing is missing is noise on every short conversation, which is most.
  if (facts.transcript.droppedTurnCount > 0) {
    lines.push(
      `Note on the transcript that follows: it holds the most recent ${facts.transcript.includedTurnCount} of ` +
        `${facts.transcript.totalTurnCount} exchanges. The ${facts.transcript.droppedTurnCount} older ones are ` +
        'covered by the recap above rather than shown in full.',
      '',
    );
  }

  return {
    text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    disclosed,
    disclosureMetadata: metadata,
  };
}

// ---------------------------------------------------------------------------

function renderBusiness(business: BusinessFactsView): string[] {
  const lines: string[] = [];

  lines.push('## Who you work for', '');
  lines.push(`You are ${business.personaName}. ${business.personaRole}`);
  lines.push(business.whatWeAre ? `${business.companyName}: ${business.whatWeAre}` : business.companyName);
  // Guarded, because the budget ladder empties these one at a time and a
  // heading with nothing under it costs a small model attention for no return.
  if (business.whatWeDo) lines.push(business.whatWeDo);
  if (business.voiceTraits.length > 0) {
    lines.push('', 'How you come across:');
    for (const trait of business.voiceTraits) lines.push(`- ${trait}`);
  }
  if (business.mustDisclose.length > 0) {
    lines.push('', 'Things a contact is entitled to hear:');
    for (const entry of business.mustDisclose) lines.push(`- ${entry}`);
  }
  if (business.outOfScope.length > 0) {
    lines.push('', 'Not yours to handle:');
    for (const entry of business.outOfScope) lines.push(`- ${entry}`);
  }
  if (business.proofPoints.length > 0) {
    lines.push('', 'True things about the company, if they are relevant:');
    for (const entry of business.proofPoints) lines.push(`- ${entry}`);
  }
  for (const entry of business.operatingRegions) lines.push(`- ${entry}`);
  lines.push('');

  if (business.products.length > 0) lines.push('## What we sell', '');
  for (const product of business.products) {
    lines.push(`### ${product.name}`, '');
    lines.push(product.summary);
    lines.push(`Best suited to: ${product.bestFor}`);
    if (product.capabilities.length > 0) {
      lines.push('It does:');
      for (const entry of product.capabilities) lines.push(`- ${entry}`);
    }
    if (product.limitations.length > 0) {
      lines.push('It does NOT do - these are the facts most worth being straight about:');
      for (const entry of product.limitations) lines.push(`- ${entry}`);
    }
    if (product.integrations.length > 0) {
      lines.push('It connects to:');
      for (const entry of product.integrations) lines.push(`- ${entry}`);
    }
    lines.push('');
  }

  if (business.plans.length > 0) {
    lines.push('## What it costs', '');
    lines.push(`All figures in ${business.currency}. These are the real published numbers.`, '');
    for (const plan of business.plans) {
      lines.push(`### ${plan.name}: ${plan.headlinePrice} ${plan.billingPeriod}`, '');
      for (const entry of plan.includes) lines.push(`- ${entry}`);
      for (const entry of plan.notes) lines.push(`- ${entry}`);
      lines.push('');
    }
  }
  if (business.discountFacts.length > 0) {
    lines.push('On discounting:');
    for (const entry of business.discountFacts) lines.push(`- ${entry}`);
    lines.push('');
  }
  if (business.agentMayNotCommit.length > 0) {
    lines.push('## Beyond your authority', '');
    lines.push('Not an awkwardness to work around - a fact about what you are:');
    for (const entry of business.agentMayNotCommit) lines.push(`- ${entry}`);
    lines.push('');
  }

  if (business.policies.length > 0) {
    lines.push('## Policy, as it actually stands', '');
    for (const policy of business.policies) lines.push(`- ${policy.topic}: ${policy.fact}`);
    lines.push('');
  }

  if (business.topics.length > 0) {
    lines.push('## Subjects that tend to come up, and what is true about them', '');
    lines.push(
      'Facts only. There is no prepared answer here and there is not meant to be - build one from the facts,',
      'for the person actually in front of you, at the length they asked for.',
      '',
    );
    for (const topic of business.topics) {
      lines.push(`${topic.topic}:`);
      for (const fact of topic.facts) lines.push(`- ${fact}`);
      lines.push('');
    }
  }

  if (business.meetingTypes.length > 0) {
    lines.push('## The meetings you can get into the diary', '');
    for (const meeting of business.meetingTypes) {
      lines.push(`- ${meeting.name}, ${meeting.durationMinutes} minutes. ${meeting.whatHappens} ${meeting.whoAttends}`);
    }
    lines.push('');
  }

  return lines;
}

function originLabel(origin: DurableFactOrigin): string {
  switch (origin) {
    case 'THIS_CONVERSATION':
      return 'learned in this conversation';
    case 'EARLIER_CONVERSATION':
      return 'learned in an earlier conversation';
    case 'CRM_RECORD':
      return 'from their CRM record';
    default: {
      const exhaustive: never = origin;
      return String(exhaustive);
    }
  }
}
