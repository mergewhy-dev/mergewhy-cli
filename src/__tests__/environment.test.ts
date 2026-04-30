import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("environmentCommand", () => {
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

    const { environmentCommand } = await import("../commands/environment.js");
    await environmentCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("environment"));
  });

  it("prints help with --help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { environmentCommand } = await import("../commands/environment.js");
    await environmentCommand(["--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("USAGE"));
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { environmentCommand } = await import("../commands/environment.js");
    await expect(environmentCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("create", () => {
    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await expect(environmentCommand(["create"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 for invalid type", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await expect(
        environmentCommand(["create", "--name", "prod", "--type", "invalid"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct create request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "env-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await environmentCommand(["create", "--name", "production", "--type", "k8s"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/environments"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"production"'),
        }),
      );
    });

    it("defaults type to custom", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "env-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await environmentCommand(["create", "--name", "dev"]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.type).toBe("custom");
    });
  });

  describe("list", () => {
    it("sends GET request to /api/v1/environments", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ environments: [] }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await environmentCommand(["list"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/environments"),
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("log", () => {
    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await expect(environmentCommand(["log"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct log request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ entries: [] }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await environmentCommand(["log", "--name", "production"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("name=production"),
        expect.anything(),
      );
    });
  });

  describe("diff", () => {
    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await expect(environmentCommand(["diff"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when --from or --to is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await expect(
        environmentCommand(["diff", "--name", "prod", "--from", "snap_1"]),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct diff request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ added: [], removed: [], changed: [] }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { environmentCommand } = await import("../commands/environment.js");
      await environmentCommand([
        "diff", "--name", "prod", "--from", "snap_1", "--to", "snap_2",
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("from=snap_1"),
        expect.anything(),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("to=snap_2"),
        expect.anything(),
      );
    });
  });
});
