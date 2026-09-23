/**
 * The LLM boundary.
 *
 * Two implementations of one port. `ScriptedLlmProvider` runs every test in
 * this repository; `OpenAiLlmProvider` is the real vendor and is the only file
 * in the codebase that imports a vendor SDK.
 *
 * NOTE ON THE EXPORT LIST: `openAiLlmProvider.js` is exported from here, which
 * means importing this barrel pulls the OpenAI SDK into the module graph.
 * Constructing the provider still requires a key, and nothing is sent anywhere
 * on import - but a caller that wants to be certain it cannot reach a vendor at
 * all should import `./scriptedLlmProvider.js` directly. `src/app` does exactly
 * that for the demo.
 */
export * from './agentMessage.js';
export * from './openAiLlmProvider.js';
export * from './scriptedLlmProvider.js';
