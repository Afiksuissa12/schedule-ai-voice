/**
 * The LLM boundary.
 *
 * Three implementations of one port. `ScriptedLlmProvider` runs every test in
 * this repository; `OpenAiLlmProvider` is the hosted vendor and is the only
 * file in the codebase that imports a vendor SDK; `LocalLlmProvider` is a model
 * served by Ollama on the operator's own machine, reached with global `fetch`
 * and no client library at all.
 *
 * NOTE ON THE EXPORT LIST: `openAiLlmProvider.js` is exported from here, which
 * means importing this barrel pulls the OpenAI SDK into the module graph.
 * Constructing the provider still requires a key, and nothing is sent anywhere
 * on import - but a caller that wants to be certain it cannot reach a vendor at
 * all should import `./scriptedLlmProvider.js` directly. `src/app` does exactly
 * that for the demo.
 *
 * `localLlmProvider.js` is inert on import in the same way and more simply:
 * there is no SDK to load, no constant that dials anything, and no probe. The
 * first byte leaves the process on the first `completeTurn`.
 */
export * from './agentMessage.js';
export * from './localLlmProvider.js';
export * from './openAiLlmProvider.js';
export * from './scriptedLlmProvider.js';
