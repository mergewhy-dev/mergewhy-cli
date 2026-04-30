/**
 * mergewhy allow — Artifact allowlisting for environment compliance
 *
 * Allowlist an artifact to bypass policy checks for a specific environment.
 * Useful for third-party vendor images or known-good artifacts that don't
 * pass through your standard CI/CD pipeline.
 *
 * Usage:
 *   mergewhy allow --artifact-sha256 abc... --environment production --reason "Third-party vendor image"
 *   mergewhy allow --artifact-sha256 abc... --environment staging --reason "Legacy migration" --expires 2026-06-01
 *   mergewhy allow list --environment production
 *   mergewhy allow remove --artifact-sha256 abc... --environment production
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

function formatTable(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) {
    console.log("  (no entries)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map(r => String(r[key] ?? "").length));
  }

  const header = keys.map(k => k.toUpperCase().padEnd(widths[k])).join("  ");
  console.log(`  ${header}`);
  console.log(`  ${keys.map(k => "─".repeat(widths[k])).join("  ")}`);
  for (const row of rows) {
    const line = keys.map(k => String(row[k] ?? "").padEnd(widths[k])).join("  ");
    console.log(`  ${line}`);
  }
}

export async function allowCommand(args: string[]): Promise<void> {
  const firstArg = args[0];

  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const ci = detectCI();

  // Check if first arg is a subcommand
  if (firstArg === "list") {
    const opts = parseOpts(args.slice(1));
    const params = new URLSearchParams();
    if (opts.environment) params.set("environment", opts.environment as string);
    if (opts.limit) params.set("limit", opts.limit as string);

    const queryString = params.toString();
    const path = queryString ? `/api/v1/allowlist?${queryString}` : "/api/v1/allowlist";
    const result = await apiRequest(config, "GET", path);

    if (!result.ok) {
      formatError(`Failed to list allowlist: ${result.data.error || result.status}`, result.data);
      process.exit(1);
    }

    const entries = result.data.entries as Array<Record<string, unknown>> | undefined;
    formatSuccess(`${entries?.length ?? 0} allowlist entry(ies)`);
    console.log();

    if (entries && entries.length > 0) {
      const tableRows = entries.map(e => ({
        artifact: ((e.artifactSha256 as string) || "").slice(0, 16) + "...",
        environment: e.environment as string || "-",
        reason: ((e.reason as string) || "").slice(0, 40),
        addedBy: e.addedBy as string || "-",
        expires: e.expiresAt ? new Date(e.expiresAt as string).toISOString().slice(0, 10) : "never",
      }));
      formatTable(tableRows);
    }
    return;
  }

  if (firstArg === "remove") {
    const opts = parseOpts(args.slice(1));
    const artifactSha256 = opts["artifact-sha256"] as string;
    const environment = opts.environment as string;

    if (!artifactSha256) {
      formatError("--artifact-sha256 is required");
      process.exit(1);
    }
    if (!environment) {
      formatError("--environment is required");
      process.exit(1);
    }

    const body: Record<string, unknown> = {
      artifactSha256,
      environment,
      action: "remove",
    };

    const result = await apiRequest(config, "POST", "/api/v1/allowlist", body);
    if (result.ok) {
      formatSuccess("Allowlist entry removed", {
        environment,
        artifact: artifactSha256.slice(0, 16) + "...",
      });
    } else {
      formatError(`Failed to remove allowlist entry: ${result.data.error || result.status}`, result.data);
      process.exit(1);
    }
    return;
  }

  // Default: add to allowlist
  const opts = parseOpts(args);
  const artifactSha256 = opts["artifact-sha256"] as string;
  const environment = (opts.environment as string) || (opts.env as string);
  const reason = opts.reason as string;

  if (!artifactSha256) {
    formatError("--artifact-sha256 is required");
    process.exit(1);
  }
  if (!environment) {
    formatError("--environment is required");
    process.exit(1);
  }
  if (!reason) {
    formatError("--reason is required (explain why this artifact is allowed)");
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    artifactSha256,
    environment,
    reason,
    addedBy: ci?.triggeredBy || (opts["added-by"] as string) || "cli",
    ...(opts.expires && { expiresAt: new Date(opts.expires as string).toISOString() }),
    ...(opts.name && { artifactName: opts.name }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/allowlist", body);

  if (result.ok) {
    formatSuccess("Artifact added to allowlist", {
      environment,
      artifact: artifactSha256.slice(0, 16) + "...",
      reason,
      ...(opts.expires && { expires: opts.expires as string }),
    });
  } else {
    formatError(`Failed to add to allowlist: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy allow — Artifact allowlisting for environment compliance

USAGE
  mergewhy allow --artifact-sha256 <sha> --environment <env> --reason <text>
  mergewhy allow list [--environment <env>]
  mergewhy allow remove --artifact-sha256 <sha> --environment <env>

SUBCOMMANDS
  (default)   Add an artifact to the allowlist
  list        List allowlisted artifacts
  remove      Remove an artifact from the allowlist

OPTIONS
  --artifact-sha256   SHA-256 fingerprint of the artifact (required)
  --environment       Target environment (required)
  --reason            Reason for allowlisting (required for add)
  --name              Human-readable artifact name
  --expires           Expiration date (ISO format, e.g., 2026-06-01)
  --added-by          Person adding the allowlist entry (auto-detected in CI)
  --limit             Max results for list

EXAMPLES
  mergewhy allow --artifact-sha256 a1b2c3... --environment production --reason "Third-party vendor image"
  mergewhy allow --artifact-sha256 a1b2c3... --environment staging --reason "Legacy" --expires 2026-06-01
  mergewhy allow list --environment production
  mergewhy allow remove --artifact-sha256 a1b2c3... --environment production
`.trim());
}
