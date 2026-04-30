import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("evaluateCommand", () => {
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

    const { evaluateCommand } = await import("../commands/evaluate.js");
    await evaluateCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("evaluate"));
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { evaluateCommand } = await import("../commands/evaluate.js");
    await expect(evaluateCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("trail", () => {
    it("exits with 1 when --flow is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { evaluateCommand } = await import("../commands/evaluate.js");
      await expect(evaluateCommand(["trail"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 0 when all trails pass", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          trails: [
            { name: "Release v1", requiredAttestations: ["test", "scan"], completedAttestations: ["test", "scan"] },
          ],
        }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { evaluateCommand } = await import("../commands/evaluate.js");
      await expect(
        evaluateCommand(["trail", "--flow", "Payment Service"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("exits with 1 when trails fail", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          trails: [
            { name: "Release v1", requiredAttestations: ["test", "scan"], completedAttestations: ["test"] },
          ],
        }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { evaluateCommand } = await import("../commands/evaluate.js");
      await expect(
        evaluateCommand(["trail", "--flow", "Payment Service"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when no trails found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ trails: [] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { evaluateCommand } = await import("../commands/evaluate.js");
      await expect(
        evaluateCommand(["trail", "--flow", "Nonexistent"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

describe("expectCommand", () => {
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

    const { expectCommand } = await import("../commands/expect.js");
    await expectCommand(["--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("expect"));
  });

  it("exits with 1 when --environment is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { expectCommand } = await import("../commands/expect.js");
    await expect(
      expectCommand(["--artifact-sha256", "a".repeat(64)]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --artifact-sha256 is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { expectCommand } = await import("../commands/expect.js");
    await expect(
      expectCommand(["--environment", "prod"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct expect request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "dep-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sha = "d".repeat(64);
    const { expectCommand } = await import("../commands/expect.js");
    await expectCommand(["--environment", "production", "--artifact-sha256", sha]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.environment).toBe("production");
    expect(body.artifactSha256).toBe(sha);
    expect(body.status).toBe("expected");
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

    const sha = "d".repeat(64);
    const { expectCommand } = await import("../commands/expect.js");
    await expect(
      expectCommand(["--environment", "prod", "--artifact-sha256", sha]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
