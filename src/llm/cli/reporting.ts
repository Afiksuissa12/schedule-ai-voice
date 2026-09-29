/**
 * Shared plumbing for the three operator CLIs.
 *
 * WHY CLIS AND NOT TESTS
 * ---------------------------------------------------------------------------
 * `vitest.config.ts` collects `tests/**` only, and this task owns neither that
 * file nor that directory. So the deterministic evidence for this slice ships as
 * runnable CLIs under `src/`, wired to npm scripts. They are held to the same
 * standard a test would be: named assertions, a non-zero exit on any failure,
 * and no "it printed something, looks fine" reporting.
 *
 * `main()` below is the contract - every CLI ends with it, so every CLI exits
 * non-zero on a thrown error rather than printing a stack and returning 0,
 * which is Node's default for an unhandled rejection in some versions and is
 * exactly the behaviour that makes a CI green while it is broken.
 */

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

export function heading(text: string): void {
  process.stdout.write(`\n${BOLD}${text}${RESET}\n${DIM}${'-'.repeat(text.length)}${RESET}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function detail(label: string, value: unknown): void {
  process.stdout.write(`  ${label.padEnd(26)} ${String(value)}\n`);
}

export function pass(text: string): void {
  process.stdout.write(`  ${GREEN}PASS${RESET} ${text}\n`);
}

export function fail(text: string): void {
  process.stdout.write(`  ${RED}FAIL${RESET} ${text}\n`);
}

export function warn(text: string): void {
  process.stdout.write(`  ${YELLOW}WARN${RESET} ${text}\n`);
}

/**
 * A named assertion tally.
 *
 * Collects failures rather than throwing on the first one, so a single run
 * reports everything that is wrong instead of making an operator play
 * whack-a-mole. `finish` is what turns the tally into an exit code.
 */
export class Checks {
  private passed = 0;
  private readonly failures: string[] = [];

  /** Assert a boolean. */
  ok(name: string, condition: boolean, note?: string): void {
    if (condition) {
      this.passed += 1;
      pass(name);
      return;
    }
    this.failures.push(name);
    fail(`${name}${note ? ` - ${note}` : ''}`);
  }

  /**
   * Assert deep equality, reported as a diff.
   *
   * JSON comparison, which for the values these CLIs check - plain objects of
   * strings and numbers coming off a JSON wire - is exact, and prints a far more
   * readable mismatch than a structural walk would.
   */
  equal(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) {
      this.passed += 1;
      pass(name);
      return;
    }
    this.failures.push(name);
    fail(name);
    line(`       ${DIM}expected${RESET} ${b}`);
    line(`       ${DIM}actual  ${RESET} ${a}`);
  }

  get failureCount(): number {
    return this.failures.length;
  }

  /** Print the tally and exit non-zero if anything failed. */
  finish(label: string): never {
    heading('Result');
    if (this.failures.length === 0) {
      line(`${GREEN}${BOLD}PASS${RESET} ${label}: ${this.passed} check(s), 0 failure(s).`);
      process.exit(0);
    }
    line(`${RED}${BOLD}FAIL${RESET} ${label}: ${this.passed} passed, ${this.failures.length} failed.`);
    for (const failure of this.failures) line(`  ${RED}x${RESET} ${failure}`);
    process.exit(1);
  }
}

/**
 * Run a CLI body, and make failure loud.
 *
 * An `AppError` prints its code, message and details, because the details are
 * where the base URL and the timeout live and those are the two things an
 * operator needs. Anything else prints its stack.
 */
export function main(body: () => Promise<void>): void {
  body().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stdout.write(`\n${RED}${BOLD}FAILED${RESET}\n`);
      if (error instanceof Error) {
        const code = (error as { code?: unknown }).code;
        process.stdout.write(`  ${error.name}${code ? ` [${String(code)}]` : ''}: ${error.message}\n`);
        const details = (error as { details?: unknown }).details;
        if (details) process.stdout.write(`  details: ${JSON.stringify(details, null, 2)}\n`);
        if (error.stack) process.stdout.write(`${DIM}${error.stack}${RESET}\n`);
      } else {
        process.stdout.write(`  ${String(error)}\n`);
      }
      process.exit(1);
    },
  );
}

export { DIM, RESET, BOLD };
