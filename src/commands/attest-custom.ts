/**
 * mergewhy attest custom — Record a custom-typed attestation
 *
 * Usage:
 *   mergewhy attest custom --type my-custom-type --data evidence.json --name "Custom Check"
 *   mergewhy attest custom --type security-review --data results.json --passed --repo owner/repo
 */

import { readFileSync } from "node:fs";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function attestCustomCommand(args: string[]): Promise<void> {
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

  const customType = opts.type as string;
  if (!customType) {
    formatError("--type is required (the custom attestation type name)");
    process.exit(1);
  }

  const name = (opts.name as string) || customType;
  const dataFile = opts.data as string;

  let evidence: Record<string, unknown> = {};
  if (dataFile) {
    try {
      const raw = readFileSync(dataFile, "utf-8");
      evidence = JSON.parse(raw);
    } catch (err) {
      formatError(`Failed to read data file '${dataFile}': ${(err as Error).message}`);
      process.exit(1);
    }
  } else if (opts.evidence) {
    try {
      evidence = JSON.parse(opts.evidence as string);
    } catch {
      formatError("--evidence must be valid JSON");
      process.exit(1);
    }
  }

  const passed = opts.passed === true || opts.passed === "true";
  const failed = opts.failed === true || opts.failed === "true";
  // Default to passed if neither specified
  const attestPassed = failed ? false : true;

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;

  // Add CI context to evidence
  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  // Tag evidence with custom type reference
  evidence._customType = customType;

  const body: Record<string, unknown> = {
    type: "CUSTOM",
    name,
    passed: attestPassed,
    evidence,
    source: `custom:${customType}`,
    ...(repo && { repositoryName: repo }),
    ...(commitSha && { commitSha }),
    ...(prNumber && { prNumber }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);
  formatSuccess(`Custom attestation '${name}' (type: ${customType}) recorded`, result);
}

function printHelp(): void {
  console.log(`
mergewhy attest custom — Record a custom-typed attestation

USAGE
  mergewhy attest custom --type <type-name> [options]

OPTIONS
  --type <name>       Custom attestation type name (required)
  --name <name>       Display name (defaults to type name)
  --data <file>       Path to JSON evidence file
  --evidence <json>   Inline JSON evidence string
  --passed            Mark attestation as passed (default)
  --failed            Mark attestation as failed
  --repo <owner/repo> Repository (auto-detected in CI)
  --commit <sha>      Commit SHA (auto-detected in CI)
  --pr <number>       PR number (auto-detected in CI)

EXAMPLES
  # Submit custom type with data file
  mergewhy attest custom --type security-review --data scan-results.json --name "Security Review"

  # Submit inline evidence
  mergewhy attest custom --type perf-test --evidence '{"p99_ms": 42}' --passed

  # Failed attestation
  mergewhy attest custom --type license-check --data licenses.json --failed
`.trim());
}
