/**
 * mergewhy rename — Rename a flow or environment
 *
 * Usage:
 *   mergewhy rename flow --name "Old Name" --new-name "New Name"
 *   mergewhy rename environment --name staging --new-name staging-v2
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

interface RenameResourceConfig {
  endpoint: string;
  label: string;
}

const RESOURCES: Record<string, RenameResourceConfig> = {
  flow: {
    endpoint: "/api/v1/flows",
    label: "Flow",
  },
  environment: {
    endpoint: "/api/v1/environments",
    label: "Environment",
  },
};

export async function renameCommand(args: string[]): Promise<void> {
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

  const name = opts.name as string;
  const newName = opts["new-name"] as string;

  if (!name) {
    formatError("--name is required");
    process.exit(1);
  }

  if (!newName) {
    formatError("--new-name is required");
    process.exit(1);
  }

  if (name === newName) {
    formatError("--name and --new-name must be different");
    process.exit(1);
  }

  const config = loadConfig();
  const result = await apiRequest(config, "PATCH", resourceConfig.endpoint, {
    name,
    newName,
  });

  if (!result.ok) {
    formatError(
      `Failed to rename ${resourceConfig.label.toLowerCase()}: ${result.data.error || result.status}`,
      result.data
    );
    process.exit(1);
  }

  formatSuccess(`${resourceConfig.label} renamed: "${name}" -> "${newName}"`);
}

function printHelp(): void {
  console.log(`
mergewhy rename — Rename a flow or environment

USAGE
  mergewhy rename flow --name <current-name> --new-name <new-name>
  mergewhy rename environment --name <current-name> --new-name <new-name>

RESOURCE TYPES
  flow          Rename a delivery flow
  environment   Rename an environment

OPTIONS
  --name        Current resource name (required)
  --new-name    New resource name (required)

EXAMPLES
  mergewhy rename flow --name "Payment Service" --new-name "Payment Service v2"
  mergewhy rename environment --name staging --new-name staging-v2
`.trim());
}
