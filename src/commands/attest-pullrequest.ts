/**
 * mergewhy attest pullrequest — Verify a pull request exists for the current commit
 *
 * Usage:
 *   mergewhy attest pullrequest github --github-token TOKEN
 *   mergewhy attest pullrequest gitlab --gitlab-token TOKEN --gitlab-url https://gitlab.com
 *   mergewhy attest pullrequest bitbucket --bitbucket-token TOKEN --bitbucket-workspace myws
 *   mergewhy attest pullrequest azure --azure-token TOKEN --azure-org myorg --azure-project myproj
 */

import { execSync } from "child_process";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

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

function getCommitSha(opts: Record<string, string | boolean>, ci: ReturnType<typeof detectCI>): string {
  if (opts.commit) return opts.commit as string;
  if (ci?.commitSha) return ci.commitSha;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    formatError("Could not determine commit SHA. Use --commit or run in a git repository.");
    process.exit(1);
  }
}

function getRepo(opts: Record<string, string | boolean>, ci: ReturnType<typeof detectCI>): string {
  if (opts.repo) return opts.repo as string;
  if (ci?.repo) return ci.repo;
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    // Extract owner/repo from git URL
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    // Ignore
  }
  formatError("Could not determine repository. Use --repo owner/name.");
  process.exit(1);
}

interface PRInfo {
  found: boolean;
  number?: number;
  title?: string;
  author?: string;
  url?: string;
  state?: string;
  reviewCount?: number;
  approvalCount?: number;
}

async function checkGitHub(token: string, repo: string, commitSha: string): Promise<PRInfo> {
  const url = `https://api.github.com/repos/${repo}/commits/${commitSha}/pulls`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const prs = await response.json() as Array<Record<string, unknown>>;
  if (prs.length === 0) {
    return { found: false };
  }

  const pr = prs[0];
  // Fetch reviews
  let reviewCount = 0;
  let approvalCount = 0;
  try {
    const reviewsUrl = `https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews`;
    const reviewsResp = await fetch(reviewsUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (reviewsResp.ok) {
      const reviews = await reviewsResp.json() as Array<Record<string, unknown>>;
      reviewCount = reviews.length;
      approvalCount = reviews.filter(r => r.state === "APPROVED").length;
    }
  } catch {
    // Non-critical
  }

  return {
    found: true,
    number: pr.number as number,
    title: pr.title as string,
    author: (pr.user as Record<string, unknown>)?.login as string,
    url: pr.html_url as string,
    state: pr.state as string,
    reviewCount,
    approvalCount,
  };
}

async function checkGitLab(token: string, baseUrl: string, repo: string, commitSha: string): Promise<PRInfo> {
  const projectPath = encodeURIComponent(repo);
  const url = `${baseUrl}/api/v4/projects/${projectPath}/repository/commits/${commitSha}/merge_requests`;
  const response = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token },
  });

  if (!response.ok) {
    throw new Error(`GitLab API returned ${response.status}`);
  }

  const mrs = await response.json() as Array<Record<string, unknown>>;
  if (mrs.length === 0) {
    return { found: false };
  }

  const mr = mrs[0];
  return {
    found: true,
    number: mr.iid as number,
    title: mr.title as string,
    author: (mr.author as Record<string, unknown>)?.username as string,
    url: mr.web_url as string,
    state: mr.state as string,
  };
}

