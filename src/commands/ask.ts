/**
 * mergewhy ask — Ask a natural-language question about your change evidence
 *
 * Usage:
 *   mergewhy ask "what changed in production last week?"
 *   mergewhy ask "which PRs are missing approvals?" --repo owner/repo
 *   mergewhy ask "show me SOC 2 gaps" --framework soc2
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";

function parseOpts(args: string[]): { query: string | undefined; opts: Record<string, string | boolean> } {
  const opts: Record<string, string | boolean> = {};
  let query: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else if (!query) {
      query = arg;
    }
  }

  return { query, opts };
}

export async function askCommand(args: string[]): Promise<void> {
  const { query, opts } = parseOpts(args);

  if (opts.help) {
    printHelp();
    return;
  }

  if (!query) {
    formatError("A query is required as the first positional argument");
    process.exit(1);
  }

  const config = loadConfig();

  const body: Record<string, unknown> = { query };
  if (opts.repo) body.repo = opts.repo;
  if (opts.framework) body.framework = opts.framework;

  const result = await apiRequest(config, "POST", "/api/v1/ask", body);

  if (!result.ok) {
    formatError(`Ask failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const answer = result.data.answer as string | undefined;
  const sources = result.data.sources as Array<Record<string, unknown>> | undefined;

  formatSuccess("Answer", { query });
  console.log();
  console.log(answer || "(no response)");

  if (sources && sources.length > 0) {
    console.log();
    console.log("  Sources:");
    for (const source of sources) {
      console.log(`    - ${source.type || "unknown"}: ${source.name || source.id || "-"}`);
    }
  }
}

function printHelp(): void {
  console.log(`
mergewhy ask — Ask a natural-language question about your change evidence

USAGE
  mergewhy ask "<query>" [--repo <owner/repo>] [--framework <id>]

OPTIONS
  --repo          Scope the question to a specific repository
  --framework     Scope the question to a specific compliance framework

EXAMPLES
  mergewhy ask "what changed in production last week?"
  mergewhy ask "which PRs are missing approvals?" --repo owner/repo
  mergewhy ask "show me SOC 2 gaps" --framework soc2
`.trim());
}
