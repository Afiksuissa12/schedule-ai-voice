/**
 * `ConversationContextAssembler` - the one place that decides what the model is
 * told, and reads every bit of it from the database.
 *
 * THE PROPERTY THAT MATTERS MOST
 * ---------------------------------------------------------------------------
 * This class holds no state between calls. `assemble` is a function of (the
 * rows in the database, the injected `Clock`, the injected business profile),
 * and of nothing else. Two consequences, both proved by `npm run context:prove`
 * rather than asserted here:
 *
 *  - Given a fixed database and a `FixedClock`, two runs produce BYTE-IDENTICAL
 *    context. An audit replay is therefore a real replay.
 *  - A conversation resumes identically in a different process, because
 *    `ConversationService`'s "no conversation state in memory, none" rule
 *    extends to everything the model is told, not just to the transcript.
 *
 * It also reaches no network - it cannot, and that is enforced rather than
 * intended: `tests/invariants/vendorBoundary.test.ts` forbids `fetch`, an HTTP
 * client or a vendor SDK anywhere under `src/conversation`.
 *
 * WHERE THE ROLLING SUMMARY IS AND IS NOT
 * ---------------------------------------------------------------------------
 * Reading it is here. WRITING it is not: that lives in
 * `ConversationMemoryWriter`, which is the only part of this subsystem that
 * talks to a model, is optional, and runs after a turn has already finished.
 *
 * That split is what makes determinism cheap. If a turn generated its own
 * summary on the way in, the context would depend on a model's output and
 * "byte-identical across two runs" would be untestable. Instead the summary is
 * an input read from a column, exactly like every other fact here.
 *
 * WHY THERE IS NO VECTOR STORE
 * ---------------------------------------------------------------------------
 * Because the retrieval problem this scope has is not the problem embeddings
 * solve. The corpus is one contact's own history - tens of turns, not millions
 * of documents - and the right subset is selected by RECENCY and by STRUCTURE
 * (this contact, this conversation, the previous outcome, the open promises),
 * both of which are indexed database queries that return the exact right rows.
 * The full argument, with the numbers, is in `CONVERSATION_CONTEXT.md`
 * § "Why there is no vector store", including the specific signal that would
 * change the answer.
 */
import { DateTime } from 'luxon';

import type { BusinessProfile } from '../context/businessProfile.js';
import type { Database } from '../db/database.js';
import type {
  Contact,
  Conversation,
  ConversationTurn,
  QualificationState,
} from '../domain/entities.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import { NotFoundError } from '../shared/errors.js';
import { tryParseJson } from '../shared/json.js';
import {
  renderContext,
  type BusinessFactsView,
  type CommitmentFacts,
  type ContextFacts,
  type DurableFactView,
  type OpenKnowledgeGoal,
  type PreviousConversationFacts,
  type QualificationFacts,
  type RenderedContext,
  type UnresolvedTopicView,
} from './contextAssembly.js';
import { readConversationMemory, type ConversationMemory } from './conversationMemory.js';
import {
  planContextBudget,
  selectRecentTurns,
  type ContextBudgetConfig,
  type ContextBudgetReport,
  type TurnWindow,
} from './contextWindow.js';

/** How many earlier conversations are mined for durable facts. */
const PREVIOUS_CONVERSATIONS_SCANNED = 6;
/** Caps on what the database is allowed to contribute, before the budget ladder. */
const MAX_DURABLE_FACTS = 10;
const MAX_UNRESOLVED = 8;
const MAX_COMMITMENTS = 6;

export interface ContextAssemblerOptions {
  readonly db: Database;
  readonly clock: Clock;
  /**
   * The business/product/persona facts.
   *
   * Optional, and `null` is a supported configuration rather than a broken one:
   * an agent with no business profile still gets contact facts, memory,
   * continuity and commitments. It simply has nothing to say about pricing,
   * which is a great deal better than having something wrong to say about it.
   */
  readonly businessProfile?: BusinessProfile | null;
  readonly budget?: Partial<ContextBudgetConfig>;
}

export interface AssembleContextInput {
  readonly conversationId: string;
  /**
   * Characters the turn already spends before any of this: the rendered system
   * prompt plus the serialized tool schemas.
   *
   * Measured by the caller, which has both in hand at that moment. Zero is
   * legal and simply produces a more generous budget.
   */
  readonly fixedOverheadChars?: number;
}

