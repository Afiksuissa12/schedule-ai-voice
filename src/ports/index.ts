/**
 * The port contract.
 *
 * Everything the scheduling, agent and QA tasks compile against is re-exported
 * here. These names are a CONTRACT: they are not renamed or relocated without
 * announcing the change to every dependent task first.
 *
 * Types only, plus the two `Clock` implementations - the ports layer has no
 * business logic and no vendor dependency. Concrete providers live in
 * `src/providers` and `src/llm`.
 */
export * from './availability.js';
export * from './calendar.js';
export * from './clock.js';
export * from './llm.js';
export * from './telephony.js';
export * from './validation.js';
