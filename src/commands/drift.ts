/**
 * mergewhy drift — Detect drift between expected and actual environment state
 *
 * Usage:
 *   mergewhy drift --environment production
 *   mergewhy drift --environment staging --repo owner/repo
 *   mergewhy drift --environment production --commit abc123
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
    console.log("  (no drift detected)");
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

export async function driftCommand(args: string[]): Promise<void> {
  const opts = parseOpts(args);

  if (opts.help || opts.h) {
    printHelp();
    return;
  }

  const ci = detectCI();

  const environment = (opts.environment as string) || (opts.env as string);
  if (!environment) {
    formatError("--environment is required (e.g., production, staging)");
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commit = (opts.commit as string) || ci?.commitSha;

  const params = new URLSearchParams({ environment });
  if (repo) params.set("repo", repo);
  if (commit) params.set("commit", commit);

  const config = loadConfig();
  const result = await apiRequest(config, "GET", `/api/v1/drift?${params.toString()}`);

  if (!result.ok) {
    formatError(`Drift detection failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const added = result.data.added as Array<Record<string, unknown>> | undefined;
  const removed = result.data.removed as Array<Record<string, unknown>> | undefined;
  const changed = result.data.changed as Array<Record<string, unknown>> | undefined;
  const driftDetected = (added?.length || 0) + (removed?.length || 0) + (changed?.length || 0) > 0;

  if (!driftDetected) {
    formatSuccess(`No drift detected in ${environment}`, {
      environment,
      ...(repo && { repo }),
    });
    return;
  }

  formatError(`Drift detected in ${environment}`, {
    added: added?.length ?? 0,
    removed: removed?.length ?? 0,
    changed: changed?.length ?? 0,
  });

  if (added && added.length > 0) {
    console.log();
    console.log("  Added artifacts:");
    const rows = added.map(a => ({
      name: (a.name as string) || "-",
      type: (a.type as string) || "-",
      fingerprint: ((a.fingerprint as string) || ((a.sha256 as string) || "-")).slice(0, 16),
    }));
    formatTable(rows);
  }

  if (removed && removed.length > 0) {
    console.log();
    console.log("  Removed artifacts:");
    const rows = removed.map(a => ({
      name: (a.name as string) || "-",
      type: (a.type as string) || "-",
      fingerprint: ((a.fingerprint as string) || ((a.sha256 as string) || "-")).slice(0, 16),
    }));
    formatTable(rows);
  }

  if (changed && changed.length > 0) {
    console.log();
    console.log("  Changed artifacts:");
    const rows = changed.map(a => ({
      name: (a.name as string) || "-",
      type: (a.type as string) || "-",
      previous: ((a.previousFingerprint as string) || "-").slice(0, 16),
      current: ((a.currentFingerprint as string) || "-").slice(0, 16),
    }));
    formatTable(rows);
  }

  process.exit(1);
}

function printHelp(): void {
  console.log(`
mergewhy drift — Detect drift between expected and actual environment state

USAGE
  mergewhy drift --environment <name> [--repo <owner/repo>] [--commit <sha>]

OPTIONS
  --environment   Environment name (required) — e.g., production, staging
  --repo          Scope to a specific repository
  --commit        Specific commit SHA to check against

EXAMPLES
  mergewhy drift --environment production
  mergewhy drift --environment staging --repo owner/repo
  mergewhy drift --environment production --commit abc123
`.trim());
}