export interface AssembledContext {
  /** Bumped if the shape changes. Consumers (the benchmark) can branch on it. */
  readonly version: 1;
  readonly conversationId: string;
  readonly contactId: string;
  readonly nowUtc: IsoUtcString;
  readonly facts: ContextFacts;
  /** The turns that go into the message array, and what was left out. */
  readonly window: TurnWindow;
  readonly budget: ContextBudgetReport;
  readonly rendered: RenderedContext;
  /**
   * Budget-ladder steps that had to be applied, in order, to fit.
   *
   * Empty means everything fitted. Non-empty is not a failure - it is the
   * system telling you which facts a 7B context window could not afford today,
   * which is exactly the sort of thing that is invisible until it matters.
   */
  readonly reductionsApplied: readonly string[];
  /** True only if the ladder ran out and the text had to be cut. */
  readonly hardTruncated: boolean;
}

export class ConversationContextAssembler {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly businessProfile: BusinessProfile | null;
  private readonly budgetConfig: Partial<ContextBudgetConfig>;

  constructor(options: ContextAssemblerOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.businessProfile = options.businessProfile ?? null;
    this.budgetConfig = options.budget ?? {};
  }

  async assemble(input: AssembleContextInput): Promise<AssembledContext> {
    const nowUtc = this.clock.nowUtc();

    const conversation = await this.db.conversations.findById(input.conversationId);
    if (!conversation) throw new NotFoundError('Conversation', input.conversationId);
    const contact = await this.db.contacts.requireById(conversation.contactId);

    const budget = planContextBudget({
      config: this.budgetConfig,
      fixedOverheadChars: input.fixedOverheadChars ?? 0,
    });

    // Every read is a fresh query. None of it is cached between turns: a tool
    // that ran moments ago may have changed any of it.
    const [turns, qualification, leads, meetings, futureActions, previousConversations] = await Promise.all([
      this.db.conversationTurns.listByConversation(conversation.id),
      this.db.qualificationStates.findByContactId(contact.id),
      this.db.leads.listByContact(contact.id, { take: 1 }),
      this.db.meetings.listByContact(contact.id, { take: 10 }),
      this.db.futureActions.listByContact(contact.id, { take: 10 }),
      this.db.conversations.listByContact(contact.id, { take: PREVIOUS_CONVERSATIONS_SCANNED + 1 }),
    ]);

    const memory = readConversationMemory(conversation.summary);
    const window = selectRecentTurns(turns, {
      maxTurns: budget.config.maxRecentTurns,
      maxChars: budget.transcriptBudgetChars,
    });

    const earlier = previousConversations.filter((row) => row.id !== conversation.id);
    const previousMemories = earlier.map((row) => ({ conversation: row, memory: readConversationMemory(row.summary) }));

    const facts: ContextFacts = {
      contact: {
        id: contact.id,
        displayName: contact.fullName,
        timezone: contact.timezone,
        localNow: describeLocal(nowUtc, contact.timezone),
        isDecisionMaker: contact.isDecisionMaker,
        crmNote: contact.notes,
        lead: leads[0] ? { source: leads[0].source, status: leads[0].status } : null,
      },
      qualification: qualificationFacts(qualification),
      runningSummary: memory.narrative
        ? {
            narrative: memory.narrative,
            coversThroughTurnIndex: memory.coveredThroughTurnIndex,
            source: memory.source,
          }
        : null,
      durableFacts: durableFacts(contact, memory, previousMemories),
      previousConversation: await this.previousConversationFacts(previousMemories, contact),
      unresolved: unresolvedTopics(memory, turns, previousMemories),
      commitments: commitments(meetings, futureActions, contact.timezone, nowUtc),
      openKnowledgeGoals: openKnowledgeGoals(this.businessProfile, qualification),
      business: businessFacts(this.businessProfile),
      transcript: {
        totalTurnCount: window.totalTurnCount,
        includedTurnCount: window.includedTurnCount,
        droppedTurnCount: window.droppedTurnCount,
        droppedThroughIndex: window.droppedThroughIndex,
        charCount: window.charCount,
        budgetChars: window.budgetChars,
        limitedBy: window.limitedBy,
      },
      nowUtc,
    };

    const fitted = fitToBudget(facts, budget.factsBudgetChars);

    return {
      version: 1,
      conversationId: conversation.id,
      contactId: contact.id,
      nowUtc,
      facts: fitted.facts,
      window,
      budget,
      rendered: fitted.rendered,
      reductionsApplied: fitted.reductionsApplied,
      hardTruncated: fitted.hardTruncated,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The previous conversation's outcome, so a returning contact is not greeted
   * as a stranger.
   *
   * "Previous" means the most recent conversation for this contact other than
   * this one. It does NOT have to be COMPLETED: a conversation that was
   * abandoned mid-sentence is often the most important thing to remember, and a
   * filter on status would hide exactly that case.
   */
  private async previousConversationFacts(
    previous: readonly { conversation: Conversation; memory: ConversationMemory }[],
    contact: Contact,
  ): Promise<PreviousConversationFacts | null> {
    const latest = previous[0];
    if (!latest) return null;

    // `Call` -> `CallOutcome` is the durable record of how the last attempt
    // actually went, and it is a different fact from how the conversation
    // ended: a conversation can be COMPLETED off the back of a voicemail.
    const calls = await this.db.calls.listByConversation(latest.conversation.id, { take: 5 });
    let callOutcome: string | null = null;
    let callOutcomeNotes: string | null = null;
    for (const call of calls) {
      const outcome = await this.db.callOutcomes.findByCallId(call.id);
      if (outcome) {
        callOutcome = outcome.outcome;
        callOutcomeNotes = outcome.notes;
        break;
      }
    }

    return {
      conversationId: latest.conversation.id,
      status: latest.conversation.status,
      startedLocal: describeLocal(latest.conversation.startedAt, contact.timezone),
      endedLocal: latest.conversation.endedAt ? describeLocal(latest.conversation.endedAt, contact.timezone) : null,
      callOutcome,
      callOutcomeNotes,
      narrative: latest.memory.narrative || null,
    };
  }
}

// ---------------------------------------------------------------------------
// Fact derivation. Pure functions, exported so a CLI can exercise them alone.
// ---------------------------------------------------------------------------

/** "Thursday 5 March 2026 at 15:00" in the contact's own zone. */
export function describeLocal(instantUtc: string, timezone: string): string {
  return DateTime.fromMillis(Date.parse(instantUtc), { zone: timezone }).toFormat("cccc d LLLL yyyy 'at' HH:mm");
}

export function qualificationFacts(state: QualificationState | null): QualificationFacts | null {
  if (!state) return null;

  // `factorsJson` is written by `update_qualification` and is a document we
  // wrote, but it is still parsed defensively: a row from an older rubric
  // version, or one hand-edited during an incident, must degrade to "we have a
  // score and no factor detail" rather than take the turn down with it.
  const evidenced: string[] = [];
  const unevidenced: string[] = [];
  const parsed = tryParseJson<{ factors?: { name?: unknown; unobserved?: unknown; evidence?: unknown }[] }>(
    state.factorsJson,
  );
  if (parsed.ok && Array.isArray(parsed.value?.factors)) {
    for (const factor of parsed.value.factors) {
      if (typeof factor?.name !== 'string') continue;
      const hasEvidence = factor.unobserved !== true && typeof factor.evidence === 'string' && factor.evidence.length > 0;
      (hasEvidence ? evidenced : unevidenced).push(factor.name);
    }
  }

  return {
    band: state.band,
    score: state.score,
    rawScore: state.rawScore,
    cappedScore: state.cappedScore,
    capApplied: state.rawScore > state.cappedScore,
    rubricVersion: state.rubricVersion,
    evidenced,
    unevidenced,
  };
}

/**
 * What we durably believe about this person.
 *
 * Three origins, merged and labelled, most-trusted last so that a later entry
 * with the same id wins: remembered facts from earlier conversations, then
 * remembered facts from this one, then the CRM note a human wrote. The label
 * travels with the fact into the prompt, because "we think we heard this three
 * months ago" and "a colleague typed this into the record" deserve different
 * amounts of confidence and only the model can weigh that in the moment.
 */
export function durableFacts(
  contact: Contact,
  thisMemory: ConversationMemory,
  previous: readonly { conversation: Conversation; memory: ConversationMemory }[],
): DurableFactView[] {
  const byId = new Map<string, DurableFactView>();

  for (const entry of previous) {
    for (const fact of entry.memory.durableFacts) {
      byId.set(fact.id, { id: fact.id, fact: fact.fact, origin: 'EARLIER_CONVERSATION' });
    }
  }
  for (const fact of thisMemory.durableFacts) {
    byId.set(fact.id, { id: fact.id, fact: fact.fact, origin: 'THIS_CONVERSATION' });
  }
  if (contact.notes?.trim()) {
    byId.set('crm_note', { id: 'crm_note', fact: contact.notes.trim(), origin: 'CRM_RECORD' });
  }

  // Stable order for byte-determinism. By id, which is not a ranking.
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_DURABLE_FACTS);
}

/**
 * Loose ends, from two independent sources.
 *
 * REMEMBERED entries come from the rolling summary - a model noticed, when it
 * wrote the recap, that something was raised and never settled.
 *
 * FAILED_TOOL_CALL entries need no model at all. A tool call that came back
 * refused, with no later call of the same tool in the same conversation that
 * succeeded, is an outstanding thing by construction: we tried to do something
 * for this person and it did not happen. Surfacing it is how the agent stops
 * cheerfully moving on from a booking that was rejected thirty seconds ago.
 *
 * Note what this is NOT: it is not ordered, not prioritised and not a queue.
 * The prompt says as much in words, and the sort below is alphabetical by id
 * for determinism, which is deliberately not a ranking.
 */
export function unresolvedTopics(
  memory: ConversationMemory,
  turns: readonly ConversationTurn[],
  previous: readonly { conversation: Conversation; memory: ConversationMemory }[] = [],
): UnresolvedTopicView[] {
  // Earlier conversations first, so a loose end this conversation has already
  // re-recorded overwrites the older entry rather than appearing twice. A
  // question the contact asked three months ago and never got an answer to is
  // still an open question, and forgetting it between sessions is precisely
  // the amnesia this mission exists to remove.
  const entries: UnresolvedTopicView[] = [];
  for (const entry of previous) {
    for (const topic of entry.memory.unresolvedTopics) {
      entries.push({ id: topic.id, topic: topic.topic, raisedBy: topic.raisedBy, source: 'REMEMBERED_EARLIER' });
    }
  }
  for (const topic of memory.unresolvedTopics) {
    entries.push({ id: topic.id, topic: topic.topic, raisedBy: topic.raisedBy, source: 'REMEMBERED' });
  }

  const failedByTool = new Map<string, string>();
  const succeededTools = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== 'TOOL' || !turn.toolName || !turn.rawPayloadJson) continue;
    const payload = tryParseJson<{ ok?: unknown; reason?: unknown }>(turn.rawPayloadJson);
    if (!payload.ok) continue;
    if (payload.value?.ok === true) {
      succeededTools.add(turn.toolName);
      failedByTool.delete(turn.toolName);
      continue;
    }
    if (payload.value?.ok === false && !succeededTools.has(turn.toolName)) {
      failedByTool.set(turn.toolName, typeof payload.value.reason === 'string' ? payload.value.reason : '');
    }
  }

  for (const [toolName, reason] of failedByTool) {
    entries.push({
      id: `failed_${toolName}`,
      // Describes the state of the world, not a sentence to deliver. What the
      // contact hears about it is the model's to write.
      topic: `Something we tried to arrange did not go through${reason ? `: ${trimTo(reason, 140)}` : ''}`,
      raisedBy: 'AGENT',
      source: 'FAILED_TOOL_CALL',
    });
  }

  const byId = new Map<string, UnresolvedTopicView>();
  for (const entry of entries) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_UNRESOLVED);
}

