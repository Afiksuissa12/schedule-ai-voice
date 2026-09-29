/**
 * `OpenAiLlmProvider` - the real language model, and the ONLY file in this
 * repository that imports a vendor SDK.
 *
 * WHY THE IMPORT IS CONFINED HERE
 * ---------------------------------------------------------------------------
 * `src/agent`, `src/conversation`, `src/scheduling`, `src/followup` and
 * `src/domain` all speak `LlmProvider` from `src/ports/llm.ts` and know nothing
 * about OpenAI. That is what makes the vendor a decision rather than a
 * dependency, and it is what lets the entire test suite run against
 * `ScriptedLlmProvider` with no key and no network.
 *
 * OpenAI is the Founder's vendor, validated by the legacy prototype. Native
 * function/tool calling is used rather than "please reply in JSON" prompting,
 * because a tool call that arrives as a structured object with a provider-issued
 * id is a far better thing to audit than a paragraph we had to guess at.
 *
 * WHAT THIS ADAPTER IS NOT ALLOWED TO DO
 * ---------------------------------------------------------------------------
 * It does not validate, interpret, resolve, or act. It translates one request
 * shape into another and hands back `assistantText` plus PROPOSED tool calls
 * with their arguments as an UNPARSED string. Everything that decides anything
 * happens downstream in `ToolDispatcher`. If this file ever grows a `Date`, a
 * timezone, or a database import, something has gone wrong.
 *
 * COST AND SAFETY
 * ---------------------------------------------------------------------------
 * Constructing this class requires `OPENAI_API_KEY`; there is no silent
 * fallback to a double, because a "production" configuration that quietly does
 * nothing is worse than one that fails at startup. Exactly one optional test
 * exercises it, and that test skips when the key is absent.
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

import type {
  CompleteTurnRequest,
  CompleteTurnResult,
  LlmMessage,
  LlmProvider,
  ToolCallRequest,
} from '../ports/llm.js';
import { ConfigurationError } from '../shared/errors.js';

/**
 * The default model.
 *
 * A current, generally available OpenAI model with native tool calling. It is a
 * constant rather than a literal at the call site so that changing it is one
 * edit, and it is overridable per instance so an operator can pin a different
 * one without a code change.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export interface OpenAiLlmProviderOptions {
  /** Required. Read it from `AppConfig.openAiApiKey`, never from a literal. */
  readonly apiKey: string;
  readonly model?: string;
  /**
   * Low by default: this agent's job is to follow a guardrailed procedure and
   * call tools, not to be creative about when it will phone someone.
   */
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Injectable client, so the optional live test can assert on the wiring. */
  readonly client?: OpenAI;
  readonly baseUrl?: string;
  /**
   * OPTIONAL, OFF BY DEFAULT. Declare that the endpoint behind `baseUrl` honours a JSON-Schema
   * `response_format` and a per-request seed (for example OpenRouter with a model that lists
   * `structured_outputs`). When on, `responseJsonSchema` and `determinism` are forwarded and
   * `supportsStructuredOutput()` answers true, so the composition root can build the semantic
   * claim verifier over this provider. The verifier still validates every answer and fails closed.
   */
  readonly structuredOutput?: boolean;
  /** Extra HTTP headers for an OpenAI-compatible gateway (e.g. OpenRouter attribution headers). */
  readonly defaultHeaders?: Record<string, string>;
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly structuredOutput: boolean;

  constructor(options: OpenAiLlmProviderOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new ConfigurationError(
        'OpenAiLlmProvider requires an API key. Set OPENAI_API_KEY in your local .env (never commit it). ' +
          'Tests must use ScriptedLlmProvider instead - the suite never needs a credential.',
      );
    }

    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
      });
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.temperature = options.temperature ?? 0;
    this.maxOutputTokens = options.maxOutputTokens;
    this.structuredOutput = options.structuredOutput === true;
  }

  name(): string {
    return `openai:${this.model}`;
  }

  /** True only when explicitly configured - see `OpenAiLlmProviderOptions.structuredOutput`. */
  supportsStructuredOutput(): boolean {
    return this.structuredOutput;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    const structured = this.structuredOutput;
    const temperature = structured && req.determinism?.temperature !== undefined ? req.determinism.temperature : this.temperature;
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature,
      ...(structured && req.determinism?.seed !== undefined ? { seed: req.determinism.seed } : {}),
      ...(structured && req.responseJsonSchema !== undefined
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: { name: 'response', schema: req.responseJsonSchema as Record<string, unknown>, strict: true },
            },
          }
        : {}),
      ...(this.maxOutputTokens !== undefined ? { max_tokens: this.maxOutputTokens } : {}),
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map(toOpenAiMessage),
      ],
      ...(req.tools.length > 0
        ? { tools: req.tools.map(toOpenAiTool), tool_choice: 'auto' as const }
        : {}),
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? []).flatMap((call) => {
      // Only function tool calls carry a name and an argument string. A custom
      // tool call is not something this application asked for, so it is
      // dropped rather than guessed at.
      if (call.type !== 'function') return [];
      return [
        {
          toolCallId: call.id,
          toolName: call.function.name,
          // Verbatim. Parsing is the dispatcher's job and its failure is a
          // SCHEMA_VIOLATION we want to see, not one we want to hide here.
          argumentsJson: call.function.arguments,
        },
      ];
    });

    const text = message?.content ?? null;

    return {
      assistantText: text !== null && text.trim().length > 0 ? text : null,
      toolCalls,
    };
  }
}

// ---------------------------------------------------------------------------
// Translation. Dumb on purpose.
// ---------------------------------------------------------------------------

function toOpenAiTool(tool: { name: string; description: string; parametersJsonSchema: unknown }): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersJsonSchema as Record<string, unknown>,
    },
  };
}

/**
 * One port message becomes one OpenAI message.
 *
 * The interesting case is an ASSISTANT message that carries a `toolCallId` and
 * a `toolName`: that is a rebuilt tool-call turn, and OpenAI needs it expressed
 * as `tool_calls` so that the `tool` result message following it is legal. This
 * is the whole reason `LlmMessage.toolName` exists on the port.
 */
function toOpenAiMessage(message: LlmMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };

    case 'user':
      return { role: 'user', content: message.content };

    case 'tool':
      return {
        role: 'tool',
        // A tool result with no id cannot be matched to its call. Failing here
        // beats sending a request the API will reject with a vaguer message.
        tool_call_id: requireToolCallId(message),
        content: message.content,
      };

    case 'assistant': {
      const toolName = message.toolName;
      if (message.toolCallId && toolName) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: message.toolCallId,
              type: 'function',
              function: { name: toolName, arguments: message.content },
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
