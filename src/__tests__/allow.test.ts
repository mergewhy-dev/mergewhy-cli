import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("allowCommand", () => {
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

  it("prints help with --help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await allowCommand(["--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("allow"));
  });

  it("exits with 1 when --artifact-sha256 is missing (add)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await expect(
      allowCommand(["--environment", "prod", "--reason", "test"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --environment is missing (add)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await expect(
      allowCommand(["--artifact-sha256", "a".repeat(64), "--reason", "test"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --reason is missing (add)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await expect(
      allowCommand(["--artifact-sha256", "a".repeat(64), "--environment", "prod"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct add request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "allow-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sha = "b".repeat(64);
    const { allowCommand } = await import("../commands/allow.js");
    await allowCommand([
      "--artifact-sha256", sha, "--environment", "prod", "--reason", "Vendor image",
    ]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.artifactSha256).toBe(sha);
    expect(body.environment).toBe("prod");
    expect(body.reason).toBe("Vendor image");
  });

  it("sends list request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: [] }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await allowCommand(["list", "--environment", "prod"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/allowlist"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends remove request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sha = "c".repeat(64);
    const { allowCommand } = await import("../commands/allow.js");
    await allowCommand(["remove", "--artifact-sha256", sha, "--environment", "prod"]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.action).toBe("remove");
  });

  it("exits with 1 when remove is missing --artifact-sha256", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { allowCommand } = await import("../commands/allow.js");
    await expect(
      allowCommand(["remove", "--environment", "prod"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
