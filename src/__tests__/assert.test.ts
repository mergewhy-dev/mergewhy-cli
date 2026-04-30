import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("assertCommand", () => {
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

    const { assertCommand } = await import("../commands/assert.js");
    await assertCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("assert"));
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { assertCommand } = await import("../commands/assert.js");
    await expect(assertCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("artifact", () => {
    it("exits with 1 when --sha256 is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["artifact"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 0 when artifact is compliant", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [{ compliant: true, complianceStatus: "passing" }] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["artifact", "--sha256", "a".repeat(64)])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("exits with 1 when artifact is not compliant", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [{ compliant: false }] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["artifact", "--sha256", "a".repeat(64)])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when artifact not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["artifact", "--sha256", "a".repeat(64)])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("snapshot", () => {
    it("exits with 1 when --environment is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["snapshot"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 0 when snapshot is compliant", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ latestSnapshot: { compliant: true, artifactCount: 5, provenanceCount: 5 } }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["snapshot", "--environment", "prod"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("pullrequest", () => {
    it("exits with 1 when SCM provider is invalid", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["pullrequest", "svn"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when --repository is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(
        assertCommand(["pullrequest", "github", "--commit", "abc123"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("accepts 'pr' as alias for 'pullrequest'", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ pullRequests: [{ approved: true, reviewCount: 2, approvalCount: 1 }] }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(
        assertCommand(["pr", "github", "--repository", "o/r", "--commit", "abc"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("approval", () => {
    it("exits with 1 when --sha256 is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["approval", "--environment", "prod"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when --environment is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(assertCommand(["approval", "--sha256", "a".repeat(64)])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 0 when approved", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ approved: true }),
      } as Response);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { assertCommand } = await import("../commands/assert.js");
      await expect(
        assertCommand(["approval", "--sha256", "a".repeat(64), "--environment", "prod"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
