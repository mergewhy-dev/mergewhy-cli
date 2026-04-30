/**
 * mergewhy attest sonar — Fetch SonarQube quality gate status and submit as attestation
 *
 * Usage:
 *   mergewhy attest sonar --sonar-url https://sonar.example.com --sonar-token TOKEN --project-key myproject
 *   mergewhy attest sonar --sonar-url https://sonarcloud.io --sonar-token TOKEN --project-key myproject --organization myorg
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

interface QualityGateCondition {
  status: string;
  metricKey: string;
  comparator: string;
  errorThreshold: string;
  actualValue: string;
}

interface QualityGateResponse {
  projectStatus: {
    status: string; // OK | ERROR | WARN | NONE
    conditions: QualityGateCondition[];
    periods?: Array<{ index: number; mode: string; date: string }>;
  };
}

interface MeasureResponse {
  component: {
    measures: Array<{ metric: string; value: string }>;
  };
}

async function fetchQualityGate(sonarUrl: string, token: string, projectKey: string): Promise<QualityGateResponse> {
  const url = `${sonarUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SonarQube API returned ${response.status}: ${text}`);
  }

  return await response.json() as QualityGateResponse;
}

async function fetchMetrics(sonarUrl: string, token: string, projectKey: string): Promise<Record<string, string>> {
  const metricKeys = [
    "coverage", "duplicated_lines_density", "bugs", "vulnerabilities",
    "code_smells", "security_hotspots", "reliability_rating", "security_rating",
    "sqale_rating", "ncloc", "cognitive_complexity",
  ].join(",");

  const url = `${sonarUrl}/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${metricKeys}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    // Metrics are optional; don't fail if unavailable
    return {};
  }

  const data = await response.json() as MeasureResponse;
  const metrics: Record<string, string> = {};
  for (const m of data.component.measures) {
    metrics[m.metric] = m.value;
  }
  return metrics;
}

export async function attestSonarCommand(args: string[]): Promise<void> {
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

  const sonarUrl = ((opts["sonar-url"] as string) || process.env.SONAR_URL || "").replace(/\/+$/, "");
  const sonarToken = (opts["sonar-token"] as string) || process.env.SONAR_TOKEN || "";
  const projectKey = (opts["project-key"] as string) || process.env.SONAR_PROJECT_KEY || "";

  if (!sonarUrl) {
    formatError("--sonar-url is required (or set SONAR_URL env var)");
    process.exit(1);
  }
  if (!sonarToken) {
    formatError("--sonar-token is required (or set SONAR_TOKEN env var)");
    process.exit(1);
  }
  if (!projectKey) {
    formatError("--project-key is required (or set SONAR_PROJECT_KEY env var)");
    process.exit(1);
  }

  // Fetch quality gate status and metrics in parallel
  let gateResponse: QualityGateResponse;
  let metrics: Record<string, string>;

  try {
    [gateResponse, metrics] = await Promise.all([
      fetchQualityGate(sonarUrl, sonarToken, projectKey),
      fetchMetrics(sonarUrl, sonarToken, projectKey),
    ]);
  } catch (err) {
    formatError(`Failed to fetch from SonarQube: ${(err as Error).message}`);
    process.exit(1);
  }

  const gateStatus = gateResponse.projectStatus.status;
  const passed = gateStatus === "OK";

  const name = (opts.name as string) || `SonarQube Quality Gate: ${projectKey}`;

  const evidence: Record<string, unknown> = {
    scanner: "sonarqube",
    projectKey,
    sonarUrl,
    qualityGateStatus: gateStatus,
    conditions: gateResponse.projectStatus.conditions.map(c => ({
      metric: c.metricKey,
      status: c.status,
      actual: c.actualValue,
      threshold: c.errorThreshold,
      comparator: c.comparator,
    })),
    failedConditions: gateResponse.projectStatus.conditions.filter(c => c.status === "ERROR").length,
    warningConditions: gateResponse.projectStatus.conditions.filter(c => c.status === "WARN").length,
    metrics: {
      coverage: metrics.coverage ? `${metrics.coverage}%` : undefined,
      duplicatedLines: metrics.duplicated_lines_density ? `${metrics.duplicated_lines_density}%` : undefined,
      bugs: metrics.bugs ? parseInt(metrics.bugs, 10) : undefined,
      vulnerabilities: metrics.vulnerabilities ? parseInt(metrics.vulnerabilities, 10) : undefined,
      codeSmells: metrics.code_smells ? parseInt(metrics.code_smells, 10) : undefined,
      securityHotspots: metrics.security_hotspots ? parseInt(metrics.security_hotspots, 10) : undefined,
      linesOfCode: metrics.ncloc ? parseInt(metrics.ncloc, 10) : undefined,
    },
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
    type: "CODE_REVIEW",
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
    const failedCount = gateResponse.projectStatus.conditions.filter(c => c.status === "ERROR").length;
    formatSuccess(`SonarQube attestation recorded: ${name}`, {
      id: result.data.id as string,
      qualityGate: gateStatus,
      result: passed ? "PASSED" : "FAILED",
      conditions: gateResponse.projectStatus.conditions.length,
      failed: failedCount,
      ...(metrics.coverage && { coverage: `${metrics.coverage}%` }),
      ...(metrics.bugs && { bugs: metrics.bugs }),
      ...(metrics.vulnerabilities && { vulnerabilities: metrics.vulnerabilities }),
    });
  } else {
    formatError(`Failed to submit SonarQube attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest sonar — Fetch SonarQube quality gate and submit as attestation

USAGE
  mergewhy attest sonar --sonar-url <url> --sonar-token <token> --project-key <key>

OPTIONS
  --sonar-url         SonarQube server URL (or SONAR_URL env var)
  --sonar-token       SonarQube authentication token (or SONAR_TOKEN env var)
  --project-key       SonarQube project key (or SONAR_PROJECT_KEY env var)
  --name              Attestation name (default: "SonarQube Quality Gate: <project>")
  --repo              Repository owner/name (auto-detected in CI)
  --commit            Commit SHA (auto-detected in CI)
  --pr                Pull request number (auto-detected in CI)
  --artifact-sha256   Link to a specific artifact fingerprint

PASS/FAIL LOGIC
  PASSES if SonarQube quality gate status is "OK".
  FAILS if quality gate status is "ERROR", "WARN", or "NONE".

METRICS COLLECTED
  Coverage, duplicated lines, bugs, vulnerabilities, code smells,
  security hotspots, lines of code (when available from SonarQube).

EXAMPLES
  mergewhy attest sonar --sonar-url https://sonar.mycompany.com --sonar-token squ_xxx --project-key my-service
  SONAR_URL=https://sonarcloud.io SONAR_TOKEN=xxx mergewhy attest sonar --project-key myorg_myrepo
`.trim());
}
