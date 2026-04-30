/**
 * mergewhy evaluate — Evaluate trail compliance
 *
 * Usage:
 *   mergewhy evaluate trail --flow "Payment Service"
 *   mergewhy evaluate trail --flow "Payment Service" --trail "Release v2.1"
 *
 * Exit codes:
 *   0 = all trails pass compliance
 *   1 = one or more trails fail
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

export async function evaluateCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  switch (subcommand) {
    case "trail":
      await evaluateTrail(args.slice(1));
      break;
    default:
      formatError(`Unknown subcommand "${subcommand}". Use: trail`);
      process.exit(1);
  }
}

async function evaluateTrail(args: string[]): Promise<void> {
  const config = loadConfig();
  const opts = parseOpts(args);

  const flow = opts.flow as string;
  if (!flow) {
    formatError("--flow is required");
    process.exit(1);
  }

  const trailName = opts.trail as string | undefined;

  const params = new URLSearchParams({ flowName: flow });
  if (trailName) {
    params.set("trailName", trailName);
  }

  const result = await apiRequest(config, "GET", `/api/v1/trails?${params.toString()}`);

  if (!result.ok) {
    formatError(`Trail evaluation failed: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  const trails = result.data.trails as Array<Record<string, unknown>> | undefined;
  if (!trails || trails.length === 0) {
    formatError("No trails found", { flow, ...(trailName && { trail: trailName }) });
    process.exit(1);
  }

  let allPassed = true;
  const results: Array<{ name: string; status: string; missing: string[] }> = [];

  for (const trail of trails) {
    const name = trail.name as string;
    const requiredAttestations = (trail.requiredAttestations as string[]) || [];
    const completedAttestations = (trail.completedAttestations as string[]) || [];
    const missing = requiredAttestations.filter(
      (req) => !completedAttestations.includes(req)
    );
    const passed = missing.length === 0;

    if (!passed) {
      allPassed = false;
    }

    results.push({
      name,
      status: passed ? "PASS" : "FAIL",
      missing,
    });
  }

  // Print table
  console.log("");
  console.log("  Trail".padEnd(30) + "Status".padEnd(10) + "Missing Attestations");
  console.log("  " + "-".repeat(70));

  for (const r of results) {
    const missingStr = r.missing.length > 0 ? r.missing.join(", ") : "-";
    console.log(`  ${r.name.padEnd(28)}${r.status.padEnd(10)}${missingStr}`);
  }
  console.log("");

  if (allPassed) {
    formatSuccess(`All ${results.length} trail(s) pass compliance`, { flow });
    process.exit(0);
  } else {
    const failCount = results.filter((r) => r.status === "FAIL").length;
    formatError(`${failCount} of ${results.length} trail(s) failed compliance`, { flow });
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy evaluate — Evaluate trail compliance

USAGE
  mergewhy evaluate trail --flow <flow-name> [--trail <trail-name>]

SUBCOMMANDS
  trail    Evaluate trails against flow template requirements

OPTIONS
  --flow     Flow name to evaluate trails for (required)
  --trail    Specific trail name to evaluate (evaluates all if omitted)

EXIT CODES
  0 = all trails pass (all required attestations present)
  1 = one or more trails fail

EXAMPLES
  mergewhy evaluate trail --flow "Payment Service"
  mergewhy evaluate trail --flow "Payment Service" --trail "Release v2.1"
`.trim());
}
