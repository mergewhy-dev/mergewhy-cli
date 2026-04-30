/**
 * mergewhy expect — Pre-announce a deployment
 *
 * Usage:
 *   mergewhy expect --environment production --artifact-sha256 abc123...
 *   mergewhy expect --environment staging --artifact-sha256 abc123... --description "Release v2.1"
 *
 * Records an expected deployment so MergeWhy can track whether it actually occurs.
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function expectCommand(args: string[]): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

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
    formatError("--environment is required");
    process.exit(1);
  }

  const artifactSha256 = opts["artifact-sha256"] as string;
  if (!artifactSha256) {
    formatError("--artifact-sha256 is required");
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    environment,
    artifactSha256,
    status: "expected",
    ...(opts.description && { description: opts.description }),
    repositoryName: (opts.repo as string) || ci?.repo,
    commitSha: (opts.commit as string) || ci?.commitSha,
    source: ci?.provider || "cli",
    ...(ci && {
      ciContext: {
        provider: ci.provider,
        buildUrl: ci.buildUrl,
        buildId: ci.buildId,
        triggeredBy: ci.triggeredBy,
      },
    }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/deployments", body);

  if (result.ok) {
    formatSuccess("Deployment expected", {
      id: result.data.id as string,
      environment,
      artifact: artifactSha256.slice(0, 12) + "...",
      status: "expected",
    });
  } else {
    formatError(`Failed to record expected deployment: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy expect — Pre-announce a deployment

USAGE
  mergewhy expect --environment <env> --artifact-sha256 <sha>

OPTIONS
  --environment        Target deployment environment (required)
  --artifact-sha256    SHA-256 fingerprint of the artifact to deploy (required)
  --description        Description of the expected deployment
  --repo               Repository (auto-detected in CI)
  --commit             Commit SHA (auto-detected in CI)

EXAMPLES
  mergewhy expect --environment production --artifact-sha256 a1b2c3...
  mergewhy expect --environment staging --artifact-sha256 a1b2c3... --description "Release v2.1"
`.trim());
}
