import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("approveCommand", () => {
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

  it("prints help with no args", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { approveCommand } = await import("../commands/approve.js");
    await approveCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("approve"));
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { approveCommand } = await import("../commands/approve.js");
    await expect(approveCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --artifact-sha256 is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { approveCommand } = await import("../commands/approve.js");
    await expect(
      approveCommand(["request", "--environment", "prod"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --environment is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { approveCommand } = await import("../commands/approve.js");
    await expect(
      approveCommand(["request", "--artifact-sha256", "a".repeat(64)]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("request", () => {
    it("sends correct request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "apr-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await approveCommand([
        "request", "--artifact-sha256", sha, "--environment", "production",
      ]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.artifactSha256).toBe(sha);
      expect(body.environment).toBe("production");
    });
  });

  describe("report", () => {
    it("exits with 1 when --approver is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await expect(
        approveCommand(["report", "--artifact-sha256", sha, "--environment", "prod"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct report with approver", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "apr-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await approveCommand([
        "report", "--artifact-sha256", sha, "--environment", "prod", "--approver", "cto@co.com",
      ]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.approver).toBe("cto@co.com");
      expect(body.approved).toBe(true);
    });

    it("sets approved=false when --rejected is provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "apr-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await approveCommand([
        "report", "--artifact-sha256", sha, "--environment", "prod",
        "--approver", "cto@co.com", "--rejected",
      ]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.approved).toBe(false);
    });
  });

  describe("check", () => {
    it("exits with 0 when approved", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ approved: true, approvals: [{}] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await expect(
        approveCommand(["check", "--artifact-sha256", sha, "--environment", "prod"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("exits with 1 when not approved", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ approved: false }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      const sha = "a".repeat(64);
      const { approveCommand } = await import("../commands/approve.js");
      await expect(
        approveCommand(["check", "--artifact-sha256", sha, "--environment", "prod"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