/**
 * Promises the SYSTEM has already persisted.
 *
 * A `FutureAction` that is due and has not run yet still counts, even though
 * its time has passed - the promise was made, the row exists, and the runner
 * will get to it. Filtering those out would let the agent contradict a callback
 * that is about to happen, which is precisely the failure this section exists
 * to prevent.
 */
export function commitments(
  meetings: readonly { id: string; status: string; startUtc: IsoUtcString; timezone: string; title: string }[],
  futureActions: readonly { id: string; status: string; scheduledForUtc: IsoUtcString; timezone: string; type: string }[],
  contactTimezone: string,
  nowUtc: IsoUtcString,
): CommitmentFacts[] {
  const now = Date.parse(nowUtc);
  const out: CommitmentFacts[] = [];

  for (const meeting of meetings) {
    if (meeting.status !== 'SCHEDULED' && meeting.status !== 'RESCHEDULED') continue;
    if (Date.parse(meeting.startUtc) < now) continue;
    out.push({
      kind: 'MEETING',
      id: meeting.id,
      whenLocal: describeLocal(meeting.startUtc, meeting.timezone || contactTimezone),
      status: meeting.status,
      title: meeting.title,
    });
  }

  for (const action of futureActions) {
    if (action.status !== 'PENDING' && action.status !== 'CLAIMED') continue;
    out.push({
      kind: 'CALLBACK',
      id: action.id,
      whenLocal: describeLocal(action.scheduledForUtc, action.timezone || contactTimezone),
      status: action.status,
      title: null,
    });
  }

  return out.sort((a, b) => a.whenLocal.localeCompare(b.whenLocal) || a.id.localeCompare(b.id)).slice(0, MAX_COMMITMENTS);
}

