/**
 * mergewhy attestation-type — Manage custom attestation types
 *
 * Usage:
 *   mergewhy attestation-type create --name "perf-test" --schema schema.json
 *   mergewhy attestation-type list
 *   mergewhy attestation-type get --name "perf-test"
 */

import { readFileSync } from "fs";
import { resolve } from "path";
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

function formatTable(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) {
    console.log("  (no attestation types found)");
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

export async function attestationTypeCommand(args: string[]): Promise<void> {
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

      const body: Record<string, unknown> = {
        name,
        description: (opts.description as string) || "",
      };

      if (opts.schema) {
        try {
          const schemaContent = readFileSync(resolve(opts.schema as string), "utf-8");
          body.schema = JSON.parse(schemaContent);
        } catch (err) {
          const message = err instanceof SyntaxError
            ? `Invalid JSON in schema file: ${opts.schema}`
            : `Schema file not found: ${opts.schema}`;
          formatError(message);
          process.exit(1);
        }
      }

      if (opts["jq-rule"]) {
        body.jqRule = opts["jq-rule"];
      }

      if (opts.version) body.schemaVersion = opts.version;

      const result = await apiRequest(config, "POST", "/api/v1/attestation-types", body);
      if (result.ok) {
        formatSuccess(`Attestation type created: ${name}`, {
          id: result.data.id as string,
          name,
        });
      } else {
        formatError(`Failed to create attestation type: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const params = new URLSearchParams();
      if (opts.limit) params.set("limit", opts.limit as string);

      const queryString = params.toString();
      const path = queryString ? `/api/v1/attestation-types?${queryString}` : "/api/v1/attestation-types";
      const result = await apiRequest(config, "GET", path);

      if (!result.ok) {
        formatError(`Failed to list attestation types: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const types = result.data.attestationTypes as Array<Record<string, unknown>> | undefined;
      const total = result.data.total as number | undefined;

      formatSuccess(`${total ?? types?.length ?? 0} attestation type(s) found`);
      console.log();

      if (types && types.length > 0) {
        const tableRows = types.map(t => ({
          name: t.name as string,
          description: ((t.description as string) || "").slice(0, 40),
          jqRule: t.jqRule ? ((t.jqRule as string).slice(0, 30) + (((t.jqRule as string).length > 30) ? "..." : "")) : "-",
          version: (t.schemaVersion as string) || "-",
          created: t.createdAt ? new Date(t.createdAt as string).toISOString().slice(0, 10) : "-",
        }));
        formatTable(tableRows);
      }
      break;
    }

    case "get": {
      const name = opts.name as string;
      const id = opts.id as string;
      if (!name && !id) {
        formatError("--name or --id is required");
        process.exit(1);
      }

      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (id) params.set("id", id);

      const result = await apiRequest(config, "GET", `/api/v1/attestation-types?${params.toString()}`);

      if (!result.ok) {
        formatError(`Failed to get attestation type: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const type = result.data.attestationType as Record<string, unknown> | undefined
        || (result.data.attestationTypes as Array<Record<string, unknown>> | undefined)?.[0];

      if (!type) {
        formatError(`Attestation type not found: ${name || id}`);
        process.exit(1);
      }

      formatSuccess(`Attestation type: ${type.name}`, {
        id: type.id as string,
        description: (type.description as string) || "(none)",
        version: (type.schemaVersion as string) || "-",
        hasSchema: type.schema ? "yes" : "no",
        jqRule: (type.jqRule as string) || "(none)",
        created: type.createdAt ? new Date(type.createdAt as string).toISOString() : "-",
      });
      break;
    }

    default:
      formatError(`Unknown subcommand "${subcommand}". Use: create, list, get`);
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attestation-type — Manage custom attestation types

USAGE
  mergewhy attestation-type create --name <name> [--schema <file>] [--jq-rule <expr>] [--description <desc>]
  mergewhy attestation-type list [--limit N]
  mergewhy attestation-type get --name <name>

SUBCOMMANDS
  create    Create a new attestation type with optional JSON schema and JQ evaluation rule
  list      List all attestation types
  get       Get details of a specific attestation type

OPTIONS
  --name          Attestation type name (required for create/get)
  --schema        Path to JSON schema file (for create)
  --jq-rule       JQ expression that must return true for attestation to pass compliance
  --description   Human-readable description
  --version       Schema version string
  --id            Attestation type ID (alternative to --name for get)
  --limit         Max results for list (default: 50)

JQ RULE SYNTAX
  Supports field access (.field), comparisons (<, >, ==, !=, <=, >=),
  boolean logic (and, or, not), array/string length (| length),
  null checks (.field != null), and parentheses for grouping.

EXAMPLES
  mergewhy attestation-type create --name "perf-test" --schema perf-schema.json
  mergewhy attestation-type create --name "perf-test" --jq-rule '.p99_latency < 500 and .error_rate < 0.01'
  mergewhy attestation-type create --name "security-scan" --description "Custom scan results"
  mergewhy attestation-type list
  mergewhy attestation-type get --name "perf-test"
`.trim());
}
