/**
 * mergewhy attest — Record an attestation (test results, security scan, code review, etc.)
 *
 * Usage:
 *   mergewhy attest --type TEST_RESULTS --name "Unit Tests" --passed --repo owner/repo --commit abc123
 *   mergewhy attest --type SECURITY_SCAN --name "Snyk" --failed --evidence '{"vulns": 3}' --commit abc123
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

const VALID_TYPES = [
  "TEST_RESULTS", "SECURITY_SCAN", "CODE_REVIEW", "SBOM",
  "BUILD_PROVENANCE", "DEPLOYMENT_APPROVAL", "CUSTOM",
] as const;

export async function attestCommand(args: string[]): Promise<void> {
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

  const type = (opts.type as string || "").toUpperCase();
  if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    formatError(`Invalid type "${opts.type}". Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const name = opts.name as string;
  if (!name) {
    formatError("--name is required");
    process.exit(1);
  }

  const passed = opts.passed === true || opts.passed === "true";
  const failed = opts.failed === true || opts.failed === "true";
  if (!passed && !failed) {
    formatError("Either --passed or --failed is required");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;

  let evidence: Record<string, unknown> = {};
  if (opts.evidence) {
    try {
      evidence = JSON.parse(opts.evidence as string);
    } catch {
      formatError("--evidence must be valid JSON");
      process.exit(1);
    }
  }

  // Add CI context to evidence
  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  const body: Record<string, unknown> = {
    type,
    name,
    passed: passed && !failed,
    evidence,
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
    ...(opts["evidence-url"] && { evidenceUrl: opts["evidence-url"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`Attestation recorded: ${name} (${type})`, {
      id: result.data.id as string,
      ...(result.data.derId && { derId: result.data.derId as string }),
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to record attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
