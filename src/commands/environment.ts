/**
 * mergewhy environment — Environment management (create, list, log, diff)
 *
 * Environments represent deployment targets (production, staging, etc.).
 * Track what artifacts are running where and compare snapshots over time.
 *
 * Usage:
 *   mergewhy environment create --name production --type k8s
 *   mergewhy environment list
 *   mergewhy environment log --name production
 *   mergewhy environment diff --name production --from snap_123 --to snap_456
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";

const VALID_TYPES = ["k8s", "ecs", "lambda", "server", "docker", "custom"] as const;

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
    console.log("  (no results)");
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

export async function environmentCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const opts = parseOpts(args.slice(1));

  switch (subcommand) {
    case "create": {
      const name = opts.name as string;
      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }

      const envType = (opts.type as string || "custom").toLowerCase();
      if (!VALID_TYPES.includes(envType as typeof VALID_TYPES[number])) {
        formatError(`Invalid type "${envType}". Valid types: ${VALID_TYPES.join(", ")}`);
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        name,
        type: envType,
        ...(opts.description && { description: opts.description }),
        ...(opts.tags && { tags: (opts.tags as string).split(",").map(t => t.trim()) }),
        ...(opts["require-approval"] && { requireApproval: true }),
      };

      const result = await apiRequest(config, "POST", "/api/v1/environments", body);
      if (result.ok) {
        formatSuccess(`Environment created: ${name}`, {
          id: result.data.id as string,
          type: envType,
        });
      } else {
        formatError(`Failed to create environment: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const result = await apiRequest(config, "GET", "/api/v1/environments");
      if (!result.ok) {
        formatError(`Failed to list environments: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const environments = result.data.environments as Array<Record<string, unknown>> | undefined;
      formatSuccess(`${environments?.length ?? 0} environment(s) found`);
      console.log();

      if (environments && environments.length > 0) {
        const tableRows = environments.map(e => ({
          name: e.name as string,
          type: e.type as string || "-",
          artifacts: e.artifactCount as number ?? 0,
          lastDeployed: e.lastDeployedAt ? new Date(e.lastDeployedAt as string).toISOString().slice(0, 16) : "never",
          compliant: e.compliant ? "yes" : "no",
        }));
        formatTable(tableRows);
      }
      break;
    }

    case "log": {
      const name = opts.name as string;
      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }

      const params = new URLSearchParams({ name });
      if (opts.limit) params.set("limit", opts.limit as string);

      const result = await apiRequest(config, "GET", `/api/v1/environments/log?${params.toString()}`);
      if (!result.ok) {
        formatError(`Failed to get environment log: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const entries = result.data.entries as Array<Record<string, unknown>> | undefined;
      formatSuccess(`Environment log: ${name} (${entries?.length ?? 0} entries)`);
      console.log();

      if (entries && entries.length > 0) {
        const tableRows = entries.map(e => ({
          timestamp: e.timestamp ? new Date(e.timestamp as string).toISOString().slice(0, 19) : "-",
          event: e.event as string || e.type as string || "-",
          artifact: ((e.artifactSha256 as string) || "").slice(0, 12) || "-",
          description: ((e.description as string) || "").slice(0, 50),
          snapshot: ((e.snapshotId as string) || "").slice(0, 12) || "-",
        }));
        formatTable(tableRows);
      }
      break;
    }

    case "diff": {
      const name = opts.name as string;
      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }

      const from = opts.from as string;
      const to = opts.to as string;
      if (!from || !to) {
        formatError("Both --from and --to snapshot IDs are required");
        process.exit(1);
      }

      const params = new URLSearchParams({ name, from, to });
      const result = await apiRequest(config, "GET", `/api/v1/environments/diff?${params.toString()}`);

      if (!result.ok) {
        formatError(`Failed to diff environments: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const diff = result.data;
      formatSuccess(`Environment diff: ${name}`, {
        from: from.slice(0, 12),
        to: to.slice(0, 12),
      });
      console.log();

      const added = diff.added as Array<Record<string, unknown>> | undefined;
      const removed = diff.removed as Array<Record<string, unknown>> | undefined;
      const changed = diff.changed as Array<Record<string, unknown>> | undefined;

      if (added && added.length > 0) {
        console.log(`  \x1b[32m+ Added (${added.length}):\x1b[0m`);
        for (const a of added) {
          console.log(`    + ${a.name || a.artifactSha256 || a.id}`);
        }
      }

      if (removed && removed.length > 0) {
        console.log(`  \x1b[31m- Removed (${removed.length}):\x1b[0m`);
        for (const r of removed) {
          console.log(`    - ${r.name || r.artifactSha256 || r.id}`);
        }
      }

      if (changed && changed.length > 0) {
        console.log(`  \x1b[33m~ Changed (${changed.length}):\x1b[0m`);
        for (const c of changed) {
          console.log(`    ~ ${c.name || c.id}: ${c.from || "?"} -> ${c.to || "?"}`);
        }
      }

      if (!added?.length && !removed?.length && !changed?.length) {
        console.log("  No differences found between snapshots.");
      }
      break;
    }

    default:
      formatError(`Unknown subcommand "${subcommand}". Use: create, list, log, diff`);
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy environment — Environment management

USAGE
  mergewhy environment create --name <name> --type <type>
  mergewhy environment list
  mergewhy environment log --name <name> [--limit N]
  mergewhy environment diff --name <name> --from <snapshot> --to <snapshot>

SUBCOMMANDS
  create    Create a new environment
  list      List all environments
  log       View deployment log for an environment
  diff      Compare two environment snapshots

ENVIRONMENT TYPES
  k8s, ecs, lambda, server, docker, custom

OPTIONS
  --name               Environment name (required for create/log/diff)
  --type               Environment type (default: custom)
  --description        Environment description
  --tags               Comma-separated tags
  --require-approval   Require approval before deployment
  --from               Source snapshot ID (for diff)
  --to                 Target snapshot ID (for diff)
  --limit              Max log entries to return

EXAMPLES
  mergewhy environment create --name production --type k8s
  mergewhy environment create --name staging --type ecs --require-approval
  mergewhy environment list
  mergewhy environment log --name production --limit 20
  mergewhy environment diff --name production --from snap_abc --to snap_def
`.trim());
}
