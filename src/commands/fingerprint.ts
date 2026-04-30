/**
 * mergewhy fingerprint — Calculate SHA-256 fingerprint of files, directories, or Docker images
 *
 * Usage:
 *   mergewhy fingerprint file ./build/app.jar
 *   mergewhy fingerprint dir ./dist
 *   mergewhy fingerprint docker myapp:latest
 */

import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { formatSuccess, formatError } from "../client.js";

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function collectFiles(dirPath: string, prefix = ""): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function hashDirectory(dirPath: string): string {
  const absDir = resolve(dirPath);
  const files = collectFiles(absDir).sort();
  if (files.length === 0) {
    formatError("Directory is empty or contains no files");
    process.exit(1);
  }

  const combinedHash = createHash("sha256");
  for (const file of files) {
    const fileHash = hashFile(join(absDir, file));
    combinedHash.update(`${file}:${fileHash}\n`);
  }
  return combinedHash.digest("hex");
}

function hashDockerImage(image: string): string {
  try {
    const id = execSync(`docker inspect --format='{{.Id}}' ${image}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Docker IDs are already sha256: prefixed; return just the hex
    return id.replace(/^sha256:/, "");
  } catch {
    formatError(`Failed to inspect Docker image "${image}". Is Docker running and the image available locally?`);
    process.exit(1);
  }
}

export async function fingerprintCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const target = args[1];

  if (!subcommand || subcommand === "--help") {
    console.log(`
mergewhy fingerprint — Calculate SHA-256 fingerprint

USAGE
  mergewhy fingerprint file <path>       Hash a single file
  mergewhy fingerprint dir <path>        Hash a directory (recursive, sorted)
  mergewhy fingerprint docker <image>    Get Docker image ID as fingerprint

EXAMPLES
  mergewhy fingerprint file ./build/app.jar
  mergewhy fingerprint dir ./dist
  mergewhy fingerprint docker myapp:v1.2.3
`.trim());
    return;
  }

  if (!target) {
    formatError(`Missing target for "fingerprint ${subcommand}". Provide a file path, directory path, or image name.`);
    process.exit(1);
  }

  let fingerprint: string;

  switch (subcommand) {
    case "file": {
      try {
        const stat = statSync(target);
        if (!stat.isFile()) {
          formatError(`"${target}" is not a file`);
          process.exit(1);
        }
      } catch {
        formatError(`File not found: ${target}`);
        process.exit(1);
      }
      fingerprint = hashFile(resolve(target));
      break;
    }
    case "dir": {
      try {
        const stat = statSync(target);
        if (!stat.isDirectory()) {
          formatError(`"${target}" is not a directory`);
          process.exit(1);
        }
      } catch {
        formatError(`Directory not found: ${target}`);
        process.exit(1);
      }
      fingerprint = hashDirectory(target);
      break;
    }
    case "docker": {
      fingerprint = hashDockerImage(target);
      break;
    }
    default:
      formatError(`Unknown fingerprint type "${subcommand}". Use: file, dir, docker`);
      process.exit(1);
  }

  // Output fingerprint to stdout (machine-readable)
  console.log(fingerprint);
}
