/**
 * .mergewhy.json config file loader
 *
 * Searches up the directory tree for a .mergewhy.json file and uses
 * its values as defaults for CLI options and environment variables.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface MergeWhyConfig {
  /** API base URL (default: https://mergewhy.com) */
  apiUrl?: string;
  /** API key — prefer MERGEWHY_API_KEY env var over this */
  apiKey?: string;
  /** Default repository (owner/repo) */
  repo?: string;
  /** Default environment for deploy/gate commands */
  environment?: string;
  /** Default minimum score for gate checks */
  minScore?: number;
  /** Default output format */
  output?: "text" | "json";
  /** Default framework for compliance checks */
  framework?: string;
}

const CONFIG_FILENAME = ".mergewhy.json";
const MAX_SEARCH_DEPTH = 20;

/**
 * Search up the directory tree from `startDir` for a .mergewhy.json file.
 * Returns the parsed config or an empty object if not found.
 */
export function findConfigFile(startDir?: string): MergeWhyConfig {
  let dir = startDir || process.cwd();

  for (let i = 0; i < MAX_SEARCH_DEPTH; i++) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(content) as MergeWhyConfig;
        return parsed;
      } catch {
        // Invalid JSON — skip
        return {};
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  return {};
}

/**
 * Apply config file values as environment variable defaults.
 * Environment variables always take precedence over config file values.
 */
export function applyConfigDefaults(): MergeWhyConfig {
  const config = findConfigFile();

  if (config.apiUrl && !process.env.MERGEWHY_API_URL) {
    process.env.MERGEWHY_API_URL = config.apiUrl;
  }

  if (config.apiKey && !process.env.MERGEWHY_API_KEY) {
    process.env.MERGEWHY_API_KEY = config.apiKey;
  }

  return config;
}
