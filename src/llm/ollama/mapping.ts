/**
 * Ollama <-> port translation. PURE, and deliberately so.
 *
 * Not one function here opens a socket, reads a clock, or reads the
 * environment. That is what lets `npm run llm:mapcheck` replay real recorded
 * responses through the exact code the provider runs and assert the resulting
 * `ToolCallRequest[]` byte for byte, with the network trap armed and nothing to
 * trap. Given this repository's test files cannot be added to, that CLI is the
 * regression net for this module, and it is only possible because the module
 * has no I/O in it.
 *
 * THE ONE RULE EVERYTHING HERE OBEYS
 * ---------------------------------------------------------------------------
 * Translate, never interpret. No argument is added, removed, renamed, coerced,
 * defaulted or repaired. `argumentsJson` comes out as a verbatim serialisation
 * of what the model produced, because downstream it is evidence: it is stored
 * on `ConversationTurn.rawPayloadJson` and read by an auditor asking what the
 * model actually said.
 *
 * THE ONE DECLARED EXCEPTION, AND WHY IT IS STILL NOT INTERPRETATION
 * ---------------------------------------------------------------------------
 * `unwrapToolNameParametersWrapper` below removes ONE container - never a value,
 * never a key inside the arguments, never a type. It fires only on a shape that
 * has exactly one possible reading, it records the bytes it replaced on
 * `ToolCallRequest.argumentsNormalization`, and what comes out of it faces the
 * same strict Zod schema and the same nine dispatch checks as anything else.
 * `docs/MISSION_2D_AYA_ROOT_CAUSE.md` is the evidence it was written from and
 * `LOCAL_PROVIDER.md` states the rule for an operator.
 */
import type {
  CompleteTurnResult,
  LlmMessage,
  LlmRuntimeDetail,
  LlmToolCallHealth,
  LlmToolDefinition,
  LlmTurnMetrics,
  ToolCallArgumentsNormalization,
  ToolCallRequest,
} from '../../ports/llm.js';
import { ConfigurationError } from '../../shared/errors.js';
import type {
  OllamaChatChunk,
  OllamaRequestMessage,
  OllamaToolSpec,
  OllamaWireToolCall,
} from './wire.js';

// ---------------------------------------------------------------------------
// Request direction
// ---------------------------------------------------------------------------

/**
 * A port tool definition becomes an Ollama tool spec.
 *
 * The JSON Schema is passed through UNTOUCHED. It was generated from the Zod
 * schema the dispatcher validates against (`src/agent/tools/jsonSchema.ts`),
 * and the entire value of generating it is that the model is told exactly what
 * application code will accept. Any "normalisation" here would reintroduce the
 * drift that generation exists to remove.
 */
export function toOllamaTool(tool: LlmToolDefinition): OllamaToolSpec {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersJsonSchema,
    },
  };
}

/**
 * One port message becomes one Ollama message.
 *
 * The interesting case, exactly as with OpenAI, is an ASSISTANT message that
 * carries both a `toolCallId` and a `toolName`: that is a tool-call turn
 * rebuilt from the database, and Ollama needs it expressed as `tool_calls` so
 * that the `tool` result message following it is legal.
 *
 * `message.content` on such a turn is the raw arguments string this system
 * persisted. It is re-parsed here and ONLY here, because Ollama wants an
 * object where OpenAI wanted a string. If it does not parse it is sent as a
 * string rather than guessed at - a transcript that once contained malformed
 * arguments should keep containing them, since the model's own recovery from
 * its earlier mistake is part of what we are testing.
 */
export function toOllamaMessage(message: LlmMessage): OllamaRequestMessage {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };

    case 'user':
      return { role: 'user', content: message.content };

    case 'tool':
      return {
        role: 'tool',
        content: message.content,
        // A tool result with no id cannot be matched to its call. Failing here
        // beats sending a request whose rejection is harder to read.
        tool_call_id: requireToolCallId(message),
        ...(message.toolName ? { tool_name: message.toolName } : {}),
      };

    case 'assistant': {
      if (message.toolCallId && message.toolName) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: message.toolCallId,
              function: { name: message.toolName, arguments: reparseArguments(message.content) },
            },
          ],
        };
      }
      return { role: 'assistant', content: message.content };
    }

    default: {
      const exhaustive: never = message.role;
      throw new ConfigurationError(`Unsupported LlmMessage role: ${String(exhaustive)}`);
    }
  }
}

