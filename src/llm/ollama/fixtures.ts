/**
 * REAL recorded Ollama responses. Nothing here was written by hand.
 *
 * WHY THESE EXIST
 * ---------------------------------------------------------------------------
 * `vitest.config.ts` only collects `tests/**` and this task may not add files
 * there, so the usual regression net - a unit test over the mapping functions -
 * is unavailable. These fixtures plus `npm run llm:mapcheck` are the
 * replacement, and they are arguably a better one: every byte below came off
 * the wire from a real model, so the mapper is checked against what Ollama
 * actually sends rather than against what someone believed it sends.
 *
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * Captured 2026-09-23 with `curl` against Ollama 0.34.3 on the mission host,
 * serving `qwen2.5:7b-instruct` and `mistral:7b-instruct` (both Q4_K_M). Each
 * constant records the request that produced it. Re-capturing is a matter of
 * re-running the documented curl and pasting the result.
 *
 * DO NOT "TIDY" THESE STRINGS. The whitespace, the key order, the
 * `prompt_eval_cached_count` that only appears on a warm run - all of it is
 * evidence. A fixture edited to look neater is a fixture that no longer proves
 * anything.
 */

/**
 * NON-STREAMING, NATIVE TOOL CALL. `qwen2.5:7b-instruct`.
 *
 * `POST /api/chat`, `stream: false`, two tools offered, user says
 * "Hi, this is Dana. Can you call me back tomorrow afternoon around 3?".
 *
 * The two things this fixture pins down:
 *   1. `arguments` is an OBJECT, not a string - the central difference from
 *      OpenAI and the reason the mapper re-serialises.
 *   2. The model passed the contact's OWN WORDS through as `when`, and did not
 *      manufacture a timestamp. That is the governing architectural rule
 *      holding on a 7B local model, recorded rather than asserted.
 *
 * It also invented `contact_id: "Dana"`, which application code rejects with
 * UNKNOWN_CONTACT. Both halves of the story are in one response.
 */
export const FIXTURE_NATIVE_TOOL_CALL =
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:05.1502833Z","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_xf7lm9o3","function":{"index":0,"name":"schedule_followup","arguments":{"reason":"callback request","contact_id":"Dana","when":"tomorrow afternoon around 3"}}}]},"done":true,"done_reason":"stop","total_duration":3660545600,"load_duration":2762344600,"prompt_eval_count":272,"prompt_eval_cached_count":0,"prompt_eval_duration":141158000,"eval_count":41,"eval_duration":750932000}';

/**
 * NON-STREAMING, NATIVE TOOL CALL. `mistral:7b-instruct`.
 *
 * The same request against a different family, to prove the mapper is not
 * tuned to one model's quirks. Note this one invented
 * `contact_id: "contact_id_from_get_contact_context"` - a different
 * fabrication, refused by the same validation.
 */
export const FIXTURE_NATIVE_TOOL_CALL_MISTRAL =
  '{"model":"mistral:7b-instruct","created_at":"2026-09-23T15:48:35.9151231Z","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_bfrt5p87","function":{"index":0,"name":"schedule_followup","arguments":{"when":"tomorrow afternoon around 3","reason":"Call back at time specified by contact","contact_id":"contact_id_from_get_contact_context"}}}]},"done":true,"done_reason":"stop","total_duration":4990750800,"load_duration":3491485600,"prompt_eval_count":235,"prompt_eval_cached_count":0,"prompt_eval_duration":108395000,"eval_count":77,"eval_duration":1388010000}';

/**
 * STREAMING, NATIVE TOOL CALL. `qwen2.5:7b-instruct`, `stream: true`.
 *
 * Two NDJSON lines. The important detail: a tool call arrives WHOLE in a single
 * chunk - Ollama does not stream tool arguments token by token the way OpenAI
 * does - and the terminal `done: true` chunk carries every counter. The
 * assembler therefore has to tolerate a chunk with tool calls and empty
 * content, followed by a chunk with neither.
 */
export const FIXTURE_STREAM_TOOL_CALL = [
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:14.7450791Z","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_li7nacmw","function":{"index":0,"name":"schedule_followup","arguments":{"contact_id":"Dana","when":"tomorrow afternoon around 3","reason":"callback request"}}}]},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:14.782062Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":1131497200,"load_duration":2085000,"prompt_eval_count":272,"prompt_eval_cached_count":271,"prompt_eval_duration":381863000,"eval_count":41,"eval_duration":744809000}',
  '',
].join('\n');

/**
 * STREAMING TEXT, AFTER A TOOL RESULT. `qwen2.5:7b-instruct`.
 *
 * The fourth turn of a real multi-turn exchange: user -> assistant tool call ->
 * tool result (an UNKNOWN_CONTACT refusal) -> this. It proves the tool-result
 * round trip works - Ollama accepted the `role: "tool"` message with both
 * `tool_name` and `tool_call_id`, and the model read the refusal and answered
 * in words.
 *
 * 41 lines, one token each, terminated by an empty-content `done: true` chunk.
 * Truncated in the middle for length; the head and tail are verbatim and the
 * elided region is plain text deltas of the same shape.
 */
