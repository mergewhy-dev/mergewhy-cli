/**
 * mergewhy snapshot — Capture a runtime environment snapshot
 *
 * Usage:
 *   mergewhy snapshot docker --environment production
 *   mergewhy snapshot kubernetes --environment staging --namespace default
 *   mergewhy snapshot ecs --environment production --cluster my-cluster
 *   mergewhy snapshot lambda --environment production --region us-east-1
 *   mergewhy snapshot s3 --bucket my-bucket --region us-east-1
 *   mergewhy snapshot azure --resource-group mygroup --subscription-id xxx
 *   mergewhy snapshot path --path /opt/myapp --exclude "*.log"
 *   mergewhy snapshot paths --config paths.json
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";
const VALID_TYPES = ["docker", "kubernetes", "ecs", "lambda", "s3", "azure", "path", "paths"] as const;

// Map CLI types to API-expected type values
const TYPE_MAP: Record<string, string> = {
  docker: "docker",
  kubernetes: "k8s",
  ecs: "ecs",
  lambda: "lambda",
  s3: "s3",
  azure: "azure",
  path: "server",
  paths: "server",
};

// API-expected status values
type ArtifactStatus = "running" | "pending" | "stopped";

interface ArtifactInfo {
  name: string;
  image: string;
  tag: string;
  digest: string;
  status: ArtifactStatus;
  metadata?: Record<string, string>;
}

export async function snapshotCommand(args: string[]): Promise<void> {
  const config = loadConfig();

  // First positional arg is snapshot type
  const snapshotType = args[0]?.toLowerCase();
  if (!snapshotType || !VALID_TYPES.includes(snapshotType as typeof VALID_TYPES[number])) {
    formatError(`Snapshot type required. Valid types: ${VALID_TYPES.join(", ")}`);
    console.error("\nUsage: mergewhy snapshot <type> [options]");
    process.exit(1);
  }

  const opts: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
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

  const environment = (opts.environment as string) || (opts.env as string) || "default";
  const watchMode = opts.watch === true;
  const intervalSeconds = opts.interval ? parseInt(opts.interval as string, 10) : 60;

  if (watchMode && snapshotType !== "path") {
    formatError("--watch is only supported for the 'path' subcommand");
    process.exit(1);
  }

  if (watchMode) {
    await runWatchMode(config, opts, args, environment, intervalSeconds);
    return;
  }

  let artifacts: ArtifactInfo[] = [];

  try {
    switch (snapshotType) {
      case "docker":
        artifacts = captureDocker();
        break;
      case "kubernetes":
        artifacts = captureKubernetes(opts.namespace as string);
        break;
      case "ecs":
        artifacts = await captureECS(opts.cluster as string, opts.region as string);
        break;
      case "lambda":
        artifacts = await captureLambda(opts.region as string);
        break;
      case "s3":
        artifacts = captureS3(opts.bucket as string, opts.region as string);
        break;
      case "azure":
        artifacts = captureAzure(opts["resource-group"] as string, opts["subscription-id"] as string);
        break;
      case "path":
        artifacts = captureFilesystemPath(opts.path as string, collectExcludes(args));
        break;
      case "paths":
        artifacts = captureMultiPath(opts.config as string);
        break;
    }
  } catch (err) {
    formatError(`Failed to capture ${snapshotType} snapshot: ${(err as Error).message}`);
    process.exit(1);
  }

  const submitted = await submitSnapshot(config, snapshotType, environment, artifacts, opts);
  if (!submitted) {
    process.exit(1);
  }
}

async function submitSnapshot(
  config: ReturnType<typeof loadConfig>,
  snapshotType: string,
  environment: string,
  artifacts: ArtifactInfo[],
  opts: Record<string, string | boolean>,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    type: TYPE_MAP[snapshotType] || snapshotType,
    environment,
    capturedAt: new Date().toISOString(),
    artifacts,
    ...(opts["collector-id"] && { collectorId: opts["collector-id"] }),
    ...(opts.signature && { signature: opts.signature }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/snapshots", body);

  if (result.ok) {
    formatSuccess(`Snapshot captured: ${snapshotType} (${environment})`, {
      id: result.data.id as string,
      artifacts: `${artifacts.length} running`,
      environment,
    });
    return true;
  } else {
    formatError(`Failed to submit snapshot: ${result.data.error || result.status}`, result.data);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Watch mode — continuous filesystem monitoring
// ---------------------------------------------------------------------------

interface SnapshotDigestMap {
  /** Map of relative path → SHA-256 digest */
  digests: Map<string, string>;
  /** Overall directory fingerprint */
  fingerprint: string;
}