/**
 * What we still do not know, from the profile's knowledge goals.
 *
 * A goal is CLOSED when it names a rubric factor and the persisted
 * `QualificationState` has evidence for that factor. Note where the truth comes
 * from: the persisted row, written by `update_qualification` after the rubric
 * recomputed it - not from the model's opinion that it has covered something.
 *
 * Sorted by the text the model will actually read, so the prompt's claim that
 * the list is alphabetical is true rather than approximately true.
 */
export function openKnowledgeGoals(
  profile: BusinessProfile | null,
  qualification: QualificationState | null,
): OpenKnowledgeGoal[] {
  if (!profile) return [];

  const evidenced = new Set(qualificationFacts(qualification)?.evidenced ?? []);

  return profile.objectives.knowledgeGoals
    .filter((goal) => !(goal.rubricFactor && evidenced.has(goal.rubricFactor)))
    .map((goal) => ({ id: goal.id, whatWeWantToKnow: goal.whatWeWantToKnow, whyItMatters: goal.whyItMatters }))
    .sort((a, b) => a.whatWeWantToKnow.localeCompare(b.whatWeWantToKnow));
}

export function businessFacts(profile: BusinessProfile | null): BusinessFactsView | null {
  if (!profile) return null;
  return {
    profileRef: profile.profileRef,
    companyName: profile.company.name,
    whatWeAre: profile.company.whatWeAre,
    whatWeDo: profile.company.whatWeDo,
    proofPoints: profile.company.proofPoints,
    operatingRegions: profile.company.operatingRegions,
    personaName: profile.persona.agentName,
    personaRole: profile.persona.role,
    voiceTraits: profile.persona.voiceTraits,
    mustDisclose: profile.persona.mustDisclose,
    outOfScope: profile.persona.outOfScope,
    products: profile.products.map((product) => ({
      name: product.name,
      summary: product.summary,
      bestFor: product.bestFor,
      capabilities: product.capabilities,
      limitations: product.limitations,
      integrations: product.integrations,
    })),
    currency: profile.pricing.currency,
    plans: profile.pricing.plans.map((plan) => ({
      name: plan.name,
      headlinePrice: plan.headlinePrice,
      billingPeriod: plan.billingPeriod,
      includes: plan.includes,
      notes: plan.notes,
    })),
    discountFacts: profile.pricing.discountFacts,
    agentMayNotCommit: profile.pricing.agentMayNotCommit,
    policies: profile.policies.map((policy) => ({ topic: policy.topic, fact: policy.fact })),
    topics: profile.topics.map((topic) => ({ topic: topic.topic, facts: topic.facts })),
    meetingTypes: profile.meetingTypes.map((type) => ({
      name: type.name,
      durationMinutes: type.durationMinutes,
      whatHappens: type.whatHappens,
      whoAttends: type.whoAttends,
    })),
    objectivePrimary: profile.objectives.primary,
    objectiveSupporting: profile.objectives.supporting,
    acceptableOutcomes: profile.objectives.acceptableOutcomes,
  };
}

