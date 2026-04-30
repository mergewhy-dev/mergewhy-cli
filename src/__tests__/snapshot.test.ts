import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("snapshotCommand", () => {
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

  it("exits with 1 when no snapshot type is provided", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");
    await expect(snapshotCommand([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid snapshot type", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");
    await expect(snapshotCommand(["invalid"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when docker is not available", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // execSync will throw since docker ps won't work in test env
    const { snapshotCommand } = await import("../commands/snapshot.js");
    await expect(snapshotCommand(["docker"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when path snapshot has no --path", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");
    await expect(snapshotCommand(["path"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when paths snapshot has no --config", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");
    await expect(snapshotCommand(["paths"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("captures path snapshot and submits to API", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const testDir = join(tmpdir(), "mergewhy-snapshot-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "app.js"), "console.log('hello');");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "snap-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");
    await snapshotCommand(["path", "--path", testDir, "--environment", "staging"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/snapshots"),
      expect.objectContaining({
        method: "POST",
      }),
    );

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.environment).toBe("staging");
    expect(body.artifacts.length).toBeGreaterThan(0);

    rmSync(testDir, { recursive: true, force: true });
  });

  it("accepts all valid snapshot types without crashing on format check", { timeout: 30000 }, async () => {
    // Just verify that valid types don't trigger the "invalid type" error path
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { snapshotCommand } = await import("../commands/snapshot.js");

    // These will all fail at the capture step (no docker/k8s/etc), not at validation
    for (const type of ["docker", "kubernetes", "ecs", "lambda", "s3", "azure", "path", "paths"]) {
      try {
        await snapshotCommand([type]);
      } catch {
        // Expected - they fail at capture, not at type validation
      }
    }

    // The error messages should NOT contain "Snapshot type required"
    const errorCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls;
    const typeErrors = errorCalls.filter(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("Snapshot type required"),
    );
    expect(typeErrors.length).toBe(0);
  });
});
