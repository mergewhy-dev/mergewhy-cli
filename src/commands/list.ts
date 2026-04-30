/**
 * mergewhy list — List resources
 *
 * Usage:
 *   mergewhy list artifacts [--repo owner/repo] [--limit 20]
 *   mergewhy list flows
 *   mergewhy list trails
 *   mergewhy list approvals
 *   mergewhy list environments
 *   mergewhy list attestation-types
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";

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

function formatTable(rows: Array<Record<string, string | number>>, emptyMessage: string): void {
  if (rows.length === 0) {
    console.log(`  (${emptyMessage})`);
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

interface ListResourceConfig {
  endpoint: string;
  responseKey: string;
  label: string;
  columns: Array<{ key: string; header: string; transform?: (v: unknown) => string }>;
}

const RESOURCES: Record<string, ListResourceConfig> = {
  artifacts: {
    endpoint: "/api/v1/artifacts",
    responseKey: "artifacts",
    label: "artifact",
    columns: [
      { key: "name", header: "name" },
      { key: "type", header: "type" },
      { key: "sha256", header: "fingerprint", transform: (v) => ((v as string) || "").slice(0, 16) },
      { key: "repository", header: "repo", transform: (v) => ((v as string) || "-").slice(0, 30) },
      { key: "createdAt", header: "created", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
  flows: {
    endpoint: "/api/v1/flows",
    responseKey: "flows",
    label: "flow",
    columns: [
      { key: "name", header: "name" },
      { key: "description", header: "description", transform: (v) => ((v as string) || "").slice(0, 40) },
      { key: "artifactCount", header: "artifacts" },
      { key: "environmentCount", header: "envs" },
      { key: "createdAt", header: "created", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
  trails: {
    endpoint: "/api/v1/trails",
    responseKey: "trails",
    label: "trail",
    columns: [
      { key: "name", header: "name" },
      { key: "status", header: "status" },
      { key: "flowName", header: "flow" },
      { key: "attestationCount", header: "attestations" },
      { key: "createdAt", header: "created", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
  approvals: {
    endpoint: "/api/v1/approvals",
    responseKey: "approvals",
    label: "approval",
    columns: [
      { key: "id", header: "id", transform: (v) => ((v as string) || "").slice(0, 12) },
      { key: "status", header: "status" },
      { key: "environment", header: "environment" },
      { key: "requestedBy", header: "requested by" },
      { key: "createdAt", header: "created", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
  environments: {
    endpoint: "/api/v1/environments",
    responseKey: "environments",
    label: "environment",
    columns: [
      { key: "name", header: "name" },
      { key: "type", header: "type" },
      { key: "artifactCount", header: "artifacts" },
      { key: "snapshotCount", header: "snapshots" },
      { key: "lastDeployedAt", header: "last deploy", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
  "attestation-types": {
    endpoint: "/api/v1/attestation-types",
    responseKey: "attestationTypes",
    label: "attestation type",
    columns: [
      { key: "name", header: "name" },
      { key: "description", header: "description", transform: (v) => ((v as string) || "").slice(0, 40) },
      { key: "schemaVersion", header: "version" },
      { key: "createdAt", header: "created", transform: (v) => v ? new Date(v as string).toISOString().slice(0, 10) : "-" },
    ],
  },
};

export async function listCommand(args: string[]): Promise<void> {
  const resourceType = args[0];

  if (!resourceType || resourceType === "--help" || resourceType === "-h") {
    printHelp();
    return;
  }

  const resourceConfig = RESOURCES[resourceType];
  if (!resourceConfig) {
    formatError(`Unknown resource type "${resourceType}". Use: ${Object.keys(RESOURCES).join(", ")}`);
    process.exit(1);
  }

  const opts = parseOpts(args.slice(1));

  if (opts.help || opts.h) {
    printHelp();
    return;
  }

  const config = loadConfig();

  const params = new URLSearchParams();
  const limit = (opts.limit as string) || "20";
  params.set("limit", limit);
  if (opts.repo) params.set("repo", opts.repo as string);
  if (opts.offset) params.set("offset", opts.offset as string);

  const result = await apiRequest(config, "GET", `${resourceConfig.endpoint}?${params.toString()}`);

  if (!result.ok) {
    formatError(`Failed to list ${resourceConfig.label}s: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const items = result.data[resourceConfig.responseKey] as Array<Record<string, unknown>> | undefined;
  const total = result.data.total as number | undefined;

  formatSuccess(`${total ?? items?.length ?? 0} ${resourceConfig.label}(s) found`);
  console.log();

  if (items && items.length > 0) {
    const tableRows = items.map(item => {
      const row: Record<string, string | number> = {};
      for (const col of resourceConfig.columns) {
        const value = item[col.key];
        row[col.header] = col.transform ? col.transform(value) : String(value ?? "-");
      }
      return row;
    });
    formatTable(tableRows, `no ${resourceConfig.label}s found`);
  }
}

function printHelp(): void {
  console.log(`
mergewhy list — List resources

USAGE
  mergewhy list <resource-type> [--repo <owner/repo>] [--limit N] [--output json]

RESOURCE TYPES
  artifacts           List build artifacts
  flows               List delivery flows
  trails              List delivery trails
  approvals           List deployment approvals
  environments        List environments
  attestation-types   List custom attestation types

OPTIONS
  --repo      Filter by repository
  --limit     Max results (default: 20)
  --offset    Pagination offset
  --output    Output format (json for machine-readable)

EXAMPLES
  mergewhy list artifacts --repo owner/repo
  mergewhy list flows --limit 50
  mergewhy list trails
  mergewhy list environments --output json
  mergewhy list attestation-types
`.trim());
}
