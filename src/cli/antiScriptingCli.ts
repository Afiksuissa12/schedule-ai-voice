/**
 * `npm run check:anti-scripting`
 *
 * Exits 0 when the customer-facing path carries no canned dialogue this check
 * can recognise, and non-zero otherwise. Prints what it could NOT check as well
 * as what it did, because the second half is what stops the first half being
 * read as a guarantee.
 *
 * The non-vacuity self-test runs on every invocation, not behind a flag. A
 * green result that has not just demonstrated the rules can still fire is not
 * evidence of anything, and a flag is a thing people forget to pass.
 *
 * This is a CLI and not a vitest file for a structural reason worth recording:
 * `vitest.config.ts` includes only `tests/**` and this mission may not edit
 * `tests/` or that config. So every proof this milestone adds is a runnable
 * program with a non-zero exit, wired to an npm script. They are run the same
 * way CI would run them, and `CONVERSATION_CONTEXT.md` lists them all.
 */
import { FILE_EXEMPTIONS, runAntiScriptingCheck, SCANNED_DIRECTORIES } from '../context/antiScriptingCheck.js';
import { runSelfTest } from '../context/antiScriptingSelfTest.js';

function main(): void {
  // The check runs first and the self-test always runs with it. A pass that
  // has not demonstrated the rules can still fire is not a pass worth printing.
  const selfTest = runSelfTest();
  const report = runAntiScriptingCheck();

  console.log('anti-scripting check');
  console.log('='.repeat(78));
  console.log(`  Directories scanned : ${SCANNED_DIRECTORIES.join(', ')}`);
  console.log(`  Files scanned       : ${report.filesScanned}`);
  console.log(`  String literals     : ${report.literalsExamined}`);
  console.log(`  Profiles validated  : ${report.profilesValidated.length ? report.profilesValidated.join(', ') : 'none found'}`);
  console.log(`  Allowances in force : ${report.allowances.length}`);
  console.log('');
  console.log('  Non-vacuity self-test:');
  console.log(`    known-bad samples  : ${selfTest.badSamplesChecked} (each must be caught)`);
  console.log(`    known-good samples : ${selfTest.goodSamplesChecked} (each must stay clean)`);
  console.log(`    rules shown to fire: ${selfTest.rulesExercised.join(', ') || 'NONE'}`);

  if (FILE_EXEMPTIONS.length > 0) {
    console.log('');
    console.log('  Files the walk skips, and why:');
    for (const exemption of FILE_EXEMPTIONS) {
      console.log(`    ${exemption.file}`);
      console.log(`      ${exemption.why}`);
    }
  }

  if (report.allowances.length > 0) {
    console.log('');
    console.log('  Allowed, with reasons - this list can only grow in public:');
    for (const allowance of report.allowances) {
      console.log(`    ${allowance.file}:${allowance.line}  ${allowance.ruleId}`);
      console.log(`      ${allowance.justification}`);
    }
  }

  const failures = [...report.violations];
  for (const failure of selfTest.failures) {
    failures.push({
      ruleId: 'SELF_TEST',
      file: 'src/context/antiScriptingSelfTest.ts',
      line: 1,
      detail: failure,
      excerpt: '',
    });
  }
  for (const allowance of report.unjustifiedAllowances) {
    failures.push({
      ruleId: 'UNJUSTIFIED_ALLOWANCE',
      file: allowance.file,
      line: allowance.line,
      detail:
        `An allowance for ${allowance.ruleId} was written with no reason after it. An exemption nobody had to ` +
        'justify is an exemption nobody will review. Add the reason after a dash.',
      excerpt: '',
    });
  }

  console.log('');
  if (failures.length === 0) {
    console.log('  RESULT: PASS - no canned dialogue found on the customer-facing path.');
  } else {
    console.log(`  RESULT: FAIL - ${failures.length} violation(s).`);
    console.log('');
    for (const violation of failures) {
      console.log(`  ${violation.file}:${violation.line}  [${violation.ruleId}]`);
      console.log(`    ${violation.detail}`);
      if (violation.excerpt) console.log(`    > ${violation.excerpt}`);
      console.log('');
    }
  }

  console.log('');
  console.log('  What this check CANNOT catch (see CONVERSATION_CONTEXT.md):');
  console.log('    - a declarative fact that an author privately intends to be read out verbatim');
  console.log('    - an utterance assembled at runtime from fragments, where no one literal looks like speech');
  console.log('    - speech inside a template literal interpolation, which the scanner does not descend into');
  console.log('    - anything outside the three scanned directories, or loaded from the database');
  console.log('='.repeat(78));

  if (failures.length > 0) process.exitCode = 1;
}

main();
