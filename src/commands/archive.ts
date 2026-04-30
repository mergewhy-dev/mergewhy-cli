/**
 * mergewhy archive — Archive (soft-delete) a flow or environment
 *
 * Usage:
 *   mergewhy archive flow --name "Payment Service"
 *   mergewhy archive environment --name staging --force
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

async function confirmPrompt(message: string): Promise<boolean> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

interface ArchiveResourceConfig {
  endpoint: string;
  paramKey: string;
  label: string;
}

const RESOURCES: Record<string, ArchiveResourceConfig> = {
  flow: {
    endpoint: "/api/v1/flows",
    paramKey: "name",
    label: "Flow",
  },
  environment: {
    endpoint: "/api/v1/environments",
    paramKey: "name",
    label: "Environment",
  },
};

export async function archiveCommand(args: string[]): Promise<void> {
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
  if (!name) {
    formatError("--name is required");
    process.exit(1);
  }

  const force = !!opts.force;

  if (!force) {
    const confirmed = await confirmPrompt(
      `Are you sure you want to archive ${resourceConfig.label.toLowerCase()} "${name}"?`
    );
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const config = loadConfig();
  const params = new URLSearchParams({ [resourceConfig.paramKey]: name });
  const result = await apiRequest(config, "DELETE", `${resourceConfig.endpoint}?${params.toString()}`);

  if (!result.ok) {
    formatError(
      `Failed to archive ${resourceConfig.label.toLowerCase()}: ${result.data.error || result.status}`,
      result.data
    );
    process.exit(1);
  }

  formatSuccess(`${resourceConfig.label} archived: ${name}`);
}

function printHelp(): void {
  console.log(`
mergewhy archive — Archive (soft-delete) a flow or environment

USAGE
  mergewhy archive flow --name <name> [--force]
  mergewhy archive environment --name <name> [--force]

RESOURCE TYPES
  flow          Archive a delivery flow
  environment   Archive an environment

OPTIONS
  --name     Resource name (required)
  --force    Skip confirmation prompt

EXAMPLES
  mergewhy archive flow --name "Payment Service"
  mergewhy archive environment --name staging --force
`.trim());
}
