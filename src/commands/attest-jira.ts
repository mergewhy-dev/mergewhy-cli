/**
 * mergewhy attest jira — Parse git log for Jira references, verify they exist, submit attestation
 *
 * Usage:
 *   mergewhy attest jira --jira-url https://myorg.atlassian.net --jira-email user@example.com --jira-token TOKEN
 *   mergewhy attest jira --jira-url https://jira.mycompany.com --jira-email user@example.com --jira-token TOKEN --commit-range main..HEAD
 */

import { execSync } from "child_process";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

/** Extract Jira issue keys (e.g., PROJ-123) from text */
function extractJiraKeys(text: string): string[] {
  const pattern = /[A-Z][A-Z0-9_]+-\d+/g;
  const matches = text.match(pattern) || [];
  return [...new Set(matches)];
}

/** Get git log messages and branch name for Jira key extraction */
function getGitContext(commitRange?: string): { messages: string; branch: string } {
  let messages = "";
  let branch = "";

  try {
    if (commitRange) {
      messages = execSync(`git log --format="%s%n%b" ${commitRange}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } else {
      // Default: last commit message
      messages = execSync('git log -1 --format="%s%n%b"', { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }
  } catch {
    // Git not available or not a repo — continue with empty messages
  }

  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // Ignore
  }

  return { messages, branch };
}

interface JiraIssue {
  key: string;
  exists: boolean;
  summary?: string;
  status?: string;
  issueType?: string;
  assignee?: string;
  error?: string;
}

async function verifyJiraIssue(
  jiraUrl: string,
  email: string,
  token: string,
  issueKey: string,
): Promise<JiraIssue> {
  const url = `${jiraUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,assignee`;
  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
    });

    if (response.status === 404) {
      return { key: issueKey, exists: false, error: "not found" };
    }
    if (!response.ok) {
      return { key: issueKey, exists: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const fields = data.fields as Record<string, unknown> | undefined;

    return {
      key: issueKey,
      exists: true,
      summary: fields?.summary as string | undefined,
      status: (fields?.status as Record<string, unknown> | undefined)?.name as string | undefined,
      issueType: (fields?.issuetype as Record<string, unknown> | undefined)?.name as string | undefined,
      assignee: (fields?.assignee as Record<string, unknown> | undefined)?.displayName as string | undefined,
    };
  } catch (err) {
    return { key: issueKey, exists: false, error: (err as Error).message };
  }
}

export async function attestJiraCommand(args: string[]): Promise<void> {
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

  const jiraUrl = ((opts["jira-url"] as string) || process.env.JIRA_URL || "").replace(/\/+$/, "");
  const jiraEmail = (opts["jira-email"] as string) || process.env.JIRA_EMAIL || "";
  const jiraToken = (opts["jira-token"] as string) || process.env.JIRA_TOKEN || "";

  if (!jiraUrl) {
    formatError("--jira-url is required (or set JIRA_URL env var)");
    process.exit(1);
  }
  if (!jiraEmail) {
    formatError("--jira-email is required (or set JIRA_EMAIL env var)");
    process.exit(1);
  }
  if (!jiraToken) {
    formatError("--jira-token is required (or set JIRA_TOKEN env var)");
    process.exit(1);
  }

  // Extract Jira keys from git context
  const commitRange = opts["commit-range"] as string | undefined;
  const { messages, branch } = getGitContext(commitRange);
  const allText = `${messages}\n${branch}\n${ci?.branch || ""}`;
  const jiraKeys = extractJiraKeys(allText);

  // Also accept explicit keys
  if (opts.issues) {
    const explicit = (opts.issues as string).split(",").map(k => k.trim()).filter(Boolean);
    for (const key of explicit) {
      if (!jiraKeys.includes(key)) jiraKeys.push(key);
    }
  }

  if (jiraKeys.length === 0) {
    formatError("No Jira issue keys found in git log, branch name, or --issues flag");
    process.exit(1);
  }

  // Verify each issue exists in Jira
  const verifications = await Promise.all(
    jiraKeys.map(key => verifyJiraIssue(jiraUrl, jiraEmail, jiraToken, key))
  );

  const found = verifications.filter(v => v.exists);
  const notFound = verifications.filter(v => !v.exists);
  const passed = found.length > 0 && notFound.length === 0;

  const name = (opts.name as string) || "Jira Issue Verification";

  const evidence: Record<string, unknown> = {
    scanner: "jira",
    jiraUrl,
    issuesFound: found.map(v => ({
      key: v.key,
      summary: v.summary,
      status: v.status,
      type: v.issueType,
      assignee: v.assignee,
    })),
    issuesNotFound: notFound.map(v => ({
      key: v.key,
      error: v.error,
    })),
    totalIssuesReferenced: jiraKeys.length,
    totalVerified: found.length,
    totalMissing: notFound.length,
    sources: {
      commitMessages: Boolean(messages.trim()),
      branchName: Boolean(branch),
      explicitIssues: Boolean(opts.issues),
    },
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
    type: "CUSTOM",
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
    formatSuccess(`Jira attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: passed ? "PASSED" : "FAILED",
      issuesReferenced: jiraKeys.join(", "),
      verified: found.length,
      missing: notFound.length,
    });

    if (notFound.length > 0) {
      console.log(`\n  Missing issues: ${notFound.map(v => `${v.key} (${v.error})`).join(", ")}`);
    }
  } else {
    formatError(`Failed to submit Jira attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest jira — Verify Jira issue references and submit attestation

USAGE
  mergewhy attest jira --jira-url <url> --jira-email <email> --jira-token <token>

OPTIONS
  --jira-url          Jira instance URL (or JIRA_URL env var)
  --jira-email        Jira account email (or JIRA_EMAIL env var)
  --jira-token        Jira API token (or JIRA_TOKEN env var)
  --issues            Explicit comma-separated issue keys (e.g., PROJ-1,PROJ-2)
  --commit-range      Git log range for extraction (e.g., main..HEAD)
  --name              Attestation name (default: "Jira Issue Verification")
  --repo              Repository owner/name (auto-detected in CI)
  --commit            Commit SHA (auto-detected in CI)
  --pr                Pull request number (auto-detected in CI)
  --artifact-sha256   Link to a specific artifact fingerprint

JIRA KEY DETECTION
  Automatically extracts Jira issue keys (e.g., PROJ-123) from:
  - Git commit messages (last commit, or --commit-range)
  - Current git branch name
  - CI branch name (auto-detected)
  - Explicit --issues flag

PASS/FAIL LOGIC
  PASSES if all referenced Jira issues are found in Jira.
  FAILS if any referenced issue does not exist or is inaccessible.

EXAMPLES
  mergewhy attest jira --jira-url https://myorg.atlassian.net --jira-email me@co.com --jira-token xxx
  mergewhy attest jira --jira-url https://jira.co.com --jira-email me@co.com --jira-token xxx --commit-range main..HEAD
  mergewhy attest jira --jira-url https://jira.co.com --jira-email me@co.com --jira-token xxx --issues PROJ-42,PROJ-43
`.trim());
}
