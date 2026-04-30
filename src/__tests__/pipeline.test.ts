import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("pipelineCommand", () => {
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

  it("exits with 1 when --name is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await expect(pipelineCommand(["--status", "success"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid status", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await expect(pipelineCommand(["--name", "Build", "--status", "invalid"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --status is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await expect(pipelineCommand(["--name", "Build"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct API request on valid input", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "pipe-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await pipelineCommand([
      "--name", "Build & Test",
      "--status", "success",
      "--repo", "owner/repo",
      "--commit", "abc123",
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/pipeline-runs"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"workflowName":"Build & Test"'),
      }),
    );
  });

  it("accepts all valid statuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "pipe-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");

    for (const status of ["success", "failure", "running", "cancelled", "pending"]) {
      await pipelineCommand(["--name", "Build", "--status", status]);
    }

    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });

  it("exits with 1 for invalid --steps JSON", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await expect(
      pipelineCommand(["--name", "Build", "--status", "success", "--steps", "not-json"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("includes steps when valid JSON is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "pipe-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const steps = JSON.stringify([{ name: "lint", status: "success" }]);
    const { pipelineCommand } = await import("../commands/pipeline.js");
    await pipelineCommand(["--name", "Build", "--status", "success", "--steps", steps]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.steps).toEqual([{ name: "lint", status: "success" }]);
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

    const { pipelineCommand } = await import("../commands/pipeline.js");
    await expect(
      pipelineCommand(["--name", "Build", "--status", "success"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
