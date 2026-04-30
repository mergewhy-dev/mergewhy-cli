/**
 * CI Environment Auto-Detection
 *
 * Detects which CI system is running and extracts metadata
 * (commit SHA, repo, branch, PR number, build URL, etc.)
 */

export interface CIContext {
  provider: string;
  repo?: string;
  commitSha?: string;
  branch?: string;
  prNumber?: number;
  buildUrl?: string;
  buildId?: string;
  triggeredBy?: string;
}

export function detectCI(): CIContext | null {
  const env = process.env;

  // GitHub Actions
  if (env.GITHUB_ACTIONS === "true") {
    const prNumber = env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\/merge$/)?.[1];
    return {
      provider: "github_actions",
      repo: env.GITHUB_REPOSITORY,
      commitSha: env.GITHUB_SHA,
      branch: env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF,
      prNumber: prNumber ? parseInt(prNumber, 10) : undefined,
      buildUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      buildId: env.GITHUB_RUN_ID,
      triggeredBy: env.GITHUB_ACTOR,
    };
  }

  // GitLab CI
  if (env.GITLAB_CI === "true") {
    return {
      provider: "gitlab_ci",
      repo: env.CI_PROJECT_PATH,
      commitSha: env.CI_COMMIT_SHA,
      branch: env.CI_COMMIT_REF_NAME,
      prNumber: env.CI_MERGE_REQUEST_IID ? parseInt(env.CI_MERGE_REQUEST_IID, 10) : undefined,
      buildUrl: env.CI_PIPELINE_URL,
      buildId: env.CI_PIPELINE_ID,
      triggeredBy: env.GITLAB_USER_LOGIN || env.CI_COMMIT_AUTHOR,
    };
  }

  // Jenkins
  if (env.JENKINS_URL) {
    const prNumber = env.CHANGE_ID || env.ghprbPullId;
    return {
      provider: "jenkins",
      repo: env.GIT_URL?.replace(/\.git$/, "").replace(/^.*[:/]([^/]+\/[^/]+)$/, "$1"),
      commitSha: env.GIT_COMMIT,
      branch: env.GIT_BRANCH || env.BRANCH_NAME,
      prNumber: prNumber ? parseInt(prNumber, 10) : undefined,
      buildUrl: env.BUILD_URL,
      buildId: env.BUILD_NUMBER,
      triggeredBy: env.BUILD_USER || env.CHANGE_AUTHOR,
    };
  }

  // CircleCI
  if (env.CIRCLECI === "true") {
    return {
      provider: "circleci",
      repo: `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`,
      commitSha: env.CIRCLE_SHA1,
      branch: env.CIRCLE_BRANCH,
      prNumber: env.CIRCLE_PULL_REQUEST?.split("/").pop()
        ? parseInt(env.CIRCLE_PULL_REQUEST.split("/").pop()!, 10)
        : undefined,
      buildUrl: env.CIRCLE_BUILD_URL,
      buildId: env.CIRCLE_BUILD_NUM,
      triggeredBy: env.CIRCLE_USERNAME,
    };
  }

  // Azure Pipelines
  if (env.TF_BUILD === "True") {
    const prNumber = env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    return {
      provider: "azure_pipelines",
      repo: env.BUILD_REPOSITORY_NAME,
      commitSha: env.BUILD_SOURCEVERSION,
      branch: env.BUILD_SOURCEBRANCH?.replace(/^refs\/heads\//, ""),
      prNumber: prNumber ? parseInt(prNumber, 10) : undefined,
      buildUrl: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`,
      buildId: env.BUILD_BUILDID,
      triggeredBy: env.BUILD_REQUESTEDFOR,
    };
  }

  // Bitbucket Pipelines
  if (env.BITBUCKET_BUILD_NUMBER) {
    return {
      provider: "bitbucket_pipelines",
      repo: env.BITBUCKET_REPO_FULL_NAME,
      commitSha: env.BITBUCKET_COMMIT,
      branch: env.BITBUCKET_BRANCH,
      prNumber: env.BITBUCKET_PR_ID ? parseInt(env.BITBUCKET_PR_ID, 10) : undefined,
      buildUrl: `https://bitbucket.org/${env.BITBUCKET_REPO_FULL_NAME}/pipelines/results/${env.BITBUCKET_BUILD_NUMBER}`,
      buildId: env.BITBUCKET_BUILD_NUMBER,
    };
  }

  // TeamCity
  if (env.TEAMCITY_VERSION) {
    return {
      provider: "teamcity",
      commitSha: env.BUILD_VCS_NUMBER,
      branch: env.BRANCH_NAME,
      buildId: env.BUILD_NUMBER,
      buildUrl: env.BUILD_URL,
    };
  }

  // AWS CodeBuild
  if (env.CODEBUILD_BUILD_ID) {
    const repoUrl = env.CODEBUILD_SOURCE_REPO_URL || "";
    const repo = repoUrl.replace(/\.git$/, "").replace(/^.*[:/]([^/]+\/[^/]+)$/, "$1");
    return {
      provider: "codebuild",
      repo: repo || undefined,
      commitSha: env.CODEBUILD_RESOLVED_SOURCE_VERSION,
      branch: env.CODEBUILD_WEBHOOK_HEAD_REF?.replace(/^refs\/heads\//, ""),
      prNumber: env.CODEBUILD_WEBHOOK_TRIGGER?.startsWith("pr/")
        ? parseInt(env.CODEBUILD_WEBHOOK_TRIGGER.split("/")[1], 10)
        : undefined,
      buildUrl: env.CODEBUILD_BUILD_URL,
      buildId: env.CODEBUILD_BUILD_ID,
      triggeredBy: env.CODEBUILD_INITIATOR,
    };
  }

  // Travis CI
  if (env.TRAVIS === "true") {
    return {
      provider: "travis_ci",
      repo: env.TRAVIS_REPO_SLUG,
      commitSha: env.TRAVIS_COMMIT,
      branch: env.TRAVIS_BRANCH,
      prNumber: env.TRAVIS_PULL_REQUEST !== "false"
        ? parseInt(env.TRAVIS_PULL_REQUEST!, 10)
        : undefined,
      buildUrl: env.TRAVIS_BUILD_WEB_URL,
      buildId: env.TRAVIS_BUILD_ID,
    };
  }

  return null;
}
