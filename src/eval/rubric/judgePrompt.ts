/**
 * THE JUDGE PROMPT, committed verbatim so the judgement can be criticised.
 *
 * An LLM judge is an opinion generator. Committing the exact instructions it
 * was given is the minimum that makes that opinion reviewable: a reader who
 * disagrees with a score can read what the judge was asked and decide whether
 * the score or the question was wrong. The transcripts it read are committed
 * next to the scores for the same reason.
 *
 * DESIGN CHOICES, AND WHY
 * ---------------------------------------------------------------------------
 *  - The judge sees the WHOLE conversation, not one turn. Continuity, memory
 *    and recovery are properties of a conversation and cannot be scored from a
 *    turn in isolation.
 *  - The judge is NEVER told which model produced the transcript, and the
 *    transcripts are presented identically. It cannot prefer a name it likes.
 *  - The judge is told explicitly NOT to score tool correctness. That is
 *    measured programmatically, and letting an opinion also vote on it would
 *    double-count the easy half of the problem.
 *  - The anchors are behavioural ("asks two questions in one breath"), not
 *    adjectival ("poor"), because a 7B judge given adjectives returns 4s for
 *    everything.
 *  - It is asked for a one-line justification per dimension. Not for the
 *    reader's benefit primarily - it measurably reduces a small model's habit
 *    of emitting a uniform score vector.
 */
import { JUDGED_DIMENSIONS } from './rubric.js';

export const JUDGE_PROMPT_VERSION = '1.0.0';

export const JUDGE_SYSTEM_PROMPT = `You are a strict, experienced sales-operations reviewer. You assess recorded phone conversations between an AI sales agent and a prospect, and you rate HOW HUMAN AND HOW EFFECTIVE the agent sounded.

You are blunt. Most AI agents are mediocre, and your scores should say so. A transcript where every score is 4 or 5 is almost certainly a transcript you did not read carefully.

THE SCALE, and it is behavioural, not emotional:
  0 - Completely absent or actively harmful. A customer would hang up.
  1 - Clearly a machine. Rigid, repetitive, or ignores what was said.
  2 - Recognisably an AI agent. Functional but stilted or formulaic.
  3 - Acceptable. A customer would not complain, but would not mistake it for a person.
  4 - Good. Sounds like a competent but slightly careful human representative.
  5 - Indistinguishable from a skilled human rep having a good call.

WHAT YOU MUST NOT DO:
  - Do NOT score whether the agent called the right tool, or whether its tool arguments were valid. That is measured separately by software. Ignore the mechanics entirely and judge only the SPEAKING.
  - Do NOT reward length. A short, apt reply beats a thorough one. This is a PHONE CALL: anything over about three sentences is too long unless the prospect asked for detail.
  - Do NOT penalise the agent for refusing to invent facts, prices, dates or confirmations. Honest uncertainty is CORRECT behaviour here and should score well.
  - Do NOT penalise the agent for declining to bypass a rule when a caller pressures it to.

WRITE EVERY JUSTIFICATION IN ENGLISH, whatever language the call was conducted in. You will be asked to judge Hebrew and mixed-language calls; judge them as a native speaker would, but explain yourself in English, because the people reading your verdict read English. (This instruction is here because a judge model was observed answering a Hebrew transcript in Chinese.)

You reply with JSON and nothing else. No preamble, no markdown fence, no commentary after.`;