/** The system prompt is the first message; Ollama has no separate field for it. */
export function toOllamaMessages(
  systemPrompt: string,
  messages: ReadonlyArray<LlmMessage>,
): OllamaRequestMessage[] {
  return [{ role: 'system' as const, content: systemPrompt }, ...messages.map(toOllamaMessage)];
}

function requireToolCallId(message: LlmMessage): string {
  if (!message.toolCallId) {
    throw new ConfigurationError(
      'A tool result message must carry the toolCallId of the call it answers. ' +
        'ConversationService always persists one; a message without it did not come from the database.',
      { details: { contentPreview: message.content.slice(0, 120) } },
    );
  }
  return message.toolCallId;
}

function reparseArguments(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

// ---------------------------------------------------------------------------
// Response direction: native tool calls
// ---------------------------------------------------------------------------

/** Mints a correlation id for a tool call that arrived without one. */
export type ToolCallIdMinter = (index: number) => string;

/**
 * Ollama's `message.tool_calls` become port `ToolCallRequest`s.
 *
 * THE RE-SERIALISATION, AND WHY IT IS NOT A LIE
 * ---------------------------------------------------------------------------
 * Ollama hands back `arguments` as a parsed OBJECT; the port requires a raw
 * string. `JSON.stringify` is therefore unavoidable, and it is the ONLY
 * transformation applied: keys keep their order and their values, nothing is
 * added, nothing is dropped. The audit trail records the model's arguments,
 * losing only the whitespace Ollama had already discarded before we saw it.
 * `LOCAL_PROVIDER.md` states this plainly so no auditor is surprised by it.
 *
 * A call with no usable name is DROPPED, not repaired. Naming a tool is the
 * one thing this layer can never do on the model's behalf.
 *
 * This is also where the ONE declared normalization runs - see
 * `unwrapToolNameParametersWrapper`. It runs here and nowhere else, because
 * here is the only place a wrapper can reach the dispatcher: the text fallback
 * already reads `parameters` as one of its two accepted argument keys, so a
 * wrapper written into TEXT arrives unwrapped without any new rule.
 */
export function mapNativeToolCalls(
  raw: ReadonlyArray<OllamaWireToolCall> | undefined,
  mintId: ToolCallIdMinter,
): ToolCallRequest[] {
  if (!raw || raw.length === 0) return [];

  const calls: ToolCallRequest[] = [];
  for (const [index, call] of raw.entries()) {
    const name = call.function?.name;
    if (typeof name !== 'string' || name.trim().length === 0) continue;

    const argumentsJson = stringifyArguments(call.function?.arguments);
    const normalization = unwrapToolNameParametersWrapper(name, argumentsJson);

    calls.push({
      toolCallId: nonEmpty(call.id) ?? mintId(index),
      toolName: name,
      argumentsJson: normalization?.argumentsJson ?? argumentsJson,
      ...(normalization ? { argumentsNormalization: normalization.provenance } : {}),
    });
  }
  return calls;
}

// ---------------------------------------------------------------------------
// The one declared normalization: an outer object that names the tool.
// ---------------------------------------------------------------------------

/** The two keys, and ONLY these two, that constitute a recognised wrapper. */
const WRAPPER_TOOL_NAME_KEY = 'tool_name';
const WRAPPER_PARAMETERS_KEY = 'parameters';

/** Stable id recorded on the port and in the audit trail when the rule fires. */
export const TOOL_NAME_PARAMETERS_WRAPPER_RULE = 'ollama-tool-name-parameters-wrapper' as const;

/**
 * THE WRAPPER RULE, STATED IN FULL SO IT CAN BE ARGUED WITH.
 *
 * WHAT IT IS FOR
 * ---------------------------------------------------------------------------
 * `aya-expanse:8b` is trained on Cohere's tool protocol, in which a call is
 * written as `{"tool_name": "<tool>", "parameters": {...}}`. Served through
 * Ollama 0.34.3 the name half of that reached `tool_calls[].function.name`
 * correctly and the arguments half did not: `function.arguments` came back as
 * the WHOLE Cohere object, wrapper and all. Every one of its 36 native calls in
 * the committed fair benchmark arrived that way, and the dispatcher refused
 * every one with SCHEMA_VIOLATION naming `tool_name` and `parameters` as
 * unrecognised keys and every required field as missing. Counts, per-call
 * outcomes and the counterfactual are in `docs/MISSION_2D_AYA_ROOT_CAUSE.md`.
 *
 * The container is wrong. Nothing inside it is being judged.
 *
 * EVERY PRECONDITION, AND WHY EACH ONE IS THERE
 * ---------------------------------------------------------------------------
 * All five must hold. Any one failing means the arguments are passed through
 * completely untouched and the call is refused or accepted downstream exactly
 * as it would have been before this function existed.
 *
 *   1. The arguments string parses to a PLAIN JSON OBJECT. An array, a string,
 *      a number or `null` is not a wrapper and is none of this rule's business.
 *
 *   2. Its own key set is EXACTLY {`tool_name`, `parameters`} - both present,
 *      nothing else present. Key ORDER is irrelevant (the model emitted both
 *      orders). Two keys and only two is what makes the shape unambiguous:
 *      a wrapper carries no arguments of its own, so a third key means this is
 *      an arguments object that merely happens to contain `tool_name`, and
 *      unwrapping it would be a guess.
 *
 *      Note what is deliberately NOT accepted: `{name, arguments}`. That is the
 *      OpenAI envelope, Ollama hands it to us already unwrapped, and a tool
 *      whose own schema declared fields called `name` and `arguments` would be
 *      silently mangled by a rule that recognised it. `tool_name` +
 *      `parameters` is Cohere's pair and no tool in `TOOL_DEFINITIONS` declares
 *      either name.
 *
 *   3. `tool_name` is a string EXACTLY equal to the tool this call already
 *      names - no trimming, no case folding, no aliasing. A mismatch means the
 *      model disagreed with itself about which tool it was calling, and
 *      choosing a winner is a decision this layer has no authority to make.
 *
 *   4. `parameters` is a PLAIN JSON OBJECT. A string that happens to parse to
 *      one is NOT accepted here, unlike in the text fallback: a native call's
 *      arguments were already parsed by Ollama, so a string value at this depth
 *      is the model having double-encoded something, and un-double-encoding is
 *      repair rather than translation.
 *
 *   5. The `parameters` object is NOT ITSELF a wrapper by tests 2-4. A nested
 *      wrapper - and the evidence has three of them - means the model produced
 *      the shape more than once and there is no single reading of how many
 *      layers were meant. Those stay refused, which is the correct and audited
 *      outcome.
 *
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not touch a single key or value inside `parameters`. It does not fix
 * an enum, fill a required field, coerce a type, or drop an unrecognised key.
 * On the committed evidence, of the 34 wrapped calls whose arguments the
 * transcript recorded in full, 31 unwrap and 3 nested ones do not - and only 19
 * of the 31 then pass strict Zod. The other 12 are separate model defects the
 * wrapper was hiding (a free-text enum value, an omitted required field, an
 * echoed `tool_name`), and they stay refused.
 *
 * Returns `null` when the rule does not fire, which means "change nothing".
 */
export function unwrapToolNameParametersWrapper(
  toolName: string,
  argumentsJson: string,
): { readonly argumentsJson: string; readonly provenance: ToolCallArgumentsNormalization } | null {
  const parsed = tryParseJson(argumentsJson);
  if (parsed === PARSE_FAILED) return null;

  const inner = wrapperPayload(parsed, toolName);
  if (inner === null) return null;

  // Precondition 5. A nested wrapper has no single reading, so nothing happens.
  if (wrapperPayload(inner, toolName) !== null) return null;

  return {
    argumentsJson: JSON.stringify(inner),
    provenance: { rule: TOOL_NAME_PARAMETERS_WRAPPER_RULE, rawArgumentsJson: argumentsJson },
  };
}

/**
 * Preconditions 1-4 in one place, so test 5 applies the identical test one
 * level down rather than an approximation of it.
 *
 * Returns the `parameters` object when `value` is a wrapper for `toolName`, and
 * `null` otherwise.
 */
function wrapperPayload(value: unknown, toolName: string): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;

  const keys = Object.keys(value);
  if (keys.length !== 2) return null;
  if (!keys.includes(WRAPPER_TOOL_NAME_KEY) || !keys.includes(WRAPPER_PARAMETERS_KEY)) return null;

  if (value[WRAPPER_TOOL_NAME_KEY] !== toolName) return null;

  const payload = value[WRAPPER_PARAMETERS_KEY];
  return isPlainObject(payload) ? payload : null;
}

