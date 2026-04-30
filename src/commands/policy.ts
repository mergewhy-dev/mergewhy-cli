/**
 * mergewhy policy — Policy management (create, attach, list)
 *
 * Policies define compliance rules that artifacts must satisfy before deployment.
 * Attach policies to environments to enforce gates.
 *
 * Usage:
 *   mergewhy policy create --name "prod-policy" --file policy.yaml
 *   mergewhy policy attach --name "prod-policy" --environment production
 *   mergewhy policy list
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { evaluateRego } from "../rego-eval.js";

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

function formatTable(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) {
    console.log("  (no policies found)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map(r => String(r[key] ?? "").length));
  }

  const header = keys.map(k => k.toUpperCase().padEnd(widths[k])).join("  ");
  console.log(`  ${header}`);
  console.log(`  ${keys.map(k => "─".repeat(widths[k])).join("  ")}`);
  for (const row of rows) {
    const line = keys.map(k => String(row[k] ?? "").padEnd(widths[k])).join("  ");
    console.log(`  ${line}`);
  }
}

export async function policyCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const opts = parseOpts(args.slice(1));

  switch (subcommand) {
    case "create": {
      const name = opts.name as string;
      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        name,
        ...(opts.description && { description: opts.description }),
      };

      // Load policy definition from file
      if (opts.file) {
        try {
          const content = readFileSync(resolve(opts.file as string), "utf-8");
          body.definition = content;
        } catch {
          formatError(`Policy file not found: ${opts.file}`);
          process.exit(1);
        }
      }

      // Policy format (yaml or rego)
      if (opts.format) {
        const format = opts.format as string;
        if (format !== "yaml" && format !== "rego") {
          formatError('--format must be "yaml" or "rego"');
          process.exit(1);
        }
        body.format = format;
      }

      // Inline rule options
      if (opts["min-score"]) body.minScore = parseInt(opts["min-score"] as string, 10);
      if (opts["require-review"]) body.requireReview = true;
      if (opts["require-ticket"]) body.requireTicket = true;
      if (opts["require-ci"]) body.requireCI = true;
      if (opts["require-approval"]) body.requireApproval = true;
      if (opts["require-security-scan"]) body.requireSecurityScan = true;
      if (opts["max-critical-vulns"]) body.maxCriticalVulns = parseInt(opts["max-critical-vulns"] as string, 10);
      if (opts["max-high-vulns"]) body.maxHighVulns = parseInt(opts["max-high-vulns"] as string, 10);
      if (opts.frameworks) body.frameworks = (opts.frameworks as string).split(",").map(f => f.trim());

      const result = await apiRequest(config, "POST", "/api/v1/policies", body);
      if (result.ok) {
        formatSuccess(`Policy created: ${name}`, {
          id: result.data.id as string,
        });
      } else {
        formatError(`Failed to create policy: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "attach": {
      const name = opts.name as string;
      const environment = opts.environment as string;

      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }
      if (!environment) {
        formatError("--environment is required");
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        policyName: name,
        environmentName: environment,
      };

      const result = await apiRequest(config, "POST", "/api/v1/policies/attach", body);
      if (result.ok) {
        formatSuccess(`Policy "${name}" attached to environment "${environment}"`);
      } else {
        formatError(`Failed to attach policy: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const params = new URLSearchParams();
      if (opts.environment) params.set("environment", opts.environment as string);
      if (opts.limit) params.set("limit", opts.limit as string);

      const queryString = params.toString();
      const path = queryString ? `/api/v1/policies?${queryString}` : "/api/v1/policies";
      const result = await apiRequest(config, "GET", path);

      if (!result.ok) {
        formatError(`Failed to list policies: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const policies = result.data.policies as Array<Record<string, unknown>> | undefined;
      formatSuccess(`${policies?.length ?? 0} policy(ies) found`);
      console.log();

      if (policies && policies.length > 0) {
        const tableRows = policies.map(p => ({
          name: p.name as string,
          environments: ((p.environments as string[]) || []).join(", ") || "(unattached)",
          rules: p.ruleCount as number ?? 0,
          created: p.createdAt ? new Date(p.createdAt as string).toISOString().slice(0, 10) : "-",
        }));
        formatTable(tableRows);
      }
      break;
    }

    case "evaluate": {
      const name = opts.name as string;
      if (!name) {
        formatError("--name is required");
        process.exit(1);
      }

      const body: Record<string, unknown> = { policyName: name };

      if (opts.input) {
        try {
          const content = readFileSync(resolve(opts.input as string), "utf-8");
          body.input = JSON.parse(content);
        } catch {
          formatError(`Failed to read input file: ${opts.input}`);
          process.exit(1);
        }
      }

      if (opts["trail-id"]) {
        body.trailId = opts["trail-id"] as string;
      }

      const result = await apiRequest(config, "POST", "/api/v1/policies/evaluate", body);

      if (!result.ok) {
        formatError(`Policy evaluation failed: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }

      const passed = result.data.passed as boolean;
      const violations = (result.data.violations as Array<{ rule: string; message: string }>) || [];
      const score = result.data.score as number | undefined;

      if (passed) {
        formatSuccess(`Policy "${name}" passed`, {
          ...(score !== undefined && { score }),
        });
      } else {
        formatError(`Policy "${name}" failed`, {
          violations: violations.length,
          ...(score !== undefined && { score }),
        });

        if (violations.length > 0) {
          console.log();
          console.log("  VIOLATIONS:");
          for (const v of violations) {
            console.log(`    - [${v.rule}] ${v.message}`);
          }
        }

        process.exit(1);
      }
      break;
    }

    case "evaluate-input": {
      const policyFile = opts.policy as string;
      const inputFile = opts.input as string;

      if (!policyFile) {
        formatError("--policy is required (path to .rego file)");
        process.exit(1);
      }
      if (!inputFile) {
        formatError("--input is required (path to .json file)");
        process.exit(1);
      }

      let policySource: string;
      try {
        policySource = readFileSync(resolve(policyFile), "utf-8");
      } catch {
        formatError(`Policy file not found: ${policyFile}`);
        process.exit(1);
        return; // unreachable, satisfies TS
      }

      let inputData: Record<string, unknown>;
      try {
        const content = readFileSync(resolve(inputFile), "utf-8");
        inputData = JSON.parse(content) as Record<string, unknown>;
      } catch {
        formatError(`Failed to read/parse input file: ${inputFile}`);
        process.exit(1);
        return; // unreachable, satisfies TS
      }

      const evalResult = evaluateRego(policySource, inputData);

      if (evalResult.passed) {
        formatSuccess("Policy evaluation passed");
      } else {
        formatError("Policy evaluation failed");
      }

      if (evalResult.violations.length > 0) {
        console.log();
        console.log("  VIOLATIONS:");
        for (const v of evalResult.violations) {
          console.log(`    - [${v.rule}] ${v.message}`);
        }
      }

      if (!evalResult.passed) {
        process.exit(1);
      }
      break;
    }

    case "detach": {
      const name = opts.name as string;
      const environment = opts.environment as string;
      if (!name || !environment) {
        formatError("Both --name and --environment are required");
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        policyName: name,
        environmentName: environment,
      };

      const result = await apiRequest(config, "POST", "/api/v1/policies/detach", body);
      if (result.ok) {
        formatSuccess(`Policy "${name}" detached from environment "${environment}"`);
      } else {
        formatError(`Failed to detach policy: ${result.data.error || result.status}`, result.data);
        process.exit(1);
      }
      break;
    }

    default:
      formatError(`Unknown subcommand "${subcommand}". Use: create, attach, detach, list, evaluate, evaluate-input`);
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy policy — Policy management

USAGE
  mergewhy policy create --name <name> [--file policy.yaml] [--format yaml|rego]
  mergewhy policy attach --name <name> --environment <env>
  mergewhy policy detach --name <name> --environment <env>
  mergewhy policy list [--environment <env>]
  mergewhy policy evaluate --name <name> [--input input.json] [--trail-id <id>]
  mergewhy policy evaluate-input --policy policy.rego --input input.json

SUBCOMMANDS
  create          Create a new deployment policy
  attach          Attach a policy to an environment
  detach          Detach a policy from an environment
  list            List all policies (optionally filter by environment)
  evaluate        Evaluate a server-side policy against input or trail data
  evaluate-input  Evaluate a local Rego file against JSON input (no API call)

OPTIONS
  --name                   Policy name (required for create/attach/detach/evaluate)
  --file                   Path to policy definition (YAML or Rego)
  --format                 Policy format: "yaml" (default) or "rego"
  --description            Policy description
  --environment            Target environment
  --input                  Path to JSON input file (for evaluate/evaluate-input)
  --trail-id               Trail ID to use as evaluation input (for evaluate)
  --policy                 Path to .rego policy file (for evaluate-input)
  --min-score              Minimum evidence score (0-100)
  --require-review         Require code review
  --require-ticket         Require linked ticket
  --require-ci             Require passing CI
  --require-approval       Require deployment approval
  --require-security-scan  Require security scan attestation
  --max-critical-vulns     Maximum allowed critical vulnerabilities
  --max-high-vulns         Maximum allowed high vulnerabilities
  --frameworks             Comma-separated compliance frameworks

EXAMPLES
  mergewhy policy create --name "prod-policy" --file policy.yaml
  mergewhy policy create --name "rego-gate" --file gate.rego --format rego
  mergewhy policy create --name "basic" --min-score 70 --require-review --require-ticket
  mergewhy policy attach --name "prod-policy" --environment production
  mergewhy policy list
  mergewhy policy evaluate --name "prod-gate" --input input.json
  mergewhy policy evaluate --name "prod-gate" --trail-id abc123
  mergewhy policy evaluate-input --policy policy.rego --input input.json
`.trim());
}
