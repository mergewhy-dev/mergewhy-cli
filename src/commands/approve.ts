/**
 * mergewhy approve — Approval workflow for artifact deployments
 *
 * Usage:
 *   mergewhy approve request --artifact-sha256 abc... --environment production
 *   mergewhy approve report --artifact-sha256 abc... --environment production --approver "john@example.com"
 *   mergewhy approve check --artifact-sha256 abc... --environment production
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

function parseOpts(args: string[]): Record<string, string | boolean> {
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
  return opts;
}

export async function approveCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const ci = detectCI();
  const opts = parseOpts(args.slice(1));

  const artifactSha256 = opts["artifact-sha256"] as string;
  const environment = (opts.environment as string) || (opts.env as string);

  if (!artifactSha256) {
    formatError("--artifact-sha256 is required");
    process.exit(1);
  }
  if (!environment) {
    formatError("--environment is required");
    process.exit(1);
  }

  switch (subcommand) {
    case "request": {
      const body: Record<string, unknown> = {
        artifactSha256,
        environment,
        requestedBy: (opts["requested-by"] as string) || ci?.triggeredBy || "cli",
        repo: (opts.repo as string) || ci?.repo,
        commitSha: (opts.commit as string) || ci?.commitSha,
        ...(opts.description && { description: opts.description }),
      };

      const result = await apiRequest(config, "POST", "/api/v1/approvals", body);
      if (result.ok) {
        formatSuccess("Approval requested", {
          id: result.data.id as string,
          environment,
          artifact: artifactSha256.slice(0, 12) + "...",
        });
      } else {
        formatError(`Failed to request approval: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "report": {
      const approver = opts.approver as string;
      if (!approver) {
        formatError("--approver is required for approval reporting");
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        artifactSha256,
        environment,
        approver,
        approved: opts.rejected !== true,
        ...(opts.reason && { reason: opts.reason }),
      };

      const result = await apiRequest(config, "POST", "/api/v1/approvals", body);
      if (result.ok) {
        formatSuccess(`Approval ${opts.rejected ? "rejected" : "recorded"}`, {
          environment,
          approver,
          artifact: artifactSha256.slice(0, 12) + "...",
        });
      } else {
        formatError(`Failed to report approval: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "check": {
      const params = new URLSearchParams({
        artifactSha256,
        environment,
      });

      const result = await apiRequest(config, "GET", `/api/v1/approvals?${params.toString()}`);
      if (!result.ok) {
        formatError(`Failed to check approval: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const approved = result.data.approved as boolean;
      const approvals = result.data.approvals as Record<string, unknown>[] | undefined;

      if (approved) {
        formatSuccess("Artifact is approved for deployment", {
          environment,
          artifact: artifactSha256.slice(0, 12) + "...",
          approvalCount: approvals?.length ?? 0,
        });
        process.exit(0);
      } else {
        formatError("Artifact is NOT approved for deployment", {
          environment,
          artifact: artifactSha256.slice(0, 12) + "...",
          pending: result.data.pendingApprovers ?? "unknown",
        });
        process.exit(1);
      }
      break;
    }

    default:
      formatError(`Unknown subcommand "${subcommand}". Use: request, report, check`);
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy approve — Approval workflow for artifact deployments

USAGE
  mergewhy approve request --artifact-sha256 <sha> --environment <env>
  mergewhy approve report --artifact-sha256 <sha> --environment <env> --approver <email>
  mergewhy approve check --artifact-sha256 <sha> --environment <env>

SUBCOMMANDS
  request    Request approval for deploying an artifact to an environment
  report     Record an approval decision (approve or --rejected)
  check      Check approval status (exit 0 = approved, exit 1 = not approved)

OPTIONS
  --artifact-sha256    SHA-256 fingerprint of the artifact (required)
  --environment        Target deployment environment (required)
  --approver           Email of the person approving (required for report)
  --rejected           Mark as rejected instead of approved (report only)
  --reason             Reason for approval or rejection
  --description        Description of the approval request (request only)
  --repo               Repository (auto-detected in CI)
  --commit             Commit SHA (auto-detected in CI)

EXAMPLES
  mergewhy approve request --artifact-sha256 a1b2c3... --environment production
  mergewhy approve report --artifact-sha256 a1b2c3... --environment production --approver "cto@example.com"
  mergewhy approve check --artifact-sha256 a1b2c3... --environment production && deploy.sh
`.trim());
}