/**
 * Arguments to their verbatim JSON string.
 *
 * `undefined` becomes `{}` ONLY here, where the model genuinely produced a
 * native tool call carrying no arguments object at all. That is not invention:
 * the tool was named natively by the model, and an absent arguments object in
 * a structured call means the empty set. The dispatcher will still reject it
 * with SCHEMA_VIOLATION if the tool has required fields, which is the correct
 * and audited outcome. The TEXT fallback below is deliberately stricter.
 */
function stringifyArguments(value: unknown): string {
  if (value === undefined) return '{}';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Response direction: the text fallback
// ---------------------------------------------------------------------------

export interface TextualToolCallRecovery {
  /** Calls recovered, in the order they appeared in the text. */
  readonly toolCalls: ToolCallRequest[];
  /** The assistant text with every recovered span removed; null if nothing is left. */
  readonly remainingText: string | null;
  readonly recovered: number;
  /** Candidates that looked like a tool call and were REFUSED. */
  readonly malformed: number;
  /** Why each refusal happened. Surfaced by `llm:smoke`, never acted on. */
  readonly refusals: string[];
}

/**
 * THE FALLBACK: a tool call the model wrote into its text instead of into the
 * native field.
 *
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * A 7B model's chat template is what turns a native tool call into tokens. When
 * that template is imperfect - a quantization that degraded it, a prompt shape
 * it was not tuned for, a model whose tool support is newer than its template -
 * the model still tries to call the tool and the call comes out as JSON in the
 * prose. Both models measured for this mission emitted NATIVE calls throughout,
 * so this is a robustness path and not the normal one; the counters below exist
 * so the evaluation task can prove that per model rather than assume it.
 *
 * WHY IT IS THIS CONSERVATIVE
 * ---------------------------------------------------------------------------
 * A fallback that guesses is worse than no fallback, because a guessed tool
 * call is an action proposed by this file rather than by the model, and this
 * file has no authority to propose actions. So every one of these must hold:
 *
 *   1. The span is one of four recognised shapes - the whole message, a fenced
 *      code block, a `[TOOL_CALLS]`-prefixed payload, or a balanced JSON value
 *      starting at the first character. Braces are never hunted for mid-prose,
 *      because a model explaining a tool call is not calling it.
 *   2. The span parses as JSON.
 *   3. It names a tool, under `name`, `tool_name`, or a nested `function.name`.
 *   4. THAT NAME WAS ACTUALLY OFFERED THIS TURN. A model cannot conjure a tool
 *      into existence by writing its name, and an unoffered name is far more
 *      likely to be prose about tools than a call.
 *   5. It carries an `arguments`/`parameters` value that is a JSON OBJECT, or a
 *      string that parses to one. An ABSENT arguments key is a refusal, not an
 *      empty object: supplying `{}` for a field the model never wrote is
 *      exactly the "fill in the blank" this architecture forbids.
 *
 * Anything that fails 2-5 after passing the "looks like a tool call" test is
 * counted as `malformed`, left in the assistant's text, and never converted.
 * The contact hears the model's words and nothing is proposed - which is the
 * safe failure, and a visible one.
 *
 * THE ONE EXCEPTION TO "LEFT IN THE ASSISTANT'S TEXT": AN ACTION LIST
 * ---------------------------------------------------------------------------
 * See `isActionList`. A span that is provably nothing but machine tool protocol
 * is removed from the assistant text even when every call in it was refused,
 * because the alternative is reading JSON down a phone line. The refusal itself
 * is not softened: it is still counted in `malformed` and still explained in
 * `refusals`.
 */
export function recoverToolCallsFromText(
  text: string,
  offeredToolNames: ReadonlyArray<string>,
  mintId: ToolCallIdMinter,
): TextualToolCallRecovery {
  const empty: TextualToolCallRecovery = {
    toolCalls: [],
    remainingText: text.trim().length > 0 ? text : null,
    recovered: 0,
    malformed: 0,
    refusals: [],
  };

  // No tools offered means nothing in this text can be a call to one.
  if (offeredToolNames.length === 0 || text.trim().length === 0) return empty;

  const offered = new Set(offeredToolNames);
  const spans = findCandidateSpans(text);
  if (spans.length === 0) return empty;

  const toolCalls: ToolCallRequest[] = [];
  const refusals: string[] = [];
  const consumed: Span[] = [];
  let malformed = 0;
  let minted = 0;

  for (const span of spans) {
    const parsed = tryParseJson(span.json);
    if (parsed === PARSE_FAILED) {
      // Only count it if it announced itself as a tool call in the raw text;
      // an unparseable fenced block of something else is not our business.
      if (looksLikeToolCallText(span.json)) {
        malformed += 1;
        refusals.push('span did not parse as JSON');
      }
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    // A span that is nothing but protocol carries no words, so removing it
    // cannot remove anything the contact was meant to hear.
    const protocolArtefact = isActionList(parsed);
    const accepted: ToolCallRequest[] = [];
    let spanRefused = false;

    for (const candidate of candidates) {
      const outcome = evaluateCandidate(candidate, offered);
      if (outcome.kind === 'ignore') continue;
      if (outcome.kind === 'refuse') {
        malformed += 1;
        refusals.push(outcome.reason);
        spanRefused = true;
        continue;
      }
      accepted.push({
        toolCallId: mintId(minted),
        toolName: outcome.toolName,
        argumentsJson: outcome.argumentsJson,
      });
      minted += 1;
    }

    // A span is only removed from the text if EVERY tool-call-looking thing in
    // it was accepted. Leaving a refused call visible in the transcript is the
    // point: the reader must be able to see what the model tried to do - EXCEPT
    // for an action list, which is machine protocol rather than something the
    // model tried to say, and whose evidence lives in `malformed` and
    // `refusals` instead.
    toolCalls.push(...accepted);
    if (protocolArtefact || (accepted.length > 0 && !spanRefused)) {
      consumed.push(span);
    }
  }

  return {
    toolCalls,
    remainingText: removeSpans(text, consumed),
    recovered: toolCalls.length,
    malformed,
    refusals,
  };
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly json: string;
}

type CandidateOutcome =
  /** Not a tool-call attempt at all. Not counted either way. */
  | { readonly kind: 'ignore' }
  | { readonly kind: 'refuse'; readonly reason: string }
  | { readonly kind: 'accept'; readonly toolName: string; readonly argumentsJson: string };

function evaluateCandidate(candidate: unknown, offered: ReadonlySet<string>): CandidateOutcome {
  if (!isPlainObject(candidate)) return { kind: 'ignore' };

  // Both the flat shape (`{name, arguments}`) and the OpenAI-ish nested one
  // (`{function: {name, arguments}}`) are seen from small models.
  const nested = isPlainObject(candidate['function']) ? (candidate['function'] as Record<string, unknown>) : null;
  const source = nested ?? candidate;

  const rawName = source['name'] ?? source['tool_name'];
  if (typeof rawName !== 'string' || rawName.trim().length === 0) return { kind: 'ignore' };
  const toolName = rawName.trim();

  if (!offered.has(toolName)) {
    return {
      kind: 'refuse',
      reason: `names "${toolName}", which was not offered this turn`,
    };
  }

  if (!('arguments' in source) && !('parameters' in source)) {
    return {
      kind: 'refuse',
      reason: `"${toolName}" carried no arguments object; supplying one would be inventing it`,
    };
  }

  const rawArguments = 'arguments' in source ? source['arguments'] : source['parameters'];

  // A string is passed through VERBATIM when it parses to an object - that
  // string is literally what the model wrote, which is the best possible
  // `argumentsJson`.
  if (typeof rawArguments === 'string') {
    const parsed = tryParseJson(rawArguments);
    if (parsed !== PARSE_FAILED && isPlainObject(parsed)) {
      return { kind: 'accept', toolName, argumentsJson: rawArguments };
    }
    return { kind: 'refuse', reason: `"${toolName}" had a string arguments value that is not a JSON object` };
  }

  if (!isPlainObject(rawArguments)) {
    return { kind: 'refuse', reason: `"${toolName}" had a non-object arguments value` };
  }

  return { kind: 'accept', toolName, argumentsJson: JSON.stringify(rawArguments) };
}

/**
 * The five recognised span shapes, in priority order. The first that yields
 * anything wins, so a fenced block inside a whole-message JSON is never
 * double-counted.
 */
function findCandidateSpans(text: string): Span[] {
  const whole = wholeMessageSpan(text);
  if (whole) return [whole];

  const fenced = fencedSpans(text);
  if (fenced.length > 0) return fenced;

  const marked = toolCallsMarkerSpans(text);
  if (marked.length > 0) return marked;

  const leading = leadingJsonSpan(text);
  if (leading) return [leading];

  return actionListSpans(text);
}

/**
 * IS THIS VALUE COHERE'S ACTION LIST, AND NOTHING ELSE?
 *
 * True only for a NON-EMPTY JSON ARRAY in which EVERY element is a plain object
 * whose own key set is exactly {`tool_name`, `parameters`}, whose `tool_name` is
 * a non-empty string, and whose `parameters` is a plain object.
 *
 * WHY THIS PARTICULAR TEST
 * ---------------------------------------------------------------------------
 * It is the shape `aya-expanse:8b` writes when its trained tool protocol does
 * not reach the runtime's structured field - eleven turns of it in the committed
 * fair benchmark, six fenced and five not. It matters because such a span is
 * provably not speech: a sentence a contact could hear is not a JSON array of
 * two-key objects, so the span can be removed from the spoken channel without
 * any judgement about wording. Compare the shape this test deliberately does
 * NOT match: `adversarial-guardrail` turn 1, where the same model wrote a
 * single-backticked JSON OBJECT into a sentence explaining what the right format
 * would be. That is prose about a tool call, it is not an array, it is not
 * line-initial, and it stays exactly where the model put it.
 *
 * Note that `tool_name` is NOT required to be a tool that was offered. Whether
 * it was offered decides whether the call is proposed or refused, and that is
 * `evaluateCandidate`'s job. This test decides only whether the span is speech.
 */
function isActionList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((element) => {
    if (!isPlainObject(element)) return false;
    const keys = Object.keys(element);
    if (keys.length !== 2) return false;
    if (!keys.includes(WRAPPER_TOOL_NAME_KEY) || !keys.includes(WRAPPER_PARAMETERS_KEY)) return false;
    const name = element[WRAPPER_TOOL_NAME_KEY];
    if (typeof name !== 'string' || name.trim().length === 0) return false;
    return isPlainObject(element[WRAPPER_PARAMETERS_KEY]);
  });
}

/** A `[` that opens a line, with only spaces or tabs before it. CRLF-tolerant. */
const LINE_INITIAL_ARRAY_RE = /(?:^|\r?\n)[ \t]*(?=\[)/g;

/**
 * THE FIFTH SHAPE: an action list the model wrote on its own line, unfenced.
 *
 * WHY THIS IS NOT THE MID-PROSE BRACE HUNT THIS FILE FORBIDS
 * ---------------------------------------------------------------------------
 * The promise above is that braces are never hunted for mid-prose, because a
 * model explaining a tool call is not calling one. This shape keeps that
 * promise two ways at once: the value must OPEN A LINE, with nothing but
 * horizontal whitespace before it, and it must be an action list by
 * `isActionList` - so a JSON object mid-sentence, a JSON array of anything else,
 * and an array of tool-call-ish objects carrying a third key are all still
 * invisible here.
 *
 * It exists because without it five real tool calls in the committed evidence
 * were dropped in silence AND their JSON was spoken to the contact, which is
 * the worst of both outcomes. It is reached only when none of the four older
 * shapes matched, so nothing that used to be recognised changes.
 */
function actionListSpans(text: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINE_INITIAL_ARRAY_RE)) {
    const start = match.index + match[0].length;
    if (start < cursor) continue;

    const balanced = balancedJsonFrom(text.slice(start));
    if (balanced === null) continue;

    const parsed = tryParseJson(balanced);
    if (parsed === PARSE_FAILED || !isActionList(parsed)) continue;

    spans.push({ start, end: start + balanced.length, json: balanced });
    cursor = start + balanced.length;
  }

  return spans;
}

