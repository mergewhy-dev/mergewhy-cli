/**
 * `mergewhy attest security` — Sugar command for recording security scan results
 *
 * Auto-detects Snyk JSON/SARIF, Trivy JSON, or Semgrep SARIF output.
 * Falls back to manual pass/fail attestation.
 *
 * Usage:
 *   mergewhy attest security                           # auto-detect scan results
 *   mergewhy attest security --file snyk-report.json   # specify file
 *   mergewhy attest security --passed                  # manual pass
 *   mergewhy attest security --failed --name "SAST"    # manual fail with name
 */

import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

const COMMON_SCAN_FILES = [
  "snyk-report.json",
  "snyk-results.json",
  "snyk.sarif",
  "trivy-report.json",
  "trivy-results.json",
  "semgrep.sarif",
  "semgrep-results.json",
  "codeql-results.sarif",
  "security-scan.json",
  "scan-results.json",
  "scan-results.sarif",
];

interface ScanSummary {
  tool: string;
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  passed: boolean;
}

function parseScanFile(filePath: string): ScanSummary | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as Record<string, unknown>;

    // SARIF format
    if ((data["$schema"] as string)?.includes("sarif") || data.version === "2.1.0") {
      const runs = data.runs as Array<Record<string, unknown>> | undefined;
      const results = (runs?.[0]?.results ?? []) as Array<Record<string, unknown>>;
      const toolName = ((runs?.[0]?.tool as Record<string, unknown>)?.driver as Record<string, unknown>)?.name as string ?? "SARIF Scanner";

      let critical = 0, high = 0, medium = 0, low = 0;
      for (const r of results) {
        const level = (r.level as string) ?? "warning";
        if (level === "error") high++;
        else if (level === "warning") medium++;
        else low++;
      }

      return { tool: toolName, totalFindings: results.length, critical, high, medium, low, passed: high === 0 && critical === 0 };
    }

    // Snyk JSON format
    if (data.vulnerabilities && Array.isArray(data.vulnerabilities)) {
      const vulns = data.vulnerabilities as Array<Record<string, unknown>>;
      let critical = 0, high = 0, medium = 0, low = 0;
      for (const v of vulns) {
        const sev = (v.severity as string) ?? "low";
        if (sev === "critical") critical++;
        else if (sev === "high") high++;
        else if (sev === "medium") medium++;
        else low++;
      }
      return { tool: "Snyk", totalFindings: vulns.length, critical, high, medium, low, passed: critical === 0 && high === 0 };
    }

    // Trivy JSON format
    if (data.Results && Array.isArray(data.Results)) {
      const results = data.Results as Array<Record<string, unknown>>;
      let critical = 0, high = 0, medium = 0, low = 0, total = 0;
      for (const r of results) {
        const vulns = (r.Vulnerabilities ?? []) as Array<Record<string, unknown>>;
        for (const v of vulns) {
          total++;
          const sev = (v.Severity as string) ?? "LOW";
          if (sev === "CRITICAL") critical++;
          else if (sev === "HIGH") high++;
          else if (sev === "MEDIUM") medium++;
          else low++;
        }
      }
      return { tool: "Trivy", totalFindings: total, critical, high, medium, low, passed: critical === 0 && high === 0 };
    }

    return null;
  } catch {
    return null;
  }
}

export async function attestSecurityCommand(args: string[]): Promise<void> {
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

  const file = (opts.file as string) || (opts["scan-results"] as string);
  const name = (opts.name as string) || "Security Scan";
  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const passed = opts.passed === true;
  const failed = opts.failed === true;

  let summary: ScanSummary | null = null;
  let scanFile: string | null = null;

  if (file) {
    scanFile = file;
    summary = parseScanFile(file);
    if (!summary) {
      formatError(`Could not parse scan file: ${file}`);
      process.exit(1);
    }
  } else {
    for (const candidate of COMMON_SCAN_FILES) {
      if (existsSync(candidate)) {
        const result = parseScanFile(candidate);
        if (result) {
          summary = result;
          scanFile = candidate;
          console.log(`  Found scan results: ${candidate} (${result.tool})`);
          break;
        }
      }
    }
  }

  if (summary && scanFile) {
    console.log(`\n  Security Scan Results (${summary.tool})`);
    console.log(`  ─────────────────────────────`);
    console.log(`  Total findings: ${summary.totalFindings}`);
    if (summary.critical > 0) console.log(`  Critical:       ${summary.critical} !!`);
    if (summary.high > 0) console.log(`  High:           ${summary.high}`);
    if (summary.medium > 0) console.log(`  Medium:         ${summary.medium}`);
    if (summary.low > 0) console.log(`  Low:            ${summary.low}`);
    console.log(`  Result:         ${summary.passed ? "✓ PASSED" : "✗ FAILED"}\n`);

    const attestName = name === "Security Scan" ? `${summary.tool} Scan` : name;
    const res = await apiRequest(config, "POST", "/api/v1/attestations", {
      type: "SECURITY_SCAN",
      name: attestName,
      passed: summary.passed,
      repositoryName: repo,
      commitSha,
      data: {
        source: summary.tool.toLowerCase(),
        scanFile: basename(scanFile),
        totalFindings: summary.totalFindings,
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
      },
    });

    if (res.ok) {
      formatSuccess(`Attestation recorded: ${attestName} — ${summary.passed ? "PASSED" : "FAILED"}`);
    } else {
      formatError(`Failed to record attestation: ${res.status}`);
      process.exit(1);
    }
  } else if (passed || failed) {
    const isPassed = passed && !failed;

    const res = await apiRequest(config, "POST", "/api/v1/attestations", {
      type: "SECURITY_SCAN",
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
    formatError("No security scan results found");
    console.error(`
  Either:
    1. Run from a directory with scan output (Snyk, Trivy, Semgrep, CodeQL)
    2. Specify a file: mergewhy attest security --file snyk-report.json
    3. Manually specify: mergewhy attest security --passed --name "SAST"

  Auto-searched: ${COMMON_SCAN_FILES.join(", ")}
`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest security — Auto-detect and record security scan results

USAGE
  mergewhy attest security [options]

OPTIONS
  --file <path>       Path to scan results (Snyk JSON, Trivy JSON, SARIF)
  --name <name>       Attestation name (default: auto-detected tool name)
  --passed            Record a passing scan attestation (manual mode)
  --failed            Record a failing scan attestation (manual mode)
  --repo <owner/name> Repository (auto-detected in CI)
  --commit <sha>      Commit SHA (auto-detected in CI)

SUPPORTED FORMATS
  Snyk JSON           { vulnerabilities: [...] }
  Trivy JSON          { Results: [{ Vulnerabilities: [...] }] }
  SARIF 2.1.0         Semgrep, CodeQL, Snyk SARIF output

EXAMPLES
  mergewhy attest security
  mergewhy attest security --file trivy-report.json
  mergewhy attest security --passed --name "Container Scan"
`.trim());
}