// ---------------------------------------------------------------------------
// The budget ladder
// ---------------------------------------------------------------------------

/**
 * Named reductions, applied in order until the rendered facts fit.
 *
 * THE ORDER IS A PRODUCT DECISION, WRITTEN DOWN AS CODE
 * ---------------------------------------------------------------------------
 * This is the one place in this subsystem where somebody has ranked what
 * matters, so it is worth reading top to bottom. The marketing surface goes
 * first. Then the depth of the product detail, then the policy list - which
 * survives longer than the marketing does because it answers questions people
 * actually ask, and which stays reachable through `get_contact_context` even
 * after it leaves the window. Then pricing, in three separate rungs so the
 * discount policy can go without taking the actual numbers with it. Then the
 * business profile down to its identity and its objective. Then - and only
 * then - the memory of this particular person. Last of all, the list of things
 * the agent has no authority to promise.
 *
 * Continuity is nearly the last thing sacrificed because continuity is what
 * this mission is for. Authority is the very last because it is the only entry
 * that stops a promise rather than improving one.
 *
 * A cheaper implementation would trim whichever section is longest. On a rich
 * profile that means discarding the fact that we spoke to this person three
 * weeks ago in order to keep a list of integrations, and nobody would notice
 * until a customer did.
 */
const REDUCTIONS: readonly { readonly name: string; readonly apply: (facts: ContextFacts) => ContextFacts }[] = [
  // --- marketing surface: the first things a real salesperson would drop ---
  { name: 'drop-topic-facts', apply: (f) => withBusiness(f, (b) => ({ ...b, topics: [] })) },
  { name: 'drop-proof-points', apply: (f) => withBusiness(f, (b) => ({ ...b, proofPoints: [], operatingRegions: [] })) },
  { name: 'drop-meeting-types', apply: (f) => withBusiness(f, (b) => ({ ...b, meetingTypes: [] })) },

  // --- depth of product detail, before its existence ----------------------
  {
    name: 'trim-product-detail',
    apply: (f) =>
      withBusiness(f, (b) => ({
        ...b,
        products: b.products.map((product) => ({
          ...product,
          capabilities: product.capabilities.slice(0, 3),
          integrations: product.integrations.slice(0, 2),
          // Limitations are trimmed LAST and least. What a product does not do
          // is the fact most likely to stop a promise nobody can keep.
          limitations: product.limitations.slice(0, 4),
        })),
      })),
  },
  {
    // The rationale on a knowledge goal is genuinely useful to a small model -
    // it is what stops "budget" reading as an interrogation - but it costs
    // roughly as much as the goals themselves, so it goes before they do.
    name: 'drop-knowledge-goal-rationale',
    apply: (f) => ({ ...f, openKnowledgeGoals: f.openKnowledgeGoals.map((goal) => ({ ...goal, whyItMatters: '' })) }),
  },
  {
    // Policy facts - the trial, the contract term, how a migration actually
    // goes - answer questions contacts really ask, so they outlast the softer
    // parts of the profile. They also remain reachable through
    // get_contact_context after they are dropped from the window, which is the
    // reason that tool carries a business digest at all.
    name: 'drop-policies',
    apply: (f) => withBusiness(f, (b) => ({ ...b, policies: [] })),
  },
  {
    name: 'trim-plan-detail',
    apply: (f) =>
      withBusiness(f, (b) => ({
        ...b,
        plans: b.plans.map((plan) => ({ ...plan, includes: plan.includes.slice(0, 2), notes: [] })),
      })),
  },
  { name: 'drop-persona-detail', apply: (f) => withBusiness(f, (b) => ({ ...b, voiceTraits: b.voiceTraits.slice(0, 2), outOfScope: [] })) },
  { name: 'trim-products-to-one', apply: (f) => withBusiness(f, (b) => ({ ...b, products: b.products.slice(0, 1) })) },
  {
    // The supporting objectives and the list of acceptable outcomes are the
    // soft end of the profile: useful framing, but a call does not go wrong for
    // want of them the way it goes wrong for want of a price.
    name: 'trim-objective-detail',
    apply: (f) =>
      withBusiness(f, (b) => ({ ...b, objectiveSupporting: b.objectiveSupporting.slice(0, 1), acceptableOutcomes: b.acceptableOutcomes.slice(0, 2) })),
  },

  // --- pricing, finely, because the NUMBER is the last thing to lose ------
  // Three rungs rather than one. A contact who has just asked what it costs and
  // gets "I would have to check" because 300 characters of discount policy
  // pushed the price list out of the window is the failure this granularity
  // exists to avoid. Discount policy goes first, then the longer tail of plans,
  // and only then the prices themselves.
  { name: 'drop-discount-facts', apply: (f) => withBusiness(f, (b) => ({ ...b, discountFacts: [] })) },
  { name: 'trim-plans-to-two', apply: (f) => withBusiness(f, (b) => ({ ...b, plans: b.plans.slice(0, 2) })) },
  { name: 'drop-pricing-detail', apply: (f) => withBusiness(f, (b) => ({ ...b, plans: [] })) },

  {
    name: 'drop-business-except-identity-and-objective',
    apply: (f) =>
      withBusiness(f, (b) => ({
        ...b,
        whatWeDo: '',
        products: [],
        plans: [],
        discountFacts: [],
        policies: [],
        topics: [],
        meetingTypes: [],
        proofPoints: [],
        operatingRegions: [],
        voiceTraits: b.voiceTraits.slice(0, 1),
        mustDisclose: b.mustDisclose.slice(0, 1),
        outOfScope: [],
        objectiveSupporting: [],
        acceptableOutcomes: [],
      })),
  },

  // --- only now the memory of this particular person ----------------------
  { name: 'trim-knowledge-goals', apply: (f) => ({ ...f, openKnowledgeGoals: f.openKnowledgeGoals.slice(0, 3) }) },
  { name: 'trim-unresolved', apply: (f) => ({ ...f, unresolved: f.unresolved.slice(0, 3) }) },
  { name: 'trim-durable-facts', apply: (f) => ({ ...f, durableFacts: f.durableFacts.slice(0, 5) }) },
  {
    name: 'trim-narrative',
    apply: (f) =>
      f.runningSummary ? { ...f, runningSummary: { ...f.runningSummary, narrative: trimTo(f.runningSummary.narrative, 500) } } : f,
  },
  {
    name: 'trim-memory-hard',
    apply: (f) => ({
      ...f,
      durableFacts: f.durableFacts.slice(0, 3),
      unresolved: f.unresolved.slice(0, 2),
      ...(f.runningSummary ? { runningSummary: { ...f.runningSummary, narrative: trimTo(f.runningSummary.narrative, 240) } } : {}),
    }),
  },
  { name: 'drop-knowledge-goals', apply: (f) => ({ ...f, openKnowledgeGoals: [] }) },
  {
    // The authority list goes LAST of everything, because it is the only part
    // of the profile that stops the agent promising something. Every other
    // business fact makes the conversation better; this one makes it safe.
    //
    // What remains after this rung is the irreducible core: the frame, who this
    // is, their clock, the time discipline, whatever memory survived, and the
    // objective. `npm run context:render --sizes` prints its measured length,
    // and `ContextBudgetConfig.minFactsChars` is set above it.
    name: 'drop-authority-list',
    apply: (f) => withBusiness(f, (b) => ({ ...b, agentMayNotCommit: [] })),
  },
];

