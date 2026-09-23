/**
 * DEPRECATED compatibility shim. Prefer `LlmMessage` from `src/ports/llm.ts`.
 *
 * WHAT HAPPENED
 * ---------------------------------------------------------------------------
 * This file used to define `AgentLlmMessage extends LlmMessage` purely to add a
 * `toolName?: string` the port could not express, and its own header said:
 *
 *   > An additive `toolName?: string` on the port itself would be tidier [...]
 *   > This type is deliberately written so that, if it lands, deleting this
 *   > file is the whole migration.
 *
 * It landed. `LlmMessage.toolName` is now part of the port, because the local
 * provider needs exactly the same field OpenAI did - Ollama's `/api/chat` also
 * rejects a `tool` result that no preceding assistant message declared - and a
 * field two of three providers need is a port field, not an extension.
 *
 * WHY THE FILE STILL EXISTS
 * ---------------------------------------------------------------------------
 * "Deleting this file" would have been the whole migration if it had no
 * external importers. It has several, in directories this task does not own
 * (`src/conversation`, `src/agent/prompt`) and in a test file that cannot be
 * edited. So the file is reduced to what it is now genuinely worth: an ALIAS
 * and a one-line accessor, both of which compile to nothing.
 *
 * `AgentLlmMessage` is now literally `LlmMessage`, so an importer needs no
 * change to become correct, and the real migration - deleting these two
 * exports and their imports - is a mechanical follow-up for whoever owns those
 * directories.
 */
import type { LlmMessage } from '../ports/llm.js';

/**
 * @deprecated Use `LlmMessage` from `src/ports/llm.ts`. This is an alias for
 * it, kept so existing importers keep compiling.
 */
export type AgentLlmMessage = LlmMessage;

/**
 * @deprecated Read `message.toolName` directly - it is a port field now.
 *
 * Kept because it is the documented accessor and removing it would break
 * importers this task does not own. It no longer casts anything.
 */
export function toolNameOf(message: LlmMessage): string | undefined {
  return message.toolName;
}
