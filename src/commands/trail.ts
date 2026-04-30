/**
 * mergewhy trail — Create and manage delivery trails (end-to-end change tracking)
 *
 * Usage:
 *   mergewhy trail create --name "Release v2.1" --repo owner/repo
 *   mergewhy trail attest --trail-id abc123 --type TEST_RESULTS --name "Unit Tests" --passed
 *   mergewhy trail complete --trail-id abc123
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function trailCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "create":
      await trailCreate(args.slice(1));
      break;
    case "attest":
      await trailAttest(args.slice(1));
      break;
    case "complete":
      await trailComplete(args.slice(1));
      break;
    default:
      console.error("Usage: mergewhy trail <create|attest|complete> [options]");
      console.error("\nSubcommands:");
      console.error("  create    Create a new delivery trail");
      console.error("  attest    Add an attestation to a trail");
      console.error("  complete  Mark a trail as complete");
      process.exit(1);
  }
}

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

async function trailCreate(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();
  const opts = parseOpts(args);

  const name = opts.name as string;
  if (!name) {
    formatError("--name is required");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;

  const body: Record<string, unknown> = {
    name,
    repositoryName: repo,
    commitSha,
    ...(opts.description && { description: opts.description }),
    ...(opts.flow && { flowId: opts.flow }),
    source: ci?.provider || "cli",
  };

  const result = await apiRequest(config, "POST", "/api/v1/trails", body);

  if (result.ok) {
    formatSuccess(`Trail created: ${name}`, {
      id: result.data.id as string,
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to create trail: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

async function trailAttest(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();
  const opts = parseOpts(args);

  const trailId = opts["trail-id"] as string;
  if (!trailId) {
    formatError("--trail-id is required");
    process.exit(1);
  }

  const type = (opts.type as string || "").toUpperCase();
  const name = opts.name as string;
  if (!name) {
    formatError("--name is required");
    process.exit(1);
  }

  const passed = opts.passed === true || opts.passed === "true";
  const failed = opts.failed === true || opts.failed === "true";

  let evidence: Record<string, unknown> = {};
  if (opts.evidence) {
    try {
      evidence = JSON.parse(opts.evidence as string);
    } catch {
      formatError("--evidence must be valid JSON");
      process.exit(1);
    }
  }

  const body: Record<string, unknown> = {
    type: type || "CUSTOM",
    name,
    passed: passed && !failed,
    evidence,
    source: ci?.provider || "cli",
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
  };

  const result = await apiRequest(config, "POST", `/api/v1/trails/${trailId}/attestations`, body);

  if (result.ok) {
    formatSuccess(`Trail attestation added: ${name}`, {
      trailId,
      type: type || "CUSTOM",
      passed: String(passed && !failed),
    });
  } else {
    formatError(`Failed to add trail attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

async function trailComplete(args: string[]): Promise<void> {
  const config = loadConfig();
  const opts = parseOpts(args);

  const trailId = opts["trail-id"] as string;
  if (!trailId) {
    formatError("--trail-id is required");
    process.exit(1);
  }

  const result = await apiRequest(config, "PUT", `/api/v1/trails/${trailId}/complete`, {});

  if (result.ok) {
    formatSuccess(`Trail completed`, { trailId });
  } else {
    formatError(`Failed to complete trail: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
