import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("deployCommand", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.MERGEWHY_API_KEY = "test-key";
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITLAB_CI;
    delete process.env.JENKINS_URL;
    delete process.env.CIRCLECI;
    delete process.env.TF_BUILD;
    delete process.env.BITBUCKET_BUILD_NUMBER;
    delete process.env.TEAMCITY_VERSION;
    delete process.env.TRAVIS;
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it("exits with 1 when --environment is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await expect(deployCommand([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct API request with environment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await deployCommand([
      "--environment", "production",
      "--repo", "owner/repo",
      "--commit", "abc123",
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/deployments"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"environmentName":"production"'),
      }),
    );
  });

  it("defaults status to SUCCESS", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await deployCommand(["--environment", "staging"]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.status).toBe("SUCCESS");
  });

  it("maps status aliases correctly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await deployCommand(["--environment", "staging", "--status", "running"]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.status).toBe("IN_PROGRESS");
  });

  it("includes artifact-sha256 when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await deployCommand(["--environment", "prod", "--artifact-sha256", "a".repeat(64)]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.artifactSha256).toBe("a".repeat(64));
  });

  it("exits with 1 on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server error" }),
    } as Response);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await expect(deployCommand(["--environment", "prod"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("accepts --env as alias for --environment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { deployCommand } = await import("../commands/deploy.js");
    await deployCommand(["--env", "staging"]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.environmentName).toBe("staging");
  });
});