function wholeMessageSpan(text: string): Span | null {
  const start = text.length - text.trimStart().length;
  const body = text.trim();
  if (!startsJson(body)) return null;
  if (tryParseJson(body) === PARSE_FAILED) return null;
  return { start, end: start + body.length, json: body };
}

const FENCE_RE = /```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g;

function fencedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    const body = (match[1] ?? '').trim();
    if (startsJson(body)) {
      spans.push({ start: match.index, end: match.index + match[0].length, json: body });
    }
  }
  return spans;
}

/** Mistral's raw template leaks `[TOOL_CALLS] [{...}]` when tool parsing fails. */
const TOOL_CALLS_MARKER = '[TOOL_CALLS]';

function toolCallsMarkerSpans(text: string): Span[] {
  const marker = text.indexOf(TOOL_CALLS_MARKER);
  if (marker < 0) return [];
  const after = text.slice(marker + TOOL_CALLS_MARKER.length);
  const offset = after.length - after.trimStart().length;
  const balanced = balancedJsonFrom(after.trimStart());
  if (balanced === null) return [];
  return [
    {
      start: marker,
      end: marker + TOOL_CALLS_MARKER.length + offset + balanced.length,
      json: balanced,
    },
  ];
}

function leadingJsonSpan(text: string): Span | null {
  const start = text.length - text.trimStart().length;
  const body = text.trimStart();
  if (!startsJson(body)) return null;
  const balanced = balancedJsonFrom(body);
  if (balanced === null) return null;
  return { start, end: start + balanced.length, json: balanced };
}

function startsJson(value: string): boolean {
  return value.startsWith('{') || value.startsWith('[');
}

/**
 * The longest balanced JSON value starting at index 0, or null.
 *
 * String-aware, so a brace inside `"reason": "call back {tomorrow}"` does not
 * end the value early. Depth-only: it does not validate, because `JSON.parse`
 * does that immediately afterwards.
 */
function balancedJsonFrom(value: string): string | null {
  const open = value[0];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return value.slice(0, i + 1);
    }
  }
  return null;
}

/** Cheap "was this trying to be a tool call?" test, used only to count refusals. */
function looksLikeToolCallText(value: string): boolean {
  return /"(?:name|tool_name|function)"\s*:/.test(value);
}

function removeSpans(text: string, spans: ReadonlyArray<Span>): string | null {
  if (spans.length === 0) return text.trim().length > 0 ? text : null;

  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue;
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  out += text.slice(cursor);

  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const PARSE_FAILED = Symbol('parse-failed');

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return PARSE_FAILED;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const NS_PER_MS = 1_000_000;
const NS_PER_SECOND = 1_000_000_000;

export interface MetricsInput {
  readonly modelId: string;
  readonly streamed: boolean;
  readonly totalLatencyMs: number;
  readonly timeToFirstTokenMs: number | null;
  /** The `done: true` chunk, which is where Ollama puts every counter. */
  readonly final: OllamaChatChunk | null;
  readonly toolCallHealth: LlmToolCallHealth;
  readonly runtime?: LlmRuntimeDetail;
}

/**
 * Ollama's own counters become port metrics.
 *
 * Tokens-per-second is computed from `eval_count / eval_duration` - GENERATION
 * time only, excluding prompt evaluation and model load. That is the number
 * that describes how fast the model speaks, which is what a voice product
 * cares about, and it is deliberately not the same as
 * `generatedTokens / totalLatencyMs`, which would make a cold start look like
 * a slow model.
 */
export function buildMetrics(input: MetricsInput): LlmTurnMetrics {
  const final = input.final;
  const promptTokens = numberOrNull(final?.prompt_eval_count);
  const generatedTokens = numberOrNull(final?.eval_count);
  const evalDurationNs = numberOrNull(final?.eval_duration);
  const loadDurationNs = numberOrNull(final?.load_duration);

  const tokensPerSecond =
    generatedTokens !== null && evalDurationNs !== null && evalDurationNs > 0
      ? round2((generatedTokens * NS_PER_SECOND) / evalDurationNs)
      : null;

  const runtime: LlmRuntimeDetail = {
    ...(input.runtime ?? {}),
    ...(loadDurationNs !== null ? { loadDurationMs: round2(loadDurationNs / NS_PER_MS) } : {}),
  };

  // The safety number. Both halves have to be known for it to mean anything,
  // and a guess here would be worse than a null - see the port's comment on
  // silent front-truncation.
  const contextLength = runtime.contextLength;
  const contextUtilization =
    promptTokens !== null && typeof contextLength === 'number' && contextLength > 0
      ? Math.round((promptTokens / contextLength) * 10_000) / 10_000
      : null;

  return {
    modelId: input.modelId,
    streamed: input.streamed,
    timeToFirstTokenMs: input.timeToFirstTokenMs,
    totalLatencyMs: round2(input.totalLatencyMs),
    promptTokens,
    generatedTokens,
    tokensPerSecond,
    contextUtilization,
    toolCallHealth: input.toolCallHealth,
    ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
  };
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Assembling a turn from chunks
// ---------------------------------------------------------------------------

export interface AssembledTurn {
  readonly text: string;
  readonly nativeToolCalls: OllamaWireToolCall[];
  readonly final: OllamaChatChunk | null;
}

/**
 * Fold a chunk sequence into one turn.
 *
 * Works for BOTH paths, which is the point: a non-streaming response is a
 * one-element sequence whose single chunk has `done: true`. One assembler
 * means the streaming and non-streaming paths cannot disagree about what the
 * model said, which is a real risk when they are written twice.
 *
 * `thinking` is ignored. It is the model's scratchpad, not its reply, and
 * putting it in `assistantText` would eventually put it in a contact's ear.
 */
export function assembleTurn(chunks: ReadonlyArray<OllamaChatChunk>): AssembledTurn {
  let text = '';
  const nativeToolCalls: OllamaWireToolCall[] = [];
  let final: OllamaChatChunk | null = null;

  for (const chunk of chunks) {
    const content = chunk.message?.content;
    if (typeof content === 'string') text += content;

    const calls = chunk.message?.tool_calls;
    if (calls && calls.length > 0) nativeToolCalls.push(...calls);

    if (chunk.done === true) final = chunk;
  }

  return { text, nativeToolCalls, final };
}

/**
 * The whole response direction, end to end: chunks in, `CompleteTurnResult`
 * out. Exposed so `llm:mapcheck` can drive it with recorded fixtures and
 * assert the exact result the provider would have returned.
 */
export function toCompleteTurnResult(input: {
  readonly chunks: ReadonlyArray<OllamaChatChunk>;
  readonly offeredToolNames: ReadonlyArray<string>;
  readonly mintId: ToolCallIdMinter;
  readonly modelId: string;
  readonly streamed: boolean;
  readonly totalLatencyMs: number;
  readonly timeToFirstTokenMs: number | null;
  readonly runtime?: LlmRuntimeDetail;
}): CompleteTurnResult & { readonly refusals: string[] } {
  const assembled = assembleTurn(input.chunks);
  const nativeCalls = mapNativeToolCalls(assembled.nativeToolCalls, input.mintId);

  // The fallback runs ONLY when the native field produced nothing. A model that
  // called a tool properly is never second-guessed by a text scan.
  const recovery =
    nativeCalls.length === 0
      ? recoverToolCallsFromText(assembled.text, input.offeredToolNames, (index) =>
          input.mintId(index),
        )
      : null;

  const toolCalls = nativeCalls.length > 0 ? nativeCalls : (recovery?.toolCalls ?? []);
  const text = recovery ? recovery.remainingText : assembled.text;

  const health: LlmToolCallHealth = {
    native: nativeCalls.length,
    recoveredFromText: recovery?.recovered ?? 0,
    malformed: recovery?.malformed ?? 0,
  };

  return {
    assistantText: text !== null && text.trim().length > 0 ? text : null,
    toolCalls,
    metrics: buildMetrics({
      modelId: input.modelId,
      streamed: input.streamed,
      totalLatencyMs: input.totalLatencyMs,
      timeToFirstTokenMs: input.timeToFirstTokenMs,
      final: assembled.final,
      toolCallHealth: health,
      ...(input.runtime ? { runtime: input.runtime } : {}),
    }),
    refusals: recovery?.refusals ?? [],
  };
}
