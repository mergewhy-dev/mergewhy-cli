/**
 * mergewhy get — Get details of a specific resource
 *
 * Usage:
 *   mergewhy get artifact --sha256 abc123...
 *   mergewhy get flow --name "Payment Service"
 *   mergewhy get trail --id abc123
 *   mergewhy get approval --id abc123
 *   mergewhy get environment --name production
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

interface ResourceConfig {
  endpoint: string;
  identifierFlag: string;
  identifierParam: string;
  label: string;
  responseKey: string;
  displayFields: Array<{ key: string; label: string; transform?: (v: unknown) => string }>;
}

const RESOURCES: Record<string, ResourceConfig> = {
  artifact: {
    endpoint: "/api/v1/artifacts",
    identifierFlag: "sha256",
    identifierParam: "sha256",
    label: "Artifact",
    responseKey: "artifact",
    displayFields: [
      { key: "id", label: "id" },
      { key: "name", label: "name" },
      { key: "type", label: "type" },
      { key: "sha256", label: "sha256" },
      { key: "tag", label: "tag" },
      { key: "repository", label: "repository" },
      { key: "commit", label: "commit" },
      { key: "createdAt", label: "created", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
    ],
  },
  flow: {
    endpoint: "/api/v1/flows",
    identifierFlag: "name",
    identifierParam: "name",
    label: "Flow",
    responseKey: "flow",
    displayFields: [
      { key: "id", label: "id" },
      { key: "name", label: "name" },
      { key: "description", label: "description" },
      { key: "artifactCount", label: "artifacts" },
      { key: "environmentCount", label: "environments" },
      { key: "createdAt", label: "created", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
      { key: "updatedAt", label: "updated", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
    ],
  },
  trail: {
    endpoint: "/api/v1/trails",
    identifierFlag: "id",
    identifierParam: "id",
    label: "Trail",
    responseKey: "trail",
    displayFields: [
      { key: "id", label: "id" },
      { key: "name", label: "name" },
      { key: "status", label: "status" },
      { key: "flowName", label: "flow" },
      { key: "attestationCount", label: "attestations" },
      { key: "createdAt", label: "created", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
      { key: "completedAt", label: "completed", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
    ],
  },
  approval: {
    endpoint: "/api/v1/approvals",
    identifierFlag: "id",
    identifierParam: "id",
    label: "Approval",
    responseKey: "approval",
    displayFields: [
      { key: "id", label: "id" },
      { key: "status", label: "status" },
      { key: "environment", label: "environment" },
      { key: "requestedBy", label: "requested by" },
      { key: "approvedBy", label: "approved by" },
      { key: "artifactSha256", label: "artifact" },
      { key: "createdAt", label: "created", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
    ],
  },
  environment: {
    endpoint: "/api/v1/environments",
    identifierFlag: "name",
    identifierParam: "name",
    label: "Environment",
    responseKey: "environment",
    displayFields: [
      { key: "id", label: "id" },
      { key: "name", label: "name" },
      { key: "type", label: "type" },
      { key: "artifactCount", label: "artifacts" },
      { key: "snapshotCount", label: "snapshots" },
      { key: "lastDeployedAt", label: "last deployed", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
      { key: "createdAt", label: "created", transform: (v) => v ? new Date(v as string).toISOString() : "-" },
    ],
  },
};

export async function getCommand(args: string[]): Promise<void> {
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

  const identifier = opts[resourceConfig.identifierFlag] as string;
  if (!identifier) {
    formatError(`--${resourceConfig.identifierFlag} is required for "get ${resourceType}"`);
    process.exit(1);
  }

  const config = loadConfig();
  const params = new URLSearchParams({ [resourceConfig.identifierParam]: identifier });
  const result = await apiRequest(config, "GET", `${resourceConfig.endpoint}?${params.toString()}`);

  if (!result.ok) {
    formatError(`Failed to get ${resourceConfig.label.toLowerCase()}: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const resource = result.data[resourceConfig.responseKey] as Record<string, unknown> | undefined
    || (result.data[`${resourceConfig.responseKey}s`] as Array<Record<string, unknown>> | undefined)?.[0];

  if (!resource) {
    formatError(`${resourceConfig.label} not found: ${identifier}`);
    process.exit(1);
  }

  const details: Record<string, unknown> = {};
  for (const field of resourceConfig.displayFields) {
    const value = resource[field.key];
    details[field.label] = field.transform ? field.transform(value) : (value ?? "(none)");
  }

  formatSuccess(`${resourceConfig.label}: ${resource.name || resource.id || identifier}`, details);
}

function printHelp(): void {
  console.log(`
mergewhy get — Get details of a specific resource

USAGE
  mergewhy get artifact --sha256 <fingerprint>
  mergewhy get flow --name <name>
  mergewhy get trail --id <trail-id>
  mergewhy get approval --id <approval-id>
  mergewhy get environment --name <name>

RESOURCE TYPES
  artifact      Get artifact by SHA-256 fingerprint
  flow          Get flow by name
  trail         Get trail by ID
  approval      Get approval by ID
  environment   Get environment by name

EXAMPLES
  mergewhy get artifact --sha256 a1b2c3d4e5f6...
  mergewhy get flow --name "Payment Service"
  mergewhy get trail --id trail_abc123
  mergewhy get approval --id approval_abc123
  mergewhy get environment --name production
`.trim());
}
