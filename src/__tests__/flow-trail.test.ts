import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("flowCommand", () => {
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

    const { flowCommand } = await import("../commands/flow.js");
    await flowCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("flow"));
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { flowCommand } = await import("../commands/flow.js");
    await expect(flowCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("create", () => {
    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { flowCommand } = await import("../commands/flow.js");
      await expect(flowCommand(["create"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct create request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "flow-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { flowCommand } = await import("../commands/flow.js");
      await flowCommand(["create", "--name", "Payment Service", "--description", "Core payments"]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe("Payment Service");
      expect(body.description).toBe("Core payments");
    });
  });

  describe("list", () => {
    it("sends GET request to /api/v1/flows", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ flows: [], total: 0 }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { flowCommand } = await import("../commands/flow.js");
      await flowCommand(["list"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/flows"),
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("get", () => {
    it("exits with 1 when neither --name nor --id provided", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { flowCommand } = await import("../commands/flow.js");
      await expect(flowCommand(["get"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct get request with --name", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          flows: [{ id: "f-1", name: "API Gateway", description: "", artifactCount: 0, environmentCount: 0 }],
        }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { flowCommand } = await import("../commands/flow.js");
      await flowCommand(["get", "--name", "API Gateway"]);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("name=API+Gateway"),
        expect.anything(),
      );
    });
  });
});

describe("trailCommand", () => {
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

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { trailCommand } = await import("../commands/trail.js");
    await expect(trailCommand(["unknown"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  describe("create", () => {
    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await expect(trailCommand(["create"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct create request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "trail-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await trailCommand(["create", "--name", "Release v2.1", "--repo", "owner/repo"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/trails"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"Release v2.1"'),
        }),
      );
    });
  });

  describe("attest", () => {
    it("exits with 1 when --trail-id is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await expect(trailCommand(["attest", "--name", "Test"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits with 1 when --name is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await expect(trailCommand(["attest", "--trail-id", "t-1"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct attest request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "att-1" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await trailCommand([
        "attest", "--trail-id", "t-1", "--type", "TEST_RESULTS", "--name", "Unit Tests", "--passed",
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/trails/t-1/attestations"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("complete", () => {
    it("exits with 1 when --trail-id is missing", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await expect(trailCommand(["complete"])).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends correct complete request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "complete" }),
      } as Response);
      vi.spyOn(console, "log").mockImplementation(() => {});

      const { trailCommand } = await import("../commands/trail.js");
      await trailCommand(["complete", "--trail-id", "t-1"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/trails/t-1/complete"),
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });
});
