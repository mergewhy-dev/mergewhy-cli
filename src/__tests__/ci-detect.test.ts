import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectCI } from "../ci-detect.js";

describe("detectCI", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear all CI-related env vars
    const ciVars = [
      "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_REF",
      "GITHUB_REF_NAME", "GITHUB_HEAD_REF", "GITHUB_RUN_ID", "GITHUB_ACTOR",
      "GITHUB_SERVER_URL",
      "GITLAB_CI", "CI_PROJECT_PATH", "CI_COMMIT_SHA", "CI_COMMIT_REF_NAME",
      "CI_MERGE_REQUEST_IID", "CI_PIPELINE_URL", "CI_PIPELINE_ID",
      "GITLAB_USER_LOGIN", "CI_COMMIT_AUTHOR",
      "JENKINS_URL", "GIT_URL", "GIT_COMMIT", "GIT_BRANCH", "BRANCH_NAME",
      "CHANGE_ID", "ghprbPullId", "BUILD_URL", "BUILD_NUMBER", "BUILD_USER",
      "CHANGE_AUTHOR",
      "CIRCLECI", "CIRCLE_PROJECT_USERNAME", "CIRCLE_PROJECT_REPONAME",
      "CIRCLE_SHA1", "CIRCLE_BRANCH", "CIRCLE_PULL_REQUEST", "CIRCLE_BUILD_URL",
      "CIRCLE_BUILD_NUM", "CIRCLE_USERNAME",
      "TF_BUILD", "BUILD_REPOSITORY_NAME", "BUILD_SOURCEVERSION",
      "BUILD_SOURCEBRANCH", "SYSTEM_PULLREQUEST_PULLREQUESTID",
      "SYSTEM_TEAMFOUNDATIONSERVERURI", "SYSTEM_TEAMPROJECT", "BUILD_BUILDID",
      "BUILD_REQUESTEDFOR",
      "BITBUCKET_BUILD_NUMBER", "BITBUCKET_REPO_FULL_NAME", "BITBUCKET_COMMIT",
      "BITBUCKET_BRANCH", "BITBUCKET_PR_ID",
      "TEAMCITY_VERSION", "BUILD_VCS_NUMBER",
      "TRAVIS", "TRAVIS_REPO_SLUG", "TRAVIS_COMMIT", "TRAVIS_BRANCH",
      "TRAVIS_PULL_REQUEST", "TRAVIS_BUILD_WEB_URL", "TRAVIS_BUILD_ID",
    ];
    for (const v of ciVars) {
      delete process.env[v];
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("returns null when no CI env vars are set", () => {
    expect(detectCI()).toBeNull();
  });

  describe("GitHub Actions", () => {
    it("detects GitHub Actions", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REPOSITORY = "owner/repo";
      process.env.GITHUB_SHA = "abc123";
      process.env.GITHUB_REF_NAME = "main";
      process.env.GITHUB_RUN_ID = "12345";
      process.env.GITHUB_ACTOR = "octocat";
      process.env.GITHUB_SERVER_URL = "https://github.com";

      const result = detectCI();
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("github_actions");
      expect(result!.repo).toBe("owner/repo");
      expect(result!.commitSha).toBe("abc123");
      expect(result!.branch).toBe("main");
      expect(result!.buildId).toBe("12345");
      expect(result!.triggeredBy).toBe("octocat");
      expect(result!.buildUrl).toBe("https://github.com/owner/repo/actions/runs/12345");
    });

    it("extracts PR number from GITHUB_REF", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REF = "refs/pull/42/merge";
      process.env.GITHUB_REPOSITORY = "owner/repo";
      process.env.GITHUB_SERVER_URL = "https://github.com";

      const result = detectCI();
      expect(result!.prNumber).toBe(42);
    });

    it("does not extract PR number from non-PR ref", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_REF = "refs/heads/main";
      process.env.GITHUB_REPOSITORY = "owner/repo";
      process.env.GITHUB_SERVER_URL = "https://github.com";

      const result = detectCI();
      expect(result!.prNumber).toBeUndefined();
    });

    it("falls back to GITHUB_HEAD_REF for branch", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_HEAD_REF = "feature-branch";
      process.env.GITHUB_REPOSITORY = "owner/repo";
      process.env.GITHUB_SERVER_URL = "https://github.com";

      const result = detectCI();
      expect(result!.branch).toBe("feature-branch");
    });
  });

  describe("GitLab CI", () => {
    it("detects GitLab CI", () => {
      process.env.GITLAB_CI = "true";
      process.env.CI_PROJECT_PATH = "group/project";
      process.env.CI_COMMIT_SHA = "def456";
      process.env.CI_COMMIT_REF_NAME = "develop";
      process.env.CI_PIPELINE_URL = "https://gitlab.com/pipeline/1";
      process.env.CI_PIPELINE_ID = "999";
      process.env.GITLAB_USER_LOGIN = "gitlabuser";

      const result = detectCI();
      expect(result!.provider).toBe("gitlab_ci");
      expect(result!.repo).toBe("group/project");
      expect(result!.commitSha).toBe("def456");
      expect(result!.branch).toBe("develop");
      expect(result!.buildUrl).toBe("https://gitlab.com/pipeline/1");
      expect(result!.buildId).toBe("999");
      expect(result!.triggeredBy).toBe("gitlabuser");
    });

    it("extracts PR number from CI_MERGE_REQUEST_IID", () => {
      process.env.GITLAB_CI = "true";
      process.env.CI_MERGE_REQUEST_IID = "7";

      const result = detectCI();
      expect(result!.prNumber).toBe(7);
    });

    it("falls back to CI_COMMIT_AUTHOR for triggeredBy", () => {
      process.env.GITLAB_CI = "true";
      process.env.CI_COMMIT_AUTHOR = "Author Name";

      const result = detectCI();
      expect(result!.triggeredBy).toBe("Author Name");
    });
  });

  describe("Jenkins", () => {
    it("detects Jenkins", () => {
      process.env.JENKINS_URL = "https://jenkins.example.com/";
      process.env.GIT_COMMIT = "jen123";
      process.env.GIT_BRANCH = "release/1.0";
      process.env.BUILD_URL = "https://jenkins.example.com/job/build/1";
      process.env.BUILD_NUMBER = "42";
      process.env.BUILD_USER = "jenkins-user";

      const result = detectCI();
      expect(result!.provider).toBe("jenkins");
      expect(result!.commitSha).toBe("jen123");
      expect(result!.branch).toBe("release/1.0");
      expect(result!.buildUrl).toBe("https://jenkins.example.com/job/build/1");
      expect(result!.buildId).toBe("42");
      expect(result!.triggeredBy).toBe("jenkins-user");
    });

    it("extracts PR number from CHANGE_ID", () => {
      process.env.JENKINS_URL = "https://jenkins.example.com/";
      process.env.CHANGE_ID = "15";

      const result = detectCI();
      expect(result!.prNumber).toBe(15);
    });

    it("extracts PR number from ghprbPullId", () => {
      process.env.JENKINS_URL = "https://jenkins.example.com/";
      process.env.ghprbPullId = "20";

      const result = detectCI();
      expect(result!.prNumber).toBe(20);
    });

    it("extracts repo from GIT_URL", () => {
      process.env.JENKINS_URL = "https://jenkins.example.com/";
      process.env.GIT_URL = "https://github.com/owner/repo.git";

      const result = detectCI();
      expect(result!.repo).toBe("owner/repo");
    });
  });

  describe("CircleCI", () => {
    it("detects CircleCI", () => {
      process.env.CIRCLECI = "true";
      process.env.CIRCLE_PROJECT_USERNAME = "owner";
      process.env.CIRCLE_PROJECT_REPONAME = "repo";
      process.env.CIRCLE_SHA1 = "circ123";
      process.env.CIRCLE_BRANCH = "main";
      process.env.CIRCLE_BUILD_URL = "https://circleci.com/build/1";
      process.env.CIRCLE_BUILD_NUM = "55";
      process.env.CIRCLE_USERNAME = "circuser";

      const result = detectCI();
      expect(result!.provider).toBe("circleci");
      expect(result!.repo).toBe("owner/repo");
      expect(result!.commitSha).toBe("circ123");
      expect(result!.branch).toBe("main");
      expect(result!.buildUrl).toBe("https://circleci.com/build/1");
      expect(result!.buildId).toBe("55");
      expect(result!.triggeredBy).toBe("circuser");
    });

    it("extracts PR number from CIRCLE_PULL_REQUEST URL", () => {
      process.env.CIRCLECI = "true";
      process.env.CIRCLE_PULL_REQUEST = "https://github.com/owner/repo/pull/33";

      const result = detectCI();
      expect(result!.prNumber).toBe(33);
    });
  });

  describe("Azure Pipelines", () => {
    it("detects Azure Pipelines", () => {
      process.env.TF_BUILD = "True";
      process.env.BUILD_REPOSITORY_NAME = "my-repo";
      process.env.BUILD_SOURCEVERSION = "azure123";
      process.env.BUILD_SOURCEBRANCH = "refs/heads/feature";
      process.env.BUILD_BUILDID = "789";
      process.env.BUILD_REQUESTEDFOR = "azureuser";
      process.env.SYSTEM_TEAMFOUNDATIONSERVERURI = "https://dev.azure.com/org/";
      process.env.SYSTEM_TEAMPROJECT = "myproject";

      const result = detectCI();
      expect(result!.provider).toBe("azure_pipelines");
      expect(result!.repo).toBe("my-repo");
      expect(result!.commitSha).toBe("azure123");
      expect(result!.branch).toBe("feature");
      expect(result!.buildId).toBe("789");
      expect(result!.triggeredBy).toBe("azureuser");
      expect(result!.buildUrl).toBe("https://dev.azure.com/org/myproject/_build/results?buildId=789");
    });

    it("strips refs/heads/ from branch", () => {
      process.env.TF_BUILD = "True";
      process.env.BUILD_SOURCEBRANCH = "refs/heads/release/2.0";

      const result = detectCI();
      expect(result!.branch).toBe("release/2.0");
    });

    it("extracts PR number from SYSTEM_PULLREQUEST_PULLREQUESTID", () => {
      process.env.TF_BUILD = "True";
      process.env.SYSTEM_PULLREQUEST_PULLREQUESTID = "50";

      const result = detectCI();
      expect(result!.prNumber).toBe(50);
    });
  });

  describe("Bitbucket Pipelines", () => {
    it("detects Bitbucket Pipelines", () => {
      process.env.BITBUCKET_BUILD_NUMBER = "10";
      process.env.BITBUCKET_REPO_FULL_NAME = "team/repo";
      process.env.BITBUCKET_COMMIT = "bb123";
      process.env.BITBUCKET_BRANCH = "main";

      const result = detectCI();
      expect(result!.provider).toBe("bitbucket_pipelines");
      expect(result!.repo).toBe("team/repo");
      expect(result!.commitSha).toBe("bb123");
      expect(result!.branch).toBe("main");
      expect(result!.buildId).toBe("10");
      expect(result!.buildUrl).toBe("https://bitbucket.org/team/repo/pipelines/results/10");
    });

    it("extracts PR number from BITBUCKET_PR_ID", () => {
      process.env.BITBUCKET_BUILD_NUMBER = "10";
      process.env.BITBUCKET_PR_ID = "8";

      const result = detectCI();
      expect(result!.prNumber).toBe(8);
    });
  });

  describe("TeamCity", () => {
    it("detects TeamCity", () => {
      process.env.TEAMCITY_VERSION = "2023.11";
      process.env.BUILD_VCS_NUMBER = "tc123";
      process.env.BRANCH_NAME = "develop";
      process.env.BUILD_NUMBER = "100";
      process.env.BUILD_URL = "https://teamcity.example.com/build/100";

      const result = detectCI();
      expect(result!.provider).toBe("teamcity");
      expect(result!.commitSha).toBe("tc123");
      expect(result!.branch).toBe("develop");
      expect(result!.buildId).toBe("100");
      expect(result!.buildUrl).toBe("https://teamcity.example.com/build/100");
    });
  });

  describe("Travis CI", () => {
    it("detects Travis CI", () => {
      process.env.TRAVIS = "true";
      process.env.TRAVIS_REPO_SLUG = "owner/repo";
      process.env.TRAVIS_COMMIT = "trav123";
      process.env.TRAVIS_BRANCH = "main";
      process.env.TRAVIS_PULL_REQUEST = "false";
      process.env.TRAVIS_BUILD_WEB_URL = "https://travis-ci.com/build/1";
      process.env.TRAVIS_BUILD_ID = "200";

      const result = detectCI();
      expect(result!.provider).toBe("travis_ci");
      expect(result!.repo).toBe("owner/repo");
      expect(result!.commitSha).toBe("trav123");
      expect(result!.branch).toBe("main");
      expect(result!.prNumber).toBeUndefined();
      expect(result!.buildUrl).toBe("https://travis-ci.com/build/1");
      expect(result!.buildId).toBe("200");
    });

    it("extracts PR number when TRAVIS_PULL_REQUEST is not false", () => {
      process.env.TRAVIS = "true";
      process.env.TRAVIS_PULL_REQUEST = "17";

      const result = detectCI();
      expect(result!.prNumber).toBe(17);
    });
  });
});