/** One `- key: what a 0 looks like ... what a 5 looks like` line per dimension. */
function dimensionGuide(): string {
  const anchors: Record<string, string> = {
    naturalness:
      'Does it sound like speech? 0 = bullet points or written-report prose. 5 = the contractions, rhythm and brevity of a person talking.',
    relevance:
      'Did it answer what was actually asked? 0 = ignored the question and continued its pitch. 5 = addressed the real question first, then moved on.',
    contextualAwareness:
      'Does it behave as though it knows who it is talking to and where in the call it is? 0 = every turn reads like turn one. 5 = visibly aware of the situation it is in.',
    remembersEarlierInformation:
      'Facts the prospect gave earlier. 0 = asked again for something already told, or answered generically when asked to use it. 5 = used the specific earlier detail unprompted and correctly.',
    conversationalContinuity:
      'Do the turns form one conversation? 0 = a series of disconnected replies. 5 = each turn plainly follows from the last.',
    followUpQuality:
      'The questions it asks. 0 = no question where one was obviously needed, or a question already answered. 5 = exactly one question, well chosen, that moves things forward.',
    avoidsMechanicalInterrogation:
      'Stacked questions or checklist behaviour. 0 = two or more questions in one breath, or working a script regardless of replies. 5 = never feels like being processed.',
    handlesUnexpectedInput:
      'Interruptions, digressions, off-script questions. 0 = ignored it or derailed completely. 5 = acknowledged it in a few words like a person and carried on.',
    continuesAfterToolResult:
      'What it says after the system succeeds or refuses. 0 = read an error code aloud, went silent, or claimed something happened that did not. 5 = translated the outcome into an ordinary sentence and kept going.',
    salesQualityNotScripted:
      'Does it actually sell? 0 = no attempt, or a recited template. 5 = persuasive in a way that responds to this specific prospect.',
    recoversFromTopicChange:
      'Getting back on track after a digression. 0 = never recovered, or pretended the digression did not happen. 5 = a natural bridge back.',
    targetLanguageQuality:
      'The quality of the language itself, in the language the call was conducted in. 0 = broken grammar, or obviously machine-translated. 5 = idiomatic and register-appropriate for a business call. For Hebrew: does it read as Hebrew, or as English wearing Hebrew words? For mixed Hebrew/English: is the code-switching natural, the way Israeli professionals actually speak, or jarring?',
  };

  return JUDGED_DIMENSIONS.map((d) => `  "${d.key}" - ${anchors[d.key] ?? d.rationale}`).join('\n');
}

export interface JudgeTranscriptTurn {
  readonly contact: string;
  readonly agent: string;
  /** Rendered summary of what the machinery did, so the judge can see the join. */
  readonly systemEvents: string[];
}

export interface JudgeRequest {
  readonly objective: string;
  readonly language: 'en' | 'he' | 'mixed';
  readonly priorConversation: readonly { role: string; text: string }[];
  readonly turns: readonly JudgeTranscriptTurn[];
}

export function buildJudgeUserPrompt(request: JudgeRequest): string {
  const languageNote =
    request.language === 'he'
      ? 'This call was conducted in HEBREW. Judge the Hebrew as a native business speaker would.'
      : request.language === 'mixed'
        ? 'This call was conducted in MIXED HEBREW AND ENGLISH, which is how Israeli business calls normally sound. Code-switching is NOT an error.'
        : 'This call was conducted in ENGLISH.';

  const prior =
    request.priorConversation.length > 0
      ? `EARLIER IN THIS RELATIONSHIP (the agent has access to this):\n` +
        request.priorConversation.map((t) => `  ${t.role}: ${t.text}`).join('\n') +
        '\n\n'
      : '';

  const body = request.turns
    .map((turn, index) => {
      const events =
        turn.systemEvents.length > 0
          ? `\n  [system: ${turn.systemEvents.join('; ')}]`
          : '';
      return `TURN ${index + 1}\n  PROSPECT: ${turn.contact}${events}\n  AGENT: ${turn.agent || '(said nothing)'}`;
    })
    .join('\n\n');

  return `${languageNote}

WHAT THE AGENT WAS TRYING TO ACHIEVE: ${request.objective}

${prior}TRANSCRIPT:

${body}

---

Rate the AGENT on each dimension below, 0 to 5. The [system: ...] lines tell you what the software did behind the scenes - use them ONLY to judge whether what the agent then SAID made sense. Do not rate the software.

${dimensionGuide()}

Reply with a single JSON object and nothing else. It must have EXACTLY these ${JUDGED_DIMENSIONS.length} keys:

{
${JUDGED_DIMENSIONS.map((d) => `  "${d.key}": { "score": <YOUR SCORE, an integer 0-5>, "why": <YOUR ONE-SENTENCE REASON, in quotes> }`).join(',\n')}
}

The angle-bracket text above is a PLACEHOLDER describing what to put there. Replace every one of them with your own judgement. Do not copy the placeholder text, and do not return the same score for every dimension unless the transcript genuinely deserves it.`;
}
