/**
 * mergewhy flow — Flow management (create, list, get)
 *
 * A flow represents a software delivery pipeline (e.g., "Payment Service", "API Gateway").
 * Flows track artifacts, attestations, and deployments through environments.
 *
 * Usage:
 *   mergewhy flow create --name "Payment Service" --description "Core payment processing"
 *   mergewhy flow create --name "API Gateway" --template flow-template.yaml
 *   mergewhy flow list
 *   mergewhy flow get --name "Payment Service"
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
    console.log("  (no flows found)");
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

export async function flowCommand(args: string[]): Promise<void> {
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

      // Load template if provided
      if (opts.template) {
        try {
          const templateContent = readFileSync(resolve(opts.template as string), "utf-8");
          body.template = templateContent;
        } catch {
          formatError(`Template file not found: ${opts.template}`);
          process.exit(1);
        }
      }

      if (opts.visibility) body.visibility = opts.visibility;
      if (opts.tags) body.tags = (opts.tags as string).split(",").map(t => t.trim());

      const result = await apiRequest(config, "POST", "/api/v1/flows", body);
      if (result.ok) {
        formatSuccess(`Flow created: ${name}`, {
          id: result.data.id as string,
          name,
        });
      } else {
        formatError(`Failed to create flow: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const params = new URLSearchParams();
      if (opts.limit) params.set("limit", opts.limit as string);
      if (opts.offset) params.set("offset", opts.offset as string);

      const queryString = params.toString();
      const path = queryString ? `/api/v1/flows?${queryString}` : "/api/v1/flows";
      const result = await apiRequest(config, "GET", path);

      if (!result.ok) {
        formatError(`Failed to list flows: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const flows = result.data.flows as Array<Record<string, unknown>> | undefined;
      const total = result.data.total as number | undefined;

      formatSuccess(`${total ?? flows?.length ?? 0} flow(s) found`);
      console.log();

      if (flows && flows.length > 0) {
        const tableRows = flows.map(f => ({
          name: f.name as string,
          description: ((f.description as string) || "").slice(0, 40),
          artifacts: f.artifactCount as number ?? 0,
          environments: f.environmentCount as number ?? 0,
          created: f.createdAt ? new Date(f.createdAt as string).toISOString().slice(0, 10) : "-",
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

      const result = await apiRequest(config, "GET", `/api/v1/flows?${params.toString()}`);

      if (!result.ok) {
        formatError(`Failed to get flow: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const flow = result.data.flow as Record<string, unknown> | undefined
        || (result.data.flows as Array<Record<string, unknown>> | undefined)?.[0];

      if (!flow) {
        formatError(`Flow not found: ${name || id}`);
        process.exit(1);
      }

      formatSuccess(`Flow: ${flow.name}`, {
        id: flow.id as string,
        description: (flow.description as string) || "(none)",
        artifacts: flow.artifactCount as number ?? 0,
        environments: flow.environmentCount as number ?? 0,
        created: flow.createdAt ? new Date(flow.createdAt as string).toISOString() : "-",
        updated: flow.updatedAt ? new Date(flow.updatedAt as string).toISOString() : "-",
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
mergewhy flow — Flow management

USAGE
  mergewhy flow create --name <name> [--description <desc>] [--template <file>]
  mergewhy flow list [--limit N] [--offset N]
  mergewhy flow get --name <name>

SUBCOMMANDS
  create    Create a new flow (delivery pipeline)
  list      List all flows
  get       Get details of a specific flow

OPTIONS
  --name          Flow name (required for create/get)
  --description   Flow description
  --template      Path to a flow template YAML file
  --tags          Comma-separated tags
  --visibility    Flow visibility (public, private)
  --id            Flow ID (alternative to --name for get)
  --limit         Max results for list (default: 50)
  --offset        Pagination offset for list

EXAMPLES
  mergewhy flow create --name "Payment Service" --description "Core payments"
  mergewhy flow create --name "API Gateway" --template gateway-flow.yaml
  mergewhy flow list
  mergewhy flow get --name "Payment Service"
`.trim());
}
