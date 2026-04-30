/**
 * `mergewhy attest test` — Sugar command for recording test results
 *
 * Auto-detects JUnit XML files, or falls back to generic test attestation.
 * Simpler UX than `attest junit` (no need to specify --results-dir).
 *
 * Usage:
 *   mergewhy attest test                         # auto-detect test results
 *   mergewhy attest test --dir ./test-reports     # specify directory
 *   mergewhy attest test --passed                 # manual pass/fail
 *   mergewhy attest test --failed --name "E2E"    # manual fail
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

const COMMON_TEST_DIRS = [
  "test-reports",
  "test-results",
  "junit-reports",
  "build/test-results",
  "build/reports",
  "target/surefire-reports",
  "coverage",
  ".test-results",
];

function findJunitFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findJunitFiles(full));
      } else if (entry.name.endsWith(".xml")) {
        try {
          const head = readFileSync(full, "utf-8").slice(0, 500);
          if (head.includes("<testsuites") || head.includes("<testsuite")) {
            files.push(full);
          }
        } catch {
          // skip unreadable
        }
      }
    }
  } catch {
    // directory doesn't exist
  }
  return files;
}

export async function attestTestCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const ci = detectCI();

  // Parse arguments
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    }
  }

  const dir = opts.dir as string | undefined;
  const name = (opts.name as string) || "Tests";
  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const passed = opts.passed === true;
  const failed = opts.failed === true;

  // Try to auto-detect JUnit XML files
  let junitFiles: string[] = [];

  if (dir) {
    junitFiles = findJunitFiles(dir);
  } else {
    for (const candidate of COMMON_TEST_DIRS) {
      try {
        statSync(candidate);
        const found = findJunitFiles(candidate);
        if (found.length > 0) {
          junitFiles = found;
          console.log(`  Found test results in ${candidate}/`);
          break;
        }
      } catch {
        // not found
      }
    }
  }

  if (junitFiles.length > 0) {
    let totalTests = 0;
    let totalFailures = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    for (const file of junitFiles) {
      const content = readFileSync(file, "utf-8");
      const testsMatch = content.match(/tests="(\d+)"/);
      const failMatch = content.match(/failures="(\d+)"/);
      const errMatch = content.match(/errors="(\d+)"/);
      const skipMatch = content.match(/skipped="(\d+)"/);

      if (testsMatch) totalTests += parseInt(testsMatch[1], 10);
      if (failMatch) totalFailures += parseInt(failMatch[1], 10);
      if (errMatch) totalErrors += parseInt(errMatch[1], 10);
      if (skipMatch) totalSkipped += parseInt(skipMatch[1], 10);
    }

    const testsPassed = totalFailures === 0 && totalErrors === 0;

    console.log(`\n  Test Results (${junitFiles.length} file${junitFiles.length !== 1 ? "s" : ""})`);
    console.log(`  ─────────────────────────`);
    console.log(`  Total:    ${totalTests}`);
    console.log(`  Passed:   ${totalTests - totalFailures - totalErrors - totalSkipped}`);
    console.log(`  Failed:   ${totalFailures}`);
    console.log(`  Errors:   ${totalErrors}`);
    console.log(`  Skipped:  ${totalSkipped}`);
    console.log(`  Result:   ${testsPassed ? "✓ PASSED" : "✗ FAILED"}\n`);

    const res = await apiRequest(config, "POST", "/api/v1/attestations", {
      type: "TEST_RESULTS",
      name,
      passed: testsPassed,
      repositoryName: repo,
      commitSha,
      data: {
        source: "junit-autodetect",
        totalTests,
        testsPassed: totalTests - totalFailures - totalErrors - totalSkipped,
        testsFailed: totalFailures,
        testsErrors: totalErrors,
        testsSkipped: totalSkipped,
        files: junitFiles.map((f) => basename(f)),
      },
    });

    if (res.ok) {
      formatSuccess(`Attestation recorded: ${name} — ${testsPassed ? "PASSED" : "FAILED"}`);
    } else {
      formatError(`Failed to record attestation: ${res.status}`);
      process.exit(1);
    }
  } else if (passed || failed) {
    const isPassed = passed && !failed;

    const res = await apiRequest(config, "POST", "/api/v1/attestations", {
      type: "TEST_RESULTS",
      name,
      passed: isPassed,
      repositoryName: repo,
      commitSha,
      data: { source: "manual" },
    });

    if (res.ok) {
      formatSuccess(`Attestation recorded: ${name} — ${isPassed ? "PASSED" : "FAILED"}`);
    } else {
      formatError(`Failed to record attestation: ${res.status}`);
      process.exit(1);
    }
  } else {
    formatError("No test results found");
    console.error(`
  Either:
    1. Run from a directory with test results (JUnit XML)
    2. Specify a directory: mergewhy attest test --dir ./test-reports
    3. Manually specify: mergewhy attest test --passed --name "Unit Tests"

  Auto-searched: ${COMMON_TEST_DIRS.join(", ")}
`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest test — Auto-detect and record test results

USAGE
  mergewhy attest test [options]

OPTIONS
  --dir <path>        Directory to search for JUnit XML files
  --name <name>       Attestation name (default: "Tests")
  --passed            Record a passing test attestation (manual mode)
  --failed            Record a failing test attestation (manual mode)
  --repo <owner/name> Repository (auto-detected in CI)
  --commit <sha>      Commit SHA (auto-detected in CI)

EXAMPLES
  mergewhy attest test
  mergewhy attest test --dir ./build/test-results
  mergewhy attest test --passed --name "Unit Tests"
  mergewhy attest test --failed --name "E2E Tests"
`.trim());
}
