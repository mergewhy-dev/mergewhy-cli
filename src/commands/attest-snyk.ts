/**
 * mergewhy attest snyk — Parse Snyk SARIF/JSON results and submit as security scan attestation
 *
 * Usage:
 *   mergewhy attest snyk --scan-results ./snyk-results.json --name "Snyk Scan"
 *   mergewhy attest snyk --scan-results ./snyk.sarif --name "Snyk SAST" --repo owner/repo
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

interface VulnCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** Parse Snyk native JSON format (snyk test --json output) */
function parseSnykJson(data: Record<string, unknown>): VulnCounts {
  const counts: VulnCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

  // Snyk JSON can be a single result or an array
  const results = Array.isArray(data) ? data : [data];

  for (const result of results) {
    const vulns = (result as Record<string, unknown>).vulnerabilities as Array<Record<string, unknown>> | undefined;
    if (vulns) {
      for (const vuln of vulns) {
        const severity = ((vuln.severity as string) || "").toLowerCase();
        counts.total++;
        if (severity === "critical") counts.critical++;
        else if (severity === "high") counts.high++;
        else if (severity === "medium") counts.medium++;
        else if (severity === "low") counts.low++;
      }
    }
  }

  return counts;
}

/** Parse SARIF format (used by Snyk Code, Snyk IaC, and many other tools) */
function parseSarifJson(data: Record<string, unknown>): VulnCounts {
  const counts: VulnCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

  const runs = data.runs as Array<Record<string, unknown>> | undefined;
  if (!runs) return counts;

  for (const run of runs) {
    const results = run.results as Array<Record<string, unknown>> | undefined;
    if (!results) continue;

    // Build rule severity map from tool.driver.rules
    const ruleSeverityMap = new Map<string, string>();
    const tool = run.tool as Record<string, unknown> | undefined;
    const driver = tool?.driver as Record<string, unknown> | undefined;
    const rules = driver?.rules as Array<Record<string, unknown>> | undefined;
    if (rules) {
      for (const rule of rules) {
        const ruleId = rule.id as string;
        const defaultConfig = rule.defaultConfiguration as Record<string, unknown> | undefined;
        const level = defaultConfig?.level as string | undefined;
        // Map SARIF levels to severity
        const severity = level === "error" ? "high"
          : level === "warning" ? "medium"
          : level === "note" ? "low"
          : "medium";
        ruleSeverityMap.set(ruleId, severity);
      }
    }

    for (const result of results) {
      counts.total++;

      // Try result-level properties first
      const level = result.level as string | undefined;
      const ruleId = result.ruleId as string | undefined;
      const properties = result.properties as Record<string, unknown> | undefined;
      const severity = (properties?.severity as string || properties?.["security-severity"] as string || "").toLowerCase();

      let resolvedSeverity: string;

      if (severity === "critical" || severity === "high" || severity === "medium" || severity === "low") {
        resolvedSeverity = severity;
      } else if (parseFloat(properties?.["security-severity"] as string || "") >= 9.0) {
        resolvedSeverity = "critical";
      } else if (parseFloat(properties?.["security-severity"] as string || "") >= 7.0) {
        resolvedSeverity = "high";
      } else if (parseFloat(properties?.["security-severity"] as string || "") >= 4.0) {
        resolvedSeverity = "medium";
      } else if (properties?.["security-severity"]) {
        resolvedSeverity = "low";
      } else if (level === "error") {
        resolvedSeverity = "high";
      } else if (level === "warning") {
        resolvedSeverity = "medium";
      } else if (level === "note" || level === "none") {
        resolvedSeverity = "low";
      } else if (ruleId && ruleSeverityMap.has(ruleId)) {
        resolvedSeverity = ruleSeverityMap.get(ruleId)!;
      } else {
        resolvedSeverity = "medium";
      }

      if (resolvedSeverity === "critical") counts.critical++;
      else if (resolvedSeverity === "high") counts.high++;
      else if (resolvedSeverity === "medium") counts.medium++;
      else counts.low++;
    }
  }

  return counts;
}

function isSarif(data: Record<string, unknown>): boolean {
  return typeof data.$schema === "string" && (data.$schema as string).includes("sarif")
    || data.version === "2.1.0" && Array.isArray(data.runs);
}

export async function attestSnykCommand(args: string[]): Promise<void> {
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

  const scanResults = opts["scan-results"] as string;
  if (!scanResults) {
    formatError("--scan-results is required (path to Snyk JSON or SARIF file)");
    process.exit(1);
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(resolve(scanResults), "utf-8");
  } catch {
    formatError(`File not found: ${scanResults}`);
    process.exit(1);
  }

  let data: Record<string, unknown> | Array<Record<string, unknown>>;
  try {
    data = JSON.parse(rawContent);
  } catch {
    formatError("Failed to parse scan results as JSON. Ensure the file is valid Snyk JSON or SARIF.");
    process.exit(1);
  }

  const normalizedData = Array.isArray(data) ? { results: data } as unknown as Record<string, unknown> : data;
  const sarif = isSarif(normalizedData);
  const counts = sarif ? parseSarifJson(normalizedData) : parseSnykJson(normalizedData);

  // Fail if any critical or high vulnerabilities
  const failThreshold = opts["fail-on"] as string | undefined;
  let passed: boolean;
  if (failThreshold === "critical") {
    passed = counts.critical === 0;
  } else {
    // Default: fail on critical or high
    passed = counts.critical === 0 && counts.high === 0;
  }

  const name = (opts.name as string) || "Snyk Security Scan";

  const evidence: Record<string, unknown> = {
    scanner: "snyk",
    format: sarif ? "sarif" : "snyk-json",
    vulnerabilities: counts,
    totalVulnerabilities: counts.total,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    failThreshold: failThreshold || "high",
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
    type: "SECURITY_SCAN",
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
    formatSuccess(`Snyk attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: passed ? "PASSED" : "FAILED",
      total: counts.total,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      format: sarif ? "SARIF" : "Snyk JSON",
    });
  } else {
    formatError(`Failed to submit Snyk attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest snyk — Parse Snyk results and submit as security scan attestation

USAGE
  mergewhy attest snyk --scan-results <path> [--name <name>]

OPTIONS
  --scan-results      Path to Snyk JSON or SARIF file (required)
  --name              Attestation name (default: "Snyk Security Scan")
  --fail-on           Fail threshold: "critical" or "high" (default: "high")
  --repo              Repository owner/name (auto-detected in CI)
  --commit            Commit SHA (auto-detected in CI)
  --pr                Pull request number (auto-detected in CI)
  --artifact-sha256   Link to a specific artifact fingerprint

PASS/FAIL LOGIC
  By default, FAILS if any critical or high severity vulnerabilities are found.
  Use --fail-on critical to only fail on critical severity.

SUPPORTED FORMATS
  - Snyk native JSON (output of: snyk test --json)
  - SARIF 2.1.0 (output of: snyk code test --sarif, snyk iac test --sarif)

EXAMPLES
  snyk test --json > snyk.json && mergewhy attest snyk --scan-results snyk.json
  snyk code test --sarif > snyk.sarif && mergewhy attest snyk --scan-results snyk.sarif
  mergewhy attest snyk --scan-results snyk.json --fail-on critical --name "Snyk OSS"
`.trim());
}