async function checkBitbucket(token: string, workspace: string, repoSlug: string, commitSha: string): Promise<PRInfo> {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/commit/${commitSha}/pullrequests`;
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Bitbucket API returned ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const prs = data.values as Array<Record<string, unknown>> | undefined;
  if (!prs || prs.length === 0) {
    return { found: false };
  }

  const pr = prs[0];
  const links = pr.links as Record<string, Record<string, string>> | undefined;
  return {
    found: true,
    number: pr.id as number,
    title: pr.title as string,
    author: (pr.author as Record<string, unknown>)?.display_name as string,
    url: links?.html?.href,
    state: pr.state as string,
  };
}

async function checkAzure(token: string, org: string, project: string, repo: string, commitSha: string): Promise<PRInfo> {
  const repoName = repo.includes("/") ? repo.split("/").pop()! : repo;
  const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoName}/pullrequests?searchCriteria.sourceRefName=&api-version=7.1`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Azure DevOps API returned ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const prs = data.value as Array<Record<string, unknown>> | undefined;

  // Find PR that contains this commit
  const matchedPr = prs?.find(pr => {
    const lastMergeCommit = (pr.lastMergeSourceCommit as Record<string, unknown> | undefined)?.commitId as string | undefined;
    const lastMergeTarget = (pr.lastMergeTargetCommit as Record<string, unknown> | undefined)?.commitId as string | undefined;
    return lastMergeCommit?.startsWith(commitSha) || lastMergeTarget?.startsWith(commitSha)
      || (pr.sourceRefName as string || "").includes(commitSha);
  });

  if (!matchedPr) {
    return { found: false };
  }

  const createdBy = matchedPr.createdBy as Record<string, unknown> | undefined;
  return {
    found: true,
    number: matchedPr.pullRequestId as number,
    title: matchedPr.title as string,
    author: createdBy?.displayName as string,
    url: `https://dev.azure.com/${org}/${project}/_git/${repoName}/pullrequest/${matchedPr.pullRequestId}`,
    state: matchedPr.status as string,
    reviewCount: (matchedPr.reviewers as Array<unknown> | undefined)?.length,
  };
}