interface FittedContext {
  readonly facts: ContextFacts;
  readonly rendered: RenderedContext;
  readonly reductionsApplied: readonly string[];
  readonly hardTruncated: boolean;
}

/**
 * Render, measure, reduce, repeat.
 *
 * The loop is bounded by the ladder's own length, so it terminates whatever the
 * budget is. If the ladder runs out and the text is still too long, the text is
 * cut and `hardTruncated` says so out loud rather than a caller discovering it
 * from a truncated sentence in a transcript.
 */
export function fitToBudget(facts: ContextFacts, budgetChars: number): FittedContext {
  let current = facts;
  let rendered = renderContext(current);
  const applied: string[] = [];

  for (const reduction of REDUCTIONS) {
    if (rendered.text.length <= budgetChars) break;
    current = reduction.apply(current);
    rendered = renderContext(current);
    applied.push(reduction.name);
  }

  if (rendered.text.length <= budgetChars) {
    return { facts: current, rendered, reductionsApplied: applied, hardTruncated: false };
  }

  // The backstop. Reaching it means the budget is smaller than the irreducible
  // core, which is a configuration problem, not a data problem - so it is
  // reported on the result rather than silently absorbed.
  return {
    facts: current,
    rendered: {
      text: `${rendered.text.slice(0, Math.max(0, budgetChars - 1))}…`,
      // The disclosure map is deliberately NOT patched to match the cut text.
      // It records what the assembler intended to tell the model; the
      // `hardTruncated` flag on the result, and this marker, record that some
      // of it did not survive. Silently pruning the record to match would make
      // a truncation look like a decision.
      disclosed: rendered.disclosed,
      disclosureMetadata: { ...rendered.disclosureMetadata, hardTruncated: true },
    },
    reductionsApplied: applied,
    hardTruncated: true,
  };
}

// ---------------------------------------------------------------------------

function withBusiness(facts: ContextFacts, map: (business: BusinessFactsView) => BusinessFactsView): ContextFacts {
  return facts.business ? { ...facts, business: map(facts.business) } : facts;
}

function trimTo(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
