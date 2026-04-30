/**
 * mergewhy pipeline — Record a CI/CD pipeline run
 *
 * Usage:
 *   mergewhy pipeline --name "Build & Test" --status success --repo owner/repo --commit abc123
 *   mergewhy pipeline --name "Deploy" --status failure --duration 120 --url https://ci.example.com/123
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

const VALID_STATUSES = ["success", "failure", "running", "cancelled", "pending"] as const;

export async function pipelineCommand(args: string[]): Promise<void> {
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

  const name = opts.name as string;
  if (!name) {
    formatError("--name is required (pipeline/workflow name)");
    process.exit(1);
  }

  const status = ((opts.status as string) || "").toLowerCase();
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    formatError(`Invalid status "${opts.status}". Valid: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;

  let steps: Record<string, unknown>[] = [];
  if (opts.steps) {
    try {
      steps = JSON.parse(opts.steps as string) as Record<string, unknown>[];
    } catch {
      formatError("--steps must be valid JSON array");
      process.exit(1);
    }
  }

  // Map CLI-friendly statuses to API enum values
  const STATUS_MAP: Record<string, string> = {
    success: "COMPLETED",
    failure: "FAILED",
    running: "IN_PROGRESS",
    cancelled: "CANCELLED",
    pending: "QUEUED",
  };
  const apiStatus = STATUS_MAP[status] || "COMPLETED";

  // Auto-generate externalId from CI context or fallback
  const externalId = (opts["external-id"] as string) ||
    ci?.buildId ||
    `cli-${Date.now()}`;

  const triggeredBy = (opts["triggered-by"] as string) ||
    ci?.triggeredBy ||
    process.env.USER ||
    "cli";

  const headBranch = (opts.branch as string) || ci?.branch || "unknown";

  const conclusion = apiStatus === "COMPLETED" ? "success" :
    apiStatus === "FAILED" ? "failure" : undefined;

  const body: Record<string, unknown> = {
    workflowName: name,
    status: apiStatus,
    repositoryName: repo,
    headSha: commitSha || "unknown",
    headBranch,
    externalId,
    triggeredBy,
    event: (opts.event as string) || "push",
    ...(conclusion && { conclusion }),
    ...(opts.duration && { durationSeconds: parseInt(opts.duration as string, 10) }),
    ...(opts.url && { runUrl: opts.url }),
    ...(ci?.buildUrl && !opts.url && { runUrl: ci.buildUrl }),
    ...(steps.length > 0 && { steps }),
    ...(ci?.prNumber && { prNumber: ci.prNumber }),
    source: ci?.provider || "cli",
  };

  const result = await apiRequest(config, "POST", "/api/v1/pipeline-runs", body);

  if (result.ok) {
    formatSuccess(`Pipeline recorded: ${name} (${status})`, {
      id: result.data.id as string,
      status,
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to record pipeline: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