function buildDigestMap(artifacts: ArtifactInfo[]): SnapshotDigestMap {
  const digests = new Map<string, string>();
  let fingerprint = "";
  for (const a of artifacts) {
    if (a.image.endsWith(" files")) {
      // This is the summary artifact
      fingerprint = a.digest;
    } else {
      digests.set(a.name, a.digest);
    }
  }
  return { digests, fingerprint };
}

function diffSnapshots(
  prev: SnapshotDigestMap,
  curr: SnapshotDigestMap,
): { added: string[]; removed: string[]; modified: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [path, digest] of curr.digests) {
    const prevDigest = prev.digests.get(path);
    if (!prevDigest) {
      added.push(path);
    } else if (prevDigest !== digest) {
      modified.push(path);
    }
  }

  for (const path of prev.digests.keys()) {
    if (!curr.digests.has(path)) {
      removed.push(path);
    }
  }

  return { added, removed, modified };
}

async function runWatchMode(
  config: ReturnType<typeof loadConfig>,
  opts: Record<string, string | boolean>,
  args: string[],
  environment: string,
  intervalSeconds: number,
): Promise<void> {
  const targetPath = opts.path as string;
  if (!targetPath) {
    formatError("--path is required for path snapshot in watch mode");
    process.exit(1);
  }

  const excludes = collectExcludes(args);
  let shutdownRequested = false;

  const shutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log("\nShutting down watch mode...");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[watch] Monitoring ${targetPath} every ${intervalSeconds}s`);
  console.log(`[watch] Press Ctrl+C to stop\n`);

  // Initial snapshot
  let prevArtifacts = captureFilesystemPath(targetPath, excludes);
  let prevMap = buildDigestMap(prevArtifacts);

  const ok = await submitSnapshot(config, "path", environment, prevArtifacts, opts);
  if (!ok) {
    console.error("[watch] Initial snapshot failed, continuing anyway...");
  }

  while (!shutdownRequested) {
    // Interruptible sleep
    const sleepEnd = Date.now() + intervalSeconds * 1000;
    while (Date.now() < sleepEnd && !shutdownRequested) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (shutdownRequested) break;

    try {
      const currArtifacts = captureFilesystemPath(targetPath, excludes);
      const currMap = buildDigestMap(currArtifacts);

      if (currMap.fingerprint === prevMap.fingerprint) {
        const ts = new Date().toISOString();
        console.log(`[watch] ${ts} — no changes detected`);
        continue;
      }

      const diff = diffSnapshots(prevMap, currMap);
      const ts = new Date().toISOString();
      console.log(`[watch] ${ts} — changes detected:`);
      if (diff.added.length > 0) console.log(`  Added:    ${diff.added.length} file(s)`);
      if (diff.modified.length > 0) console.log(`  Modified: ${diff.modified.length} file(s)`);
      if (diff.removed.length > 0) console.log(`  Removed:  ${diff.removed.length} file(s)`);

      await submitSnapshot(config, "path", environment, currArtifacts, opts);

      prevArtifacts = currArtifacts;
      prevMap = currMap;
    } catch (err) {
      console.error(`[watch] Error during re-snapshot: ${(err as Error).message}`);
    }
  }

  console.log("[watch] Stopped.");
}

function captureDocker(): ArtifactInfo[] {
  const output = execSync('docker ps --format "{{json .}}"', { encoding: "utf-8" });
  const lines = output.trim().split("\n").filter(Boolean);

  return lines.map((line) => {
    const container = JSON.parse(line) as Record<string, string>;
    const image = container.Image || "";
    const tag = image.includes(":") ? image.split(":").pop()! : "latest";
    return {
      name: container.Names || container.Name || "",
      image,
      tag,
      digest: container.ID || "unknown",
      status: "running" as ArtifactStatus,
      metadata: {
        ...(container.Ports && { ports: container.Ports }),
        ...(container.CreatedAt && { created: container.CreatedAt }),
      },
    };
  });
}

function captureKubernetes(namespace?: string): ArtifactInfo[] {
  const ns = namespace || "default";
  const output = execSync(`kubectl get pods -n ${ns} -o json`, { encoding: "utf-8" });
  const data = JSON.parse(output) as { items: Array<Record<string, unknown>> };

  const artifacts: ArtifactInfo[] = [];
  for (const pod of data.items) {
    const metadata = pod.metadata as Record<string, unknown>;
    const spec = pod.spec as Record<string, unknown>;
    const status = pod.status as Record<string, unknown>;
    const containers = (spec?.containers || []) as Array<Record<string, unknown>>;
    const containerStatuses = (status?.containerStatuses || []) as Array<Record<string, unknown>>;

    for (const container of containers) {
      const cs = containerStatuses.find((s) => s.name === container.name);
      const image = container.image as string;
      const tag = image.includes(":") ? image.split(":").pop()! : "latest";
      artifacts.push({
        name: `${metadata?.name}/${container.name}`,
        image,
        tag,
        digest: (cs?.imageID as string) || "unknown",
        status: cs ? "running" as ArtifactStatus : "pending" as ArtifactStatus,
      });
    }
  }

  return artifacts;
}

async function captureECS(cluster?: string, region?: string): Promise<ArtifactInfo[]> {
  const clusterName = cluster || "default";
  const reg = region || process.env.AWS_DEFAULT_REGION || "us-east-1";

  const tasksOutput = execSync(
    `aws ecs list-tasks --cluster ${clusterName} --region ${reg} --output json`,
    { encoding: "utf-8" }
  );
  const { taskArns } = JSON.parse(tasksOutput) as { taskArns: string[] };

  if (!taskArns?.length) return [];

  const descOutput = execSync(
    `aws ecs describe-tasks --cluster ${clusterName} --tasks ${taskArns.join(" ")} --region ${reg} --output json`,
    { encoding: "utf-8" }
  );
  const { tasks } = JSON.parse(descOutput) as { tasks: Array<Record<string, unknown>> };

  const artifacts: ArtifactInfo[] = [];
  for (const task of tasks) {
    const containers = (task.containers || []) as Array<Record<string, unknown>>;
    for (const container of containers) {
      const image = (container.image as string) || "";
      const tag = image.includes(":") ? image.split(":").pop()! : "latest";
      artifacts.push({
        name: container.name as string,
        image,
        tag,
        digest: (container.imageDigest as string) || "unknown",
        status: "running" as ArtifactStatus,
      });
    }
  }

  return artifacts;
}

async function captureLambda(region?: string): Promise<ArtifactInfo[]> {
  const reg = region || process.env.AWS_DEFAULT_REGION || "us-east-1";

  const output = execSync(
    `aws lambda list-functions --region ${reg} --output json`,
    { encoding: "utf-8" }
  );
  const { Functions } = JSON.parse(output) as { Functions: Array<Record<string, unknown>> };

  return (Functions || []).map((fn) => ({
    name: fn.FunctionName as string,
    image: (fn.PackageType as string) === "Image" ? (fn.CodeSha256 as string) : (fn.Runtime as string) || "",
    tag: (fn.Version as string) || "$LATEST",
    digest: (fn.CodeSha256 as string) || "unknown",
    status: "running" as ArtifactStatus,
    metadata: {
      ...(fn.State && { state: fn.State as string }),
      ...(fn.Runtime && { runtime: fn.Runtime as string }),
    },
  }));
}

// --- S3 snapshot ---

interface S3Object {
  date: string;
  time: string;
  size: string;
  key: string;
}

function parseS3Listing(output: string): S3Object[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // Format: "2024-01-15 12:34:56    1234 path/to/file.txt"
      const match = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { date: match[1], time: match[2], size: match[3], key: match[4] };
    })
    .filter((obj): obj is S3Object => obj !== null);
}

function captureS3(bucket?: string, region?: string): ArtifactInfo[] {
  if (!bucket) {
    throw new Error("--bucket is required for s3 snapshot");
  }
  const reg = region || process.env.AWS_DEFAULT_REGION || "us-east-1";

  const output = execSync(
    `aws s3 ls s3://${bucket} --recursive --region ${reg}`,
    { encoding: "utf-8" }
  );
  const objects = parseS3Listing(output);

  // Get ETags via s3api for each object (batch via list-objects-v2)
  const etagOutput = execSync(
    `aws s3api list-objects-v2 --bucket ${bucket} --region ${reg} --output json`,
    { encoding: "utf-8" }
  );
  const etagData = JSON.parse(etagOutput) as { Contents?: Array<Record<string, unknown>> };
  const etagMap = new Map<string, string>();
  for (const obj of etagData.Contents || []) {
    etagMap.set(obj.Key as string, (obj.ETag as string || "").replace(/"/g, ""));
  }

  // Compute overall bucket fingerprint from all ETags
  const combinedHash = createHash("sha256");
  const sortedObjects = objects.sort((a, b) => a.key.localeCompare(b.key));
  for (const obj of sortedObjects) {
    const etag = etagMap.get(obj.key) || "";
    combinedHash.update(`${obj.key}:${etag}`);
  }
  const bucketFingerprint = combinedHash.digest("hex");

  const artifacts: ArtifactInfo[] = sortedObjects.map((obj) => ({
    name: obj.key,
    image: `s3://${bucket}/${obj.key}`,
    tag: obj.date,
    digest: etagMap.get(obj.key) || "unknown",
    status: "running" as ArtifactStatus,
    metadata: {
      created: `${obj.date}T${obj.time}`,
      size: obj.size,
    },
  }));

  // Add a summary artifact with the overall fingerprint
  artifacts.unshift({
    name: `s3://${bucket}`,
    image: `${objects.length} objects`,
    tag: "latest",
    digest: bucketFingerprint,
    status: "running" as ArtifactStatus,
  });

  return artifacts;
}

// --- Azure snapshot ---

function captureAzure(resourceGroup?: string, subscriptionId?: string): ArtifactInfo[] {
  if (!resourceGroup) {
    throw new Error("--resource-group is required for azure snapshot");
  }

  const subFlag = subscriptionId ? ` --subscription ${subscriptionId}` : "";

  // Capture Web Apps
  const webAppsOutput = execSync(
    `az webapp list --resource-group ${resourceGroup}${subFlag} -o json`,
    { encoding: "utf-8" }
  );
  const webApps = JSON.parse(webAppsOutput) as Array<Record<string, unknown>>;

  const artifacts: ArtifactInfo[] = webApps.map((app) => {
    const siteConfig = app.siteConfig as Record<string, unknown> | null;
    const linuxFxVersion = (siteConfig?.linuxFxVersion as string) || "";
    const windowsFxVersion = (siteConfig?.windowsFxVersion as string) || "";
    const runtime = linuxFxVersion || windowsFxVersion || "unknown";

    const appState = ((app.state as string) || "").toLowerCase();
    const status: ArtifactStatus = appState === "stopped" ? "stopped" : appState === "starting" ? "pending" : "running";
    return {
      name: app.name as string,
      image: runtime,
      tag: "latest",
      digest: (app.defaultHostName as string) || "unknown",
      status,
      metadata: {
        ...(app.lastModifiedTimeUtc && { created: app.lastModifiedTimeUtc as string }),
      },
    };
  });

  // Capture Function Apps
  try {
    const funcAppsOutput = execSync(
      `az functionapp list --resource-group ${resourceGroup}${subFlag} -o json`,
      { encoding: "utf-8" }
    );
    const funcApps = JSON.parse(funcAppsOutput) as Array<Record<string, unknown>>;

    for (const app of funcApps) {
      const siteConfig = app.siteConfig as Record<string, unknown> | null;
      const linuxFxVersion = (siteConfig?.linuxFxVersion as string) || "";
      const runtime = linuxFxVersion || "function-app";

      const funcState = ((app.state as string) || "").toLowerCase();
      const funcStatus: ArtifactStatus = funcState === "stopped" ? "stopped" : "running";
      artifacts.push({
        name: `function:${app.name as string}`,
        image: runtime,
        tag: "latest",
        digest: (app.defaultHostName as string) || "unknown",
        status: funcStatus,
        metadata: {
          ...(app.lastModifiedTimeUtc && { created: app.lastModifiedTimeUtc as string }),
        },
      });
    }
  } catch {
    // Function Apps listing may fail if no functions exist; continue with web apps only
  }

  return artifacts;
}

// --- Filesystem path snapshot ---

function collectExcludes(args: string[]): string[] {
  const excludes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--exclude" && args[i + 1]) {
      excludes.push(args[i + 1]);
    }
  }
  return excludes;
}

