/**
 * mergewhy tag — Tag resources with metadata labels
 *
 * Usage:
 *   mergewhy tag --resource-type artifact --resource-id abc123 --tags "release:v2.1,team:payments"
 *   mergewhy tag --resource-type trail --resource-id def456 --tags "sprint:42"
 *   mergewhy tag --resource-type environment --resource-id prod-01 --tags "tier:critical"
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function tagCommand(args: string[]): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const ci = detectCI();

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

  const resourceType = opts["resource-type"] as string;
  if (!resourceType || !["artifact", "trail", "environment"].includes(resourceType)) {
    formatError("--resource-type is required (artifact, trail, or environment)");
    process.exit(1);
  }

  const resourceId = opts["resource-id"] as string;
  if (!resourceId) {
    formatError("--resource-id is required");
    process.exit(1);
  }

  const tagsRaw = opts.tags as string;
  if (!tagsRaw) {
    formatError("--tags is required (comma-separated, e.g., 'release:v2.1,team:payments')");
    process.exit(1);
  }

  const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length === 0) {
    formatError("--tags must contain at least one tag");
    process.exit(1);
  }

  // Convert tags to key-value pairs
  const tagMap: Record<string, string> = {};
  for (const tag of tags) {
    const colonIndex = tag.indexOf(":");
    if (colonIndex > 0) {
      tagMap[tag.slice(0, colonIndex)] = tag.slice(colonIndex + 1);
    } else {
      tagMap[tag] = "true";
    }
  }

  const body: Record<string, unknown> = {
    type: "tag",
    name: `tag:${resourceType}:${resourceId}`,
    resourceType,
    resourceId,
    evidence: {
      tags: tagMap,
      tagList: tags,
    },
    source: ci?.provider || "cli",
    ...(ci?.repo && { repositoryName: ci.repo }),
    ...(ci?.commitSha && { commitSha: ci.commitSha }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`Tagged ${resourceType}`, {
      resourceId,
      tags: tags.join(", "),
    });
  } else {
    formatError(`Failed to tag resource: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy tag — Tag resources with metadata labels

USAGE
  mergewhy tag --resource-type <type> --resource-id <id> --tags <tags>

OPTIONS
  --resource-type    Resource type: artifact, trail, or environment (required)
  --resource-id      Resource identifier (required)
  --tags             Comma-separated tags, optionally key:value (required)

EXAMPLES
  mergewhy tag --resource-type artifact --resource-id abc123 --tags "release:v2.1,team:payments"
  mergewhy tag --resource-type trail --resource-id def456 --tags "sprint:42"
  mergewhy tag --resource-type environment --resource-id prod-01 --tags "tier:critical,region:us-east-1"
`.trim());
}
