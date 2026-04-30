/**
 * mergewhy gate — Check deployment gate (pass/fail based on compliance score)
 *
 * Usage:
 *   mergewhy gate --environment production --min-score 80
 *   mergewhy gate --environment staging --min-score 60 --repo owner/repo
 *
 * Exit codes:
 *   0 = gate passed (deployment allowed)
 *   1 = gate failed (deployment blocked)
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function gateCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

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

  const environment = (opts.environment as string) || (opts.env as string);
  if (!environment) {
    formatError("--environment is required (e.g., production, staging)");
    process.exit(1);
  }

  const minScore = opts["min-score"]
    ? parseInt(opts["min-score"] as string, 10)
    : 80;

  if (isNaN(minScore) || minScore < 0 || minScore > 100) {
    formatError("--min-score must be a number between 0 and 100");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;

  const params = new URLSearchParams({
    environment,
    "min-score": minScore.toString(),
    ...(repo && { repository: repo }),
    ...(commitSha && { commit: commitSha }),
    ...(opts.framework && { framework: opts.framework as string }),
    ...(opts["require-sealed"] && { "require-sealed": "true" }),
  });

  const result = await apiRequest(config, "GET", `/api/v1/gate?${params.toString()}`);

  if (!result.ok) {
    formatError(`Gate check failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const { allowed, score, reason, complianceStatus } = result.data as {
    allowed: boolean;
    score: number;
    reason: string;
    complianceStatus?: Record<string, unknown>;
  };

  if (allowed) {
    formatSuccess(`Gate PASSED: ${environment}`, {
      score: `${score}/100 (min: ${minScore})`,
      ...(complianceStatus && { compliance: JSON.stringify(complianceStatus) }),
    });
    process.exit(0);
  } else {
    formatError(`Gate FAILED: ${environment}`, {
      score: `${score}/100 (min: ${minScore})`,
      reason,
      ...(complianceStatus && { compliance: JSON.stringify(complianceStatus) }),
    });
    process.exit(1);
  }
}