export async function attestPullrequestCommand(args: string[]): Promise<void> {
  const provider = args[0];

  if (!provider || provider === "--help" || provider === "-h") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const ci = detectCI();
  const opts = parseOpts(args.slice(1));
  const commitSha = getCommitSha(opts, ci);
  const repo = getRepo(opts, ci);

  let prInfo: PRInfo;

  try {
    switch (provider) {
      case "github": {
        const token = (opts["github-token"] as string) || process.env.GITHUB_TOKEN || "";
        if (!token) {
          formatError("--github-token is required (or set GITHUB_TOKEN env var)");
          process.exit(1);
        }
        prInfo = await checkGitHub(token, repo, commitSha);
        break;
      }
      case "gitlab": {
        const token = (opts["gitlab-token"] as string) || process.env.GITLAB_TOKEN || "";
        if (!token) {
          formatError("--gitlab-token is required (or set GITLAB_TOKEN env var)");
          process.exit(1);
        }
        const baseUrl = ((opts["gitlab-url"] as string) || process.env.GITLAB_URL || "https://gitlab.com").replace(/\/+$/, "");
        prInfo = await checkGitLab(token, baseUrl, repo, commitSha);
        break;
      }
      case "bitbucket": {
        const token = (opts["bitbucket-token"] as string) || process.env.BITBUCKET_TOKEN || "";
        if (!token) {
          formatError("--bitbucket-token is required (or set BITBUCKET_TOKEN env var)");
          process.exit(1);
        }
        const workspace = (opts["bitbucket-workspace"] as string) || process.env.BITBUCKET_WORKSPACE || "";
        if (!workspace) {
          formatError("--bitbucket-workspace is required (or set BITBUCKET_WORKSPACE env var)");
          process.exit(1);
        }
        const repoSlug = repo.includes("/") ? repo.split("/").pop()! : repo;
        prInfo = await checkBitbucket(token, workspace, repoSlug, commitSha);
        break;
      }
      case "azure": {
        const token = (opts["azure-token"] as string) || process.env.AZURE_DEVOPS_TOKEN || "";
        if (!token) {
          formatError("--azure-token is required (or set AZURE_DEVOPS_TOKEN env var)");
          process.exit(1);
        }
        const azureOrg = (opts["azure-org"] as string) || process.env.AZURE_DEVOPS_ORG || "";
        const azureProject = (opts["azure-project"] as string) || process.env.AZURE_DEVOPS_PROJECT || "";
        if (!azureOrg || !azureProject) {
          formatError("--azure-org and --azure-project are required (or set AZURE_DEVOPS_ORG / AZURE_DEVOPS_PROJECT)");
          process.exit(1);
        }
        prInfo = await checkAzure(token, azureOrg, azureProject, repo, commitSha);
        break;
      }
      default:
        formatError(`Unknown SCM provider "${provider}". Use: github, gitlab, bitbucket, azure`);
        process.exit(1);
    }
  } catch (err) {
    formatError(`Failed to check for pull request: ${(err as Error).message}`);
    process.exit(1);
  }

  const name = (opts.name as string) || `Pull Request Verification (${provider})`;

  const evidence: Record<string, unknown> = {
    scmProvider: provider,
    commitSha,
    repository: repo,
    pullRequestFound: prInfo.found,
    ...(prInfo.found && {
      pullRequest: {
        number: prInfo.number,
        title: prInfo.title,
        author: prInfo.author,
        url: prInfo.url,
        state: prInfo.state,
        reviewCount: prInfo.reviewCount,
        approvalCount: prInfo.approvalCount,
      },
    }),
  };

  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  const prNumber = prInfo.number || (opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber);

  const body: Record<string, unknown> = {
    type: "CODE_REVIEW",
    name,
    passed: prInfo.found,
    evidence,
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`Pull request attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: prInfo.found ? "PASSED" : "FAILED",
      ...(prInfo.found && {
        pr: `#${prInfo.number}`,
        title: prInfo.title || "-",
        author: prInfo.author || "-",
        url: prInfo.url || "-",
      }),
      ...(!prInfo.found && { reason: "No pull request found for this commit" }),
    });
  } else {
    formatError(`Failed to submit PR attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }

  if (!prInfo.found) {
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest pullrequest — Verify a pull request exists for the current commit

USAGE
  mergewhy attest pullrequest <provider> [options]

PROVIDERS
  github      Check GitHub for associated pull request
  gitlab      Check GitLab for associated merge request
  bitbucket   Check Bitbucket for associated pull request
  azure       Check Azure DevOps for associated pull request

OPTIONS
  --github-token          GitHub personal access token (or GITHUB_TOKEN env var)
  --gitlab-token          GitLab personal access token (or GITLAB_TOKEN env var)
  --gitlab-url            GitLab instance URL (default: https://gitlab.com)
  --bitbucket-token       Bitbucket access token (or BITBUCKET_TOKEN env var)
  --bitbucket-workspace   Bitbucket workspace slug (or BITBUCKET_WORKSPACE env var)
  --azure-token           Azure DevOps PAT (or AZURE_DEVOPS_TOKEN env var)
  --azure-org             Azure DevOps organization (or AZURE_DEVOPS_ORG env var)
  --azure-project         Azure DevOps project (or AZURE_DEVOPS_PROJECT env var)
  --repo                  Repository owner/name (auto-detected from git remote)
  --commit                Commit SHA (auto-detected from HEAD)
  --name                  Attestation name
  --artifact-sha256       Link to a specific artifact fingerprint

PASS/FAIL LOGIC
  PASSES if a pull request / merge request is found for the commit.
  FAILS if no PR/MR is associated with the commit (exits with code 1).

EXAMPLES
  mergewhy attest pullrequest github --github-token ghp_xxx
  mergewhy attest pullrequest gitlab --gitlab-token glpat-xxx --gitlab-url https://gitlab.mycompany.com
  mergewhy attest pullrequest bitbucket --bitbucket-token xxx --bitbucket-workspace myws
  mergewhy attest pullrequest azure --azure-token xxx --azure-org myorg --azure-project myproj
`.trim());
}