/** Simple glob matching: supports * and ** patterns */
function globMatch(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(str);
}

function walkDirectory(dir: string, basePath: string, excludePatterns: string[]): Array<{ filePath: string; relativePath: string }> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(basePath, fullPath);

    // Check exclude patterns
    if (excludePatterns.some((pattern) => globMatch(relPath, pattern) || globMatch(entry.name, pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath, basePath, excludePatterns));
    } else if (entry.isFile()) {
      results.push({ filePath: fullPath, relativePath: relPath });
    }
  }

  return results;
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function captureFilesystemPath(targetPath?: string, excludePatterns: string[] = []): ArtifactInfo[] {
  if (!targetPath) {
    throw new Error("--path is required for path snapshot");
  }

  const files = walkDirectory(targetPath, targetPath, excludePatterns);

  // Hash each file and build manifest
  const combinedHash = createHash("sha256");
  const artifacts: ArtifactInfo[] = [];

  const sorted = files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const file of sorted) {
    const stat = statSync(file.filePath);
    const sha256 = hashFile(file.filePath);
    combinedHash.update(`${file.relativePath}:${sha256}`);

    artifacts.push({
      name: file.relativePath,
      image: `${stat.size} bytes`,
      tag: stat.mtime.toISOString(),
      digest: sha256,
      status: "running" as ArtifactStatus,
      metadata: {
        created: stat.mtime.toISOString(),
        size: String(stat.size),
      },
    });
  }

  const directoryFingerprint = combinedHash.digest("hex");

  // Add summary artifact
  artifacts.unshift({
    name: targetPath,
    image: `${files.length} files`,
    tag: "latest",
    digest: directoryFingerprint,
    status: "running" as ArtifactStatus,
  });

  return artifacts;
}

// --- Multi-path snapshot ---

interface PathConfig {
  path: string;
  exclude?: string[];
}

function captureMultiPath(configFile?: string): ArtifactInfo[] {
  if (!configFile) {
    throw new Error("--config is required for paths snapshot");
  }

  const content = readFileSync(configFile, "utf-8");
  const paths = JSON.parse(content) as PathConfig[];

  if (!Array.isArray(paths)) {
    throw new Error("Config file must contain a JSON array of path objects");
  }

  const allArtifacts: ArtifactInfo[] = [];
  for (const entry of paths) {
    const pathArtifacts = captureFilesystemPath(entry.path, entry.exclude || []);
    allArtifacts.push(...pathArtifacts);
  }

  return allArtifacts;
}
