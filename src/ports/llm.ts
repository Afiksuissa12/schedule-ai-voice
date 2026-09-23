/**
 * PORT: the language model.
 *
 * CONTRACT, and the whole point of this port: the LLM returns TEXT and
 * PROPOSED TOOL CALLS. It returns no state, no side effects, and nothing that
 * is trusted. `argumentsJson` is a raw string precisely because it is untrusted
 * input - application code parses it, validates it against a schema, validates
 * the resulting datetime deterministically, and only then acts.
 *
 * Implementations live in `src/llm` (owned by the agent task).
 */

export interface ToolCallRequest {
  /** Provider-supplied id correlating this call with its result turn. */
  readonly toolCallId: string;
  readonly toolName: string;
  /**
   * Raw JSON arguments exactly as the model produced them. UNTRUSTED and
   * UNPARSED by design: stored verbatim on `ConversationTurn.rawPayloadJson`
   * so an auditor sees what the model actually said, not a cleaned-up version.
   */
  readonly argumentsJson: string;
}

export type LlmMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface LlmMessage {
  readonly role: LlmMessageRole;
  readonly content: string;
  /** Required on `tool` messages: which tool call this is the result of. */
  readonly toolCallId?: string;
}

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. Kept `unknown` so no JSON-Schema library leaks into the port. */
  readonly parametersJsonSchema: unknown;
}

export interface CompleteTurnRequest {
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly tools: ReadonlyArray<LlmToolDefinition>;
}

export interface CompleteTurnResult {
  /** The assistant's natural-language reply, or null when it only called tools. */
  readonly assistantText: string | null;
  /** Tool calls the model PROPOSED. Nothing has been executed or validated yet. */
  readonly toolCalls: ToolCallRequest[];
}

export interface LlmProvider {
  /** Stable provider identity, recorded in audit events, e.g. `openai` or `scripted-test`. */
  name(): string;

  completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult>;
}
