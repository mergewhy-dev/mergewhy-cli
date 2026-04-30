/**
 * mergewhy artifact — Record a build artifact with SHA-256 fingerprint
 *
 * Usage:
 *   mergewhy artifact --name "api-server" --sha256 abc123... --commit def456 --repo owner/repo
 *   mergewhy artifact --name "web-app" --sha256 abc123... --type docker --tag v1.2.3
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function artifactCommand(args: string[]): Promise<void> {
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
    formatError("--name is required");
    process.exit(1);
  }

  const sha256 = opts.sha256 as string;
  if (!sha256) {
    formatError("--sha256 is required (SHA-256 fingerprint of the artifact)");
    process.exit(1);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    formatError("--sha256 must be a valid 64-character hex SHA-256 hash");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;

  const body: Record<string, unknown> = {
    name,
    sha256: sha256.toLowerCase(),
    artifactType: (opts.type as string) || "binary",
    ...(opts.tag && { tag: opts.tag }),
    ...(opts.registry && { registry: opts.registry }),
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
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

  const result = await apiRequest(config, "POST", "/api/v1/artifacts", body);

  if (result.ok) {
    formatSuccess(`Artifact recorded: ${name}`, {
      id: result.data.id as string,
      sha256: sha256.toLowerCase().slice(0, 12) + "...",
      type: (opts.type as string) || "binary",
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to record artifact: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