export const FIXTURE_STREAM_TEXT = [
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.5015344Z","message":{"role":"assistant","content":"It"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.523089Z","message":{"role":"assistant","content":" seems"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.5427792Z","message":{"role":"assistant","content":" I"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.5617656Z","message":{"role":"assistant","content":" don"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.58069Z","message":{"role":"assistant","content":"\'t"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:24.59852Z","message":{"role":"assistant","content":" have"},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:25.2305543Z","message":{"role":"assistant","content":"."},"done":false}',
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:25.248803Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":1099425700,"load_duration":1556500,"prompt_eval_count":317,"prompt_eval_cached_count":107,"prompt_eval_duration":324950000,"eval_count":41,"eval_duration":747311000}',
  '',
].join('\n');

/**
 * THE FALLBACK CASE: a tool call written into the TEXT. `qwen2.5:7b-instruct`.
 *
 * HOW THIS WAS PRODUCED, HONESTLY
 * ---------------------------------------------------------------------------
 * Both models emitted native tool calls on every real request made during this
 * mission, so this shape could not be captured by asking nicely and waiting.
 * It was captured by issuing `/api/chat` with NO `tools` array and describing
 * the tool in the system prompt instead - which is precisely the state a model
 * is in when its chat template's tool support fails: the model still wants to
 * call the tool, and the only channel left is the text.
 *
 * The response body is real and unedited. The `content` is a JSON object with
 * the model's own arguments, which `recoverToolCallsFromText` converts verbatim
 * - note it truncated `when` to "around 3", which is the model's mistake and is
 * preserved rather than corrected.
 */
export const FIXTURE_TEXTUAL_TOOL_CALL =
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:50.9185406Z","message":{"role":"assistant","content":"{\\"name\\": \\"schedule_followup\\", \\"arguments\\": {\\"contact_id\\": \\"Dana\\", \\"when\\": \\"around 3\\", \\"reason\\": \\"follow up\\"}}"},"done":true,"done_reason":"stop","total_duration":4528221400,"load_duration":3842603200,"prompt_eval_count":95,"prompt_eval_cached_count":0,"prompt_eval_duration":51944000,"eval_count":35,"eval_duration":632021000}';

/**
 * A MALFORMED tool-call attempt, synthesised from the fixture above.
 *
 * This one IS constructed, and is labelled as such: it is the real response
 * body with the tool name swapped for one that was never offered. Waiting for a
 * local model to spontaneously hallucinate a tool name would be a poor use of a
 * mission, and the property under test is a property of the MAPPER, not of the
 * model: a name that was not offered must be refused, counted, and left in the
 * assistant's text - never converted into a proposed action.
 */
export const FIXTURE_TEXTUAL_TOOL_CALL_UNOFFERED =
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:50.9185406Z","message":{"role":"assistant","content":"{\\"name\\": \\"send_contract_and_charge_card\\", \\"arguments\\": {\\"contact_id\\": \\"Dana\\", \\"amount_usd\\": 4999}}"},"done":true,"done_reason":"stop","total_duration":4528221400,"load_duration":3842603200,"prompt_eval_count":95,"prompt_eval_cached_count":0,"prompt_eval_duration":51944000,"eval_count":35,"eval_duration":632021000}';

/**
 * A tool-call attempt with NO arguments key. Synthesised, same reasoning.
 *
 * The mapper must refuse this rather than supply `{}`. Supplying `{}` would be
 * this file proposing a tool call with arguments the model never wrote, which
 * is the exact authority the architecture denies it.
 */
export const FIXTURE_TEXTUAL_TOOL_CALL_NO_ARGUMENTS =
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:50.9185406Z","message":{"role":"assistant","content":"{\\"name\\": \\"schedule_followup\\"}"},"done":true,"done_reason":"stop","prompt_eval_count":95,"eval_count":9,"eval_duration":200000000}';

/**
 * Prose that merely MENTIONS a tool. Synthesised.
 *
 * Nothing here may be converted, and nothing here may be counted as malformed -
 * the model is explaining itself, not calling anything. A fallback that fired
 * on this would put words in a contact's ear and an action on the wire.
 */
export const FIXTURE_PROSE_MENTIONING_A_TOOL =
  '{"model":"qwen2.5:7b-instruct","created_at":"2026-09-23T15:48:50.9185406Z","message":{"role":"assistant","content":"I can use schedule_followup for that. Its \\"name\\" field would be schedule_followup. Shall I go ahead?"},"done":true,"done_reason":"stop","prompt_eval_count":95,"eval_count":24,"eval_duration":400000000}';

/** `GET /api/tags` with both mission models present. Verbatim. */
export const FIXTURE_TAGS =
  '{"models":[{"name":"mistral:7b-instruct","model":"mistral:7b-instruct","modified_at":"2026-09-23T18:38:23.2050917+03:00","size":4372824384,"digest":"6577803aa9a036369e481d648a2baebb381ebc6e897f2bb9a766a2aa7bfbc1cf","details":{"parent_model":"","format":"gguf","family":"llama","families":["llama"],"parameter_size":"7.2B","quantization_level":"Q4_K_M","context_length":32768,"embedding_length":4096},"capabilities":["completion","tools"]},{"name":"qwen2.5:7b-instruct","model":"qwen2.5:7b-instruct","modified_at":"2026-09-23T18:36:05.0706957+03:00","size":4683087332,"digest":"845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e","details":{"parent_model":"","format":"gguf","family":"qwen2","families":["qwen2"],"parameter_size":"7.6B","quantization_level":"Q4_K_M","context_length":32768,"embedding_length":3584},"capabilities":["completion","tools"]}]}';

/** `GET /api/ps` with one model resident. Verbatim. `size_vram` is the VRAM figure. */
export const FIXTURE_PS =
  '{"models":[{"name":"mistral:7b-instruct","model":"mistral:7b-instruct","size":4950883040,"digest":"6577803aa9a036369e481d648a2baebb381ebc6e897f2bb9a766a2aa7bfbc1cf","details":{"parent_model":"","format":"gguf","family":"llama","families":["llama"],"parameter_size":"7.2B","quantization_level":"Q4_K_M"},"expires_at":"2026-09-23T18:53:35.9151231+03:00","size_vram":4950883040,"context_length":4096}]}';
