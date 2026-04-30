/**
 * mergewhy search — Search for artifacts, DERs, or attestations by fingerprint or commit SHA
 *
 * Usage:
 *   mergewhy search --fingerprint abc123def456...
 *   mergewhy search --commit abc123def456
 *   mergewhy search --fingerprint abc123... --type artifact
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";

function formatTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("  (no results)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map(r => String(r[key] ?? "").length));
  }

  // Header
  const header = keys.map(k => k.toUpperCase().padEnd(widths[k])).join("  ");
  console.log(`  ${header}`);
  console.log(`  ${keys.map(k => "─".repeat(widths[k])).join("  ")}`);

  // Rows
  for (const row of rows) {
    const line = keys.map(k => String(row[k] ?? "").padEnd(widths[k])).join("  ");
    console.log(`  ${line}`);
  }
}

export async function searchCommand(args: string[]): Promise<void> {
  const config = loadConfig();

  // Parse arguments
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
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

  const fingerprint = opts.fingerprint as string | undefined;
  const commit = opts.commit as string | undefined;
  const type = opts.type as string | undefined;

  if (!fingerprint && !commit) {
    formatError("Either --fingerprint or --commit is required");
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (fingerprint) params.set("fingerprint", fingerprint);
  if (commit) params.set("commit", commit);
  if (type) params.set("type", type);

  const result = await apiRequest(config, "GET", `/api/v1/search?${params.toString()}`);

  if (!result.ok) {
    formatError(`Search failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const results = result.data.results as Record<string, unknown>[] | undefined;
  const total = result.data.total as number | undefined;

  formatSuccess(`Found ${total ?? results?.length ?? 0} result(s)`, {
    query: fingerprint ? `fingerprint:${fingerprint.slice(0, 12)}...` : `commit:${commit!.slice(0, 12)}...`,
  });

  if (results && results.length > 0) {
    const tableRows = results.map(r => ({
      type: r.type as string || "unknown",
      id: ((r.id as string) || "").slice(0, 12),
      name: r.name as string || r.prTitle as string || "-",
      status: r.status as string || r.passed ? "passed" : "failed",
      repo: r.repositoryName as string || r.repo as string || "-",
      created: r.createdAt ? new Date(r.createdAt as string).toISOString().slice(0, 10) : "-",
    }));
    console.log();
    formatTable(tableRows);
  }
}

function printHelp(): void {
  console.log(`
mergewhy search — Search for artifacts, DERs, or attestations

USAGE
  mergewhy search --fingerprint <sha256>    Search by artifact fingerprint
  mergewhy search --commit <sha>            Search by commit SHA
  mergewhy search --commit <sha> --type artifact   Filter by result type

OPTIONS
  --fingerprint    SHA-256 fingerprint to search for
  --commit         Git commit SHA to search for
  --type           Filter results by type (artifact, der, attestation)

EXAMPLES
  mergewhy search --fingerprint a1b2c3d4e5f6...
  mergewhy search --commit abc123
  mergewhy search --commit abc123 --type attestation
`.trim());
}
