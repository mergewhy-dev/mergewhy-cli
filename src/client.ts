/**
 * MergeWhy API Client
 *
 * Thin wrapper around fetch() for calling MergeWhy REST API endpoints.
 */

export type OutputFormat = "text" | "json";

export interface ClientConfig {
  apiUrl: string;
  apiKey: string;
  outputFormat: OutputFormat;
}

export function detectOutputFormat(): OutputFormat {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1] === "json") return "json";
    if (args[i] === "--output=json") return "json";
  }
  return "text";
}

export function loadConfig(): ClientConfig {
  const apiUrl = (process.env.MERGEWHY_API_URL || "https://mergewhy.com").replace(/\/+$/, "");
  const apiKey = process.env.MERGEWHY_API_KEY || "";
  const outputFormat = detectOutputFormat();

  if (!apiKey) {
    if (outputFormat === "json") {
      console.log(JSON.stringify({ error: "MERGEWHY_API_KEY environment variable is required" }));
    } else {
      console.error("Error: MERGEWHY_API_KEY environment variable is required.");
      console.error("Generate an API key at: https://mergewhy.com/dashboard/settings");
    }
    process.exit(1);
  }

  return { apiUrl, apiKey, outputFormat };
}

export async function apiRequest(
  config: ClientConfig,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${config.apiUrl}${path}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "mergewhy-cli/0.1.0",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: Record<string, unknown> = {};
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON response
  }

  return { ok: response.ok, status: response.status, data };
}

export function formatSuccess(message: string, details?: Record<string, unknown>): void {
  const format = detectOutputFormat();
  if (format === "json") {
    console.log(JSON.stringify({ ok: true, message, ...details }));
    return;
  }
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      console.log(`  ${key}: ${value}`);
    }
  }
}

export function formatError(message: string, details?: Record<string, unknown>): void {
  const format = detectOutputFormat();
  if (format === "json") {
    console.log(JSON.stringify({ ok: false, error: message, ...details }));
    return;
  }
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      console.error(`  ${key}: ${JSON.stringify(value)}`);
    }
  }
}
