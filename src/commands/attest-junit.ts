/**
 * mergewhy attest junit — Parse JUnit XML test results and submit as attestation
 *
 * Usage:
 *   mergewhy attest junit --results-dir ./test-results --name "Unit Tests"
 *   mergewhy attest junit --results-dir ./test-results --name "E2E Tests" --repo owner/repo --commit abc123
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

interface JUnitSummary {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  suites: number;
  suiteSummaries: Array<{ name: string; tests: number; failures: number; errors: number; time: number }>;
}

/** Minimal XML attribute parser — extracts key="value" pairs from a tag string */
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w[\w-]*)=["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseJUnitXml(xml: string): JUnitSummary {
  const summary: JUnitSummary = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0, suites: 0, suiteSummaries: [] };

  // Match <testsuite> tags (handles both <testsuites><testsuite> and standalone <testsuite>)
  const suiteRegex = /<testsuite\s+([^>]*)>/g;
  let suiteMatch: RegExpExecArray | null;

  while ((suiteMatch = suiteRegex.exec(xml)) !== null) {
    const attrs = parseAttributes(suiteMatch[1]);
    const tests = parseInt(attrs.tests || "0", 10);
    const failures = parseInt(attrs.failures || "0", 10);
    const errors = parseInt(attrs.errors || "0", 10);
    const skipped = parseInt(attrs.skipped || "0", 10);
    const time = parseFloat(attrs.time || "0");

    summary.tests += tests;
    summary.failures += failures;
    summary.errors += errors;
    summary.skipped += skipped;
    summary.time += time;
    summary.suites++;

    summary.suiteSummaries.push({
      name: attrs.name || `Suite ${summary.suites}`,
      tests,
      failures,
      errors,
      time,
    });
  }

  // Fallback: if no <testsuite> found, try <testsuites> root attributes
  if (summary.suites === 0) {
    const rootMatch = xml.match(/<testsuites\s+([^>]*)>/);
    if (rootMatch) {
      const attrs = parseAttributes(rootMatch[1]);
      summary.tests = parseInt(attrs.tests || "0", 10);
      summary.failures = parseInt(attrs.failures || "0", 10);
      summary.errors = parseInt(attrs.errors || "0", 10);
      summary.skipped = parseInt(attrs.skipped || "0", 10);
      summary.time = parseFloat(attrs.time || "0");
      summary.suites = 1;
    }
  }

  return summary;
}

function findXmlFiles(dir: string): string[] {
  const absDir = resolve(dir);
  const files: string[] = [];

  const entries = readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findXmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".xml")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function attestJunitCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

  // Parse arguments
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
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

  const resultsDir = opts["results-dir"] as string;
  if (!resultsDir) {
    formatError("--results-dir is required");
    process.exit(1);
  }

  try {
    const stat = statSync(resultsDir);
    if (!stat.isDirectory()) {
      formatError(`"${resultsDir}" is not a directory`);
      process.exit(1);
    }
  } catch {
    formatError(`Directory not found: ${resultsDir}`);
    process.exit(1);
  }

  const name = (opts.name as string) || "JUnit Test Results";
  const xmlFiles = findXmlFiles(resultsDir);

  if (xmlFiles.length === 0) {
    formatError(`No .xml files found in ${resultsDir}`);
    process.exit(1);
  }

  // Parse and aggregate all XML files
  const combined: JUnitSummary = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0, suites: 0, suiteSummaries: [] };

  for (const file of xmlFiles) {
    const xml = readFileSync(file, "utf-8");
    const parsed = parseJUnitXml(xml);
    combined.tests += parsed.tests;
    combined.failures += parsed.failures;
    combined.errors += parsed.errors;
    combined.skipped += parsed.skipped;
    combined.time += parsed.time;
    combined.suites += parsed.suites;
    combined.suiteSummaries.push(...parsed.suiteSummaries);
  }

  const passed = combined.failures === 0 && combined.errors === 0;

  const evidence: Record<string, unknown> = {
    totalTests: combined.tests,
    passed: combined.tests - combined.failures - combined.errors - combined.skipped,
    failures: combined.failures,
    errors: combined.errors,
    skipped: combined.skipped,
    timeSeconds: Math.round(combined.time * 100) / 100,
    suiteCount: combined.suites,
    xmlFilesProcessed: xmlFiles.length,
    suites: combined.suiteSummaries.slice(0, 50), // Cap to avoid oversized payloads
  };

  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;

  const body: Record<string, unknown> = {
    type: "TEST_RESULTS",
    name,
    passed,
    evidence,
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`JUnit attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: passed ? "PASSED" : "FAILED",
      tests: combined.tests,
      failures: combined.failures,
      errors: combined.errors,
      skipped: combined.skipped,
      time: `${Math.round(combined.time * 100) / 100}s`,
      xmlFiles: xmlFiles.length,
    });
  } else {
    formatError(`Failed to submit JUnit attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest junit — Parse JUnit XML and submit as attestation

USAGE
  mergewhy attest junit --results-dir <path> [--name <name>]

OPTIONS
  --results-dir       Directory containing JUnit XML files (required, recursive)
  --name              Attestation name (default: "JUnit Test Results")
  --repo              Repository owner/name (auto-detected in CI)
  --commit            Commit SHA (auto-detected in CI)
  --pr                Pull request number (auto-detected in CI)
  --artifact-sha256   Link to a specific artifact fingerprint

PASS/FAIL LOGIC
  Automatically PASSES if zero failures and zero errors across all XML files.
  Automatically FAILS if any failures or errors are found.

EXAMPLES
  mergewhy attest junit --results-dir ./test-results
  mergewhy attest junit --results-dir ./build/reports --name "Integration Tests"
  mergewhy attest junit --results-dir ./results --artifact-sha256 a1b2c3...
`.trim());
}
