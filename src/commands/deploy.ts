/**
 * mergewhy deploy — Record a deployment event
 *
 * Usage:
 *   mergewhy deploy --environment production --artifact-sha256 abc123... --repo owner/repo
 *   mergewhy deploy --environment staging --commit def456 --status success
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function deployCommand(args: string[]): Promise<void> {
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

  const environment = opts.environment as string || opts.env as string;
  if (!environment) {
    formatError("--environment is required (e.g., production, staging, development)");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;

  const deployedBy = (opts["deployed-by"] as string) || ci?.triggeredBy || process.env.USER || "cli";
  const ref = (opts.ref as string) || ci?.branch || "unknown";

  const statusRaw = ((opts.status as string) || "success").toUpperCase();
  const STATUS_MAP: Record<string, string> = {
    SUCCESS: "SUCCESS",
    FAILURE: "FAILURE",
    PENDING: "PENDING",
    "IN_PROGRESS": "IN_PROGRESS",
    "IN-PROGRESS": "IN_PROGRESS",
    RUNNING: "IN_PROGRESS",
    INACTIVE: "INACTIVE",
  };
  const status = STATUS_MAP[statusRaw] || "SUCCESS";

  const body: Record<string, unknown> = {
    environmentName: environment,
    status,
    repositoryName: repo,
    commitSha: commitSha || "unknown",
    ref,
    deployedBy,
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
    ...(opts.description && { description: opts.description }),
    ...(opts["environment-type"] && { environmentType: (opts["environment-type"] as string).toUpperCase() }),
    ...(opts["external-id"] && { externalId: opts["external-id"] }),
    ...(opts.url && { metadata: { url: opts.url } }),
    source: ci?.provider || "cli",
    ...(opts["started-at"] && { startedAt: opts["started-at"] }),
    ...(opts["completed-at"] && { completedAt: opts["completed-at"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/deployments", body);

  if (result.ok) {
    formatSuccess(`Deployment recorded: ${environment}`, {
      id: result.data.id as string,
      environment,
      status: (opts.status as string) || "success",
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to record deployment: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
