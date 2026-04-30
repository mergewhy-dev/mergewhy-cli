/**
 * mergewhy attest servicenow — Parse git log for ServiceNow CHG references, verify they exist, submit attestation
 *
 * Usage:
 *   mergewhy attest servicenow --instance mycompany.service-now.com --username admin --password $SNOW_PASS
 *   mergewhy attest servicenow --instance mycompany.service-now.com --token $SNOW_TOKEN --change-request CHG0012345
 */

import { execSync } from "child_process";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

/** Extract ServiceNow change request numbers (e.g., CHG0012345) from text */
function extractChangeRequests(text: string): string[] {
  const pattern = /CHG\d{7}/g;
  const matches = text.match(pattern) || [];
  return [...new Set(matches)];
}

/** Get git log messages and branch name for CHG extraction */
function getGitContext(commitRange?: string): { messages: string; branch: string } {
  let messages = "";
  let branch = "";

  try {
    if (commitRange) {
      messages = execSync(`git log --format="%s%n%b" ${commitRange}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } else {
      messages = execSync('git log -1 --format="%s%n%b"', { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }
  } catch {
    // Git not available or not a repo
  }

  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // Ignore
  }

  return { messages, branch };
}

/** Approved/implemented states in ServiceNow change management */
const APPROVED_STATES = new Set([
  "implement",
  "review",
  "closed",
  "complete",
  "scheduled",
]);

interface ChangeRequestResult {
  number: string;
  exists: boolean;
  state?: string;
  stateApproved?: boolean;
  category?: string;
  assignmentGroup?: string;
  approval?: string;
  shortDescription?: string;
  error?: string;
}

async function verifyChangeRequest(
  instance: string,
  authHeader: string,
  changeNumber: string,
): Promise<ChangeRequestResult> {
  const url = `https://${instance}/api/now/table/change_request?sysparm_query=number=${encodeURIComponent(changeNumber)}&sysparm_fields=number,state,category,assignment_group,approval,short_description&sysparm_limit=1`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return { number: changeNumber, exists: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const results = data.result as Array<Record<string, unknown>> | undefined;

    if (!results || results.length === 0) {
      return { number: changeNumber, exists: false, error: "not found" };
    }

    const record = results[0];
    const state = (record.state as string || "").toLowerCase();
    const stateApproved = APPROVED_STATES.has(state);

    return {
      number: changeNumber,
      exists: true,
      state: record.state as string | undefined,
      stateApproved,
      category: record.category as string | undefined,
      assignmentGroup: ((record.assignment_group as Record<string, unknown>)?.display_value as string) || (record.assignment_group as string | undefined),
      approval: record.approval as string | undefined,
      shortDescription: record.short_description as string | undefined,
    };
  } catch (err) {
    return { number: changeNumber, exists: false, error: (err as Error).message };
  }
}

export async function attestServicenowCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

  // Parse arguments
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
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

  const instance = ((opts["instance"] as string) || process.env.SERVICENOW_INSTANCE || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const username = (opts["username"] as string) || process.env.SERVICENOW_USERNAME || "";
  const password = (opts["password"] as string) || process.env.SERVICENOW_PASSWORD || "";
  const token = (opts["token"] as string) || process.env.SERVICENOW_TOKEN || "";

  if (!instance) {
    formatError("--instance is required (or set SERVICENOW_INSTANCE env var)");
    process.exit(1);
  }

  // Require either token or username+password
  let authHeader: string;
  if (token) {
    authHeader = `Bearer ${token}`;
  } else if (username && password) {
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  } else {
    formatError("Either --token or both --username and --password are required (or set SERVICENOW_TOKEN / SERVICENOW_USERNAME + SERVICENOW_PASSWORD env vars)");
    process.exit(1);
  }

  // Collect change request numbers
  const changeRequests: string[] = [];

  // Explicit --change-request flag
  if (opts["change-request"]) {
    const explicit = (opts["change-request"] as string).split(",").map(k => k.trim()).filter(Boolean);
    changeRequests.push(...explicit);
  }

  // Extract from git context if no explicit CHGs provided
  if (changeRequests.length === 0) {
    const commitRange = opts["commit-range"] as string | undefined;
    const { messages, branch } = getGitContext(commitRange);
    const allText = `${messages}\n${branch}\n${ci?.branch || ""}`;
    const extracted = extractChangeRequests(allText);
    changeRequests.push(...extracted);
  }

  if (changeRequests.length === 0) {
    formatError("No ServiceNow change request numbers found in git log, branch name, or --change-request flag");
    process.exit(1);
  }

  // Verify each change request in ServiceNow
  const verifications = await Promise.all(
    changeRequests.map(chg => verifyChangeRequest(instance, authHeader!, chg))
  );

  const found = verifications.filter(v => v.exists);
  const approved = verifications.filter(v => v.exists && v.stateApproved);
  const notFound = verifications.filter(v => !v.exists);
  const notApproved = verifications.filter(v => v.exists && !v.stateApproved);
  const passed = found.length > 0 && notFound.length === 0 && notApproved.length === 0;

  const name = (opts.name as string) || "ServiceNow Change Verification";

  const evidence: Record<string, unknown> = {
    scanner: "servicenow",
    instance,
    changeRequestsVerified: found.map(v => ({
      number: v.number,
      state: v.state,
      stateApproved: v.stateApproved,
      category: v.category,
      assignmentGroup: v.assignmentGroup,
      approval: v.approval,
      shortDescription: v.shortDescription,
    })),
    changeRequestsNotFound: notFound.map(v => ({
      number: v.number,
      error: v.error,
    })),
    changeRequestsNotApproved: notApproved.map(v => ({
      number: v.number,
      state: v.state,
      approval: v.approval,
    })),
    totalReferenced: changeRequests.length,
    totalVerified: found.length,
    totalApproved: approved.length,
    totalMissing: notFound.length,
    totalNotApproved: notApproved.length,
  };

  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;

  const body: Record<string, unknown> = {
    type: "SERVICENOW_CHANGE",
    name,
    passed,
    evidence,
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`ServiceNow attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: passed ? "PASSED" : "FAILED",
      changeRequests: changeRequests.join(", "),
      verified: found.length,
      approved: approved.length,
      missing: notFound.length,
      notApproved: notApproved.length,
    });

    if (notFound.length > 0) {
      console.log(`\n  Missing: ${notFound.map(v => `${v.number} (${v.error})`).join(", ")}`);
    }
    if (notApproved.length > 0) {
      console.log(`\n  Not approved: ${notApproved.map(v => `${v.number} (state: ${v.state})`).join(", ")}`);
    }
  } else {
    formatError(`Failed to submit ServiceNow attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest servicenow — Verify ServiceNow change requests and submit attestation

USAGE
  mergewhy attest servicenow --instance <host> --token <token>
  mergewhy attest servicenow --instance <host> --username <user> --password <pass>

OPTIONS
  --instance          ServiceNow instance hostname (or SERVICENOW_INSTANCE env var)
                      e.g., mycompany.service-now.com
  --username          ServiceNow username for basic auth (or SERVICENOW_USERNAME env var)
  --password          ServiceNow password for basic auth (or SERVICENOW_PASSWORD env var)
  --token             ServiceNow OAuth token (or SERVICENOW_TOKEN env var)
  --change-request    Explicit comma-separated CHG numbers (e.g., CHG0012345,CHG0012346)
  --commit-range      Git log range for extraction (e.g., main..HEAD)
  --name              Attestation name (default: "ServiceNow Change Verification")
  --repo              Repository owner/name (auto-detected in CI)
  --commit            Commit SHA (auto-detected in CI)
  --pr                Pull request number (auto-detected in CI)
  --branch            Branch name (auto-detected in CI)
  --artifact-sha256   Link to a specific artifact fingerprint

AUTHENTICATION
  Basic auth: provide --username and --password (or env vars)
  OAuth/Bearer: provide --token (or SERVICENOW_TOKEN env var)

CHG DETECTION
  Automatically extracts ServiceNow change request numbers (CHG followed by 7 digits)
  from:
  - Git commit messages (last commit, or --commit-range)
  - Current git branch name
  - CI branch name (auto-detected)
  - Explicit --change-request flag

PASS/FAIL LOGIC
  PASSES if all referenced change requests exist and are in an approved/implemented state.
  FAILS if any change request is missing or not in an approved state.

  Approved states: implement, review, closed, complete, scheduled

EXAMPLES
  mergewhy attest servicenow --instance mycompany.service-now.com --token $SNOW_TOKEN
  mergewhy attest servicenow --instance mycompany.service-now.com --username admin --password $SNOW_PASS
  mergewhy attest servicenow --instance mycompany.service-now.com --token $SNOW_TOKEN --change-request CHG0012345
  mergewhy attest servicenow --instance mycompany.service-now.com --token $SNOW_TOKEN --commit-range main..HEAD
`.trim());
}
