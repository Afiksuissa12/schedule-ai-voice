/**
 * `AgentLlmMessage` - `LlmMessage` plus the one field a tool-calling transcript
 * cannot be rebuilt without.
 *
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * `LlmMessage` in `src/ports/llm.ts` is `{ role, content, toolCallId? }`. That
 * is enough for plain chat, but a tool-calling transcript has a shape it cannot
 * express: an ASSISTANT turn that called a tool carries a tool NAME as well as
 * an id, and OpenAI's API rejects a `tool` result message that is not preceded
 * by an assistant message declaring that exact call.
 *
 * THE FIX, AND WHY IT IS NOT A PORT CHANGE
 * ---------------------------------------------------------------------------
 * `AgentLlmMessage` EXTENDS `LlmMessage`. An `AgentLlmMessage[]` is assignable
 * wherever a `ReadonlyArray<LlmMessage>` is wanted, so the port is untouched
 * and every provider keeps working: a provider that does not care about
 * `toolName` simply never looks at it. `OpenAiLlmProvider` narrows to it when
 * rebuilding `tool_calls`.
 *
 * An additive `toolName?: string` on the port itself would be tidier, and has
 * been suggested to the foundation task through the coordination mailbox. This
 * type is deliberately written so that, if it lands, deleting this file is the
 * whole migration.
 */
import type { LlmMessage } from '../ports/llm.js';

export interface AgentLlmMessage extends LlmMessage {
  /**
   * Set on an ASSISTANT message that requested a tool call, and on the `tool`
   * message carrying that call's result. Together with `toolCallId` it is
   * enough to rebuild a provider-native tool-calling transcript from the
   * database alone.
   */
  readonly toolName?: string;
}

/** Narrow a port message to its agent projection without an unchecked cast. */
export function toolNameOf(message: LlmMessage): string | undefined {
  return (message as AgentLlmMessage).toolName;
}
