/**
 * mergewhy assert — Assertion commands for compliance verification
 *
 * Usage:
 *   mergewhy assert artifact --sha256 abc123... --environment production
 *   mergewhy assert snapshot --environment production
 *   mergewhy assert pullrequest github --repository owner/repo --commit abc123
 *   mergewhy assert approval --sha256 abc123... --environment production
 *
 * Exit codes:
 *   0 = assertion passed
 *   1 = assertion failed
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

export async function assertCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  switch (subcommand) {
    case "artifact":
      await assertArtifact(args.slice(1));
      break;
    case "snapshot":
      await assertSnapshot(args.slice(1));
      break;
    case "pullrequest":
    case "pr":
      await assertPullrequest(args.slice(1));
      break;
    case "approval":
      await assertApproval(args.slice(1));
      break;
    default:
      formatError(`Unknown subcommand "${subcommand}". Use: artifact, snapshot, pullrequest, approval`);
      process.exit(1);
  }
}

async function assertArtifact(args: string[]): Promise<void> {
  const config = loadConfig();
  const opts = parseOpts(args);

  const sha256 = opts.sha256 as string;
  if (!sha256) {
    formatError("--sha256 is required");
    process.exit(1);
  }

  const environment = (opts.environment as string) || (opts.env as string);

  const params = new URLSearchParams({ fingerprint: sha256 });
  const result = await apiRequest(config, "GET", `/api/v1/search?${params.toString()}`);

  if (!result.ok) {
    formatError(`Artifact lookup failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const artifacts = result.data.artifacts as Record<string, unknown>[] | undefined;
  if (!artifacts || artifacts.length === 0) {
    formatError("Artifact not found", {
      sha256: sha256.slice(0, 12) + "...",
    });
    process.exit(1);
  }

  const artifact = artifacts[0];
  const compliant = artifact.compliant as boolean | undefined;
  const complianceStatus = artifact.complianceStatus as string | undefined;

  if (compliant) {
    formatSuccess("Artifact is compliant", {
      sha256: sha256.slice(0, 12) + "...",
      status: complianceStatus || "passing",
      ...(environment && { environment }),
    });
    process.exit(0);
  } else {
    formatError("Artifact is NOT compliant", {
      sha256: sha256.slice(0, 12) + "...",
      status: complianceStatus || "failing",
      ...(environment && { environment }),
    });
    process.exit(1);
  }
}

async function assertSnapshot(args: string[]): Promise<void> {
  const config = loadConfig();
  const opts = parseOpts(args);

  const environment = (opts.environment as string) || (opts.env as string);
  if (!environment) {
    formatError("--environment is required");
    process.exit(1);
  }

  const params = new URLSearchParams({ name: environment });
  const result = await apiRequest(config, "GET", `/api/v1/environments?${params.toString()}`);

  if (!result.ok) {
    formatError(`Environment lookup failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const env = result.data as Record<string, unknown>;
  const latestSnapshot = env.latestSnapshot as Record<string, unknown> | undefined;

  if (!latestSnapshot) {
    formatError("No snapshot found for environment", { environment });
    process.exit(1);
  }

  const compliant = latestSnapshot.compliant as boolean | undefined;
  const artifactCount = latestSnapshot.artifactCount as number | undefined;
  const provenanceCount = latestSnapshot.provenanceCount as number | undefined;

  if (compliant) {
    formatSuccess("Environment snapshot is compliant", {
      environment,
      artifacts: artifactCount ?? 0,
      withProvenance: provenanceCount ?? 0,
    });
    process.exit(0);
  } else {
    formatError("Environment snapshot is NOT compliant", {
      environment,
      artifacts: artifactCount ?? 0,
      withProvenance: provenanceCount ?? 0,
      reason: "Not all artifacts have provenance",
    });
    process.exit(1);
  }
}

async function assertPullrequest(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

  const scmProvider = args[0]?.toLowerCase();
  if (!scmProvider || !["github", "gitlab", "bitbucket", "azure"].includes(scmProvider)) {
    formatError("SCM provider required. Valid providers: github, gitlab, bitbucket, azure");
    process.exit(1);
  }

  const opts = parseOpts(args.slice(1));

  const repository = (opts.repository as string) || (opts.repo as string) || ci?.repo;
  const commit = (opts.commit as string) || ci?.commitSha;

  if (!repository) {
    formatError("--repository is required (e.g., owner/repo)");
    process.exit(1);
  }
  if (!commit) {
    formatError("--commit is required");
    process.exit(1);
  }

  const params = new URLSearchParams({
    provider: scmProvider,
    repository,
    commit,
  });

  const result = await apiRequest(config, "GET", `/api/v1/search?${params.toString()}`);

  if (!result.ok) {
    formatError(`PR lookup failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const pullRequests = result.data.pullRequests as Record<string, unknown>[] | undefined;
  if (!pullRequests || pullRequests.length === 0) {
    formatError("No pull request found for commit", {
      repository,
      commit: commit.slice(0, 12) + "...",
      provider: scmProvider,
    });
    process.exit(1);
  }

  const pr = pullRequests[0];
  const approved = pr.approved as boolean | undefined;
  const reviewCount = pr.reviewCount as number | undefined;
  const approvalCount = pr.approvalCount as number | undefined;

  if (approved) {
    formatSuccess("Pull request is approved", {
      repository,
      commit: commit.slice(0, 12) + "...",
      provider: scmProvider,
      reviews: reviewCount ?? 0,
      approvals: approvalCount ?? 0,
    });
    process.exit(0);
  } else {
    formatError("Pull request is NOT approved", {
      repository,
      commit: commit.slice(0, 12) + "...",
      provider: scmProvider,
      reviews: reviewCount ?? 0,
      approvals: approvalCount ?? 0,
    });
    process.exit(1);
  }
}

async function assertApproval(args: string[]): Promise<void> {
  const config = loadConfig();
  const opts = parseOpts(args);

  const sha256 = opts.sha256 as string;
  const environment = (opts.environment as string) || (opts.env as string);

  if (!sha256) {
    formatError("--sha256 is required");
    process.exit(1);
  }
  if (!environment) {
    formatError("--environment is required");
    process.exit(1);
  }

  const params = new URLSearchParams({
    artifactSha256: sha256,
    environmentName: environment,
  });

  const result = await apiRequest(config, "GET", `/api/v1/approvals?${params.toString()}`);

  if (!result.ok) {
    formatError(`Approval check failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const approved = result.data.approved as boolean;

  if (approved) {
    formatSuccess("Artifact is approved for environment", {
      sha256: sha256.slice(0, 12) + "...",
      environment,
    });
    process.exit(0);
  } else {
    formatError("Artifact is NOT approved for environment", {
      sha256: sha256.slice(0, 12) + "...",
      environment,
    });
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy assert — Assertion commands for compliance verification

USAGE
  mergewhy assert artifact --sha256 <sha> [--environment <env>]
  mergewhy assert snapshot --environment <env>
  mergewhy assert pullrequest <github|gitlab|bitbucket|azure> --repository <repo> --commit <sha>
  mergewhy assert approval --sha256 <sha> --environment <env>

SUBCOMMANDS
  artifact       Verify artifact compliance by SHA-256 fingerprint
  snapshot       Verify environment snapshot compliance (all artifacts have provenance)
  pullrequest    Verify PR has required reviews/approvals (alias: pr)
  approval       Check if artifact is approved for environment

OPTIONS
  --sha256           SHA-256 fingerprint of the artifact (artifact, approval)
  --environment      Target environment name (snapshot, artifact, approval)
  --repository       Repository in owner/repo format (pullrequest, auto-detected in CI)
  --commit           Commit SHA (pullrequest, auto-detected in CI)

EXIT CODES
  0 = assertion passed (compliant / approved / reviewed)
  1 = assertion failed

EXAMPLES
  mergewhy assert artifact --sha256 a1b2c3... --environment production
  mergewhy assert snapshot --environment production
  mergewhy assert pullrequest github --repository owner/repo --commit abc123
  mergewhy assert approval --sha256 a1b2c3... --environment production
`.trim());
}
