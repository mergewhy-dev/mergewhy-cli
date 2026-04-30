import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("attestCommand", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Set required env so loadConfig doesn't exit
    process.env.MERGEWHY_API_KEY = "test-key";
    // Clear CI vars
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

  it("exits with 1 for invalid type", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { attestCommand } = await import("../commands/attest.js");
    await expect(attestCommand(["--type", "INVALID", "--name", "test", "--passed"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --name is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { attestCommand } = await import("../commands/attest.js");
    await expect(attestCommand(["--type", "TEST_RESULTS"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when neither --passed nor --failed is provided", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { attestCommand } = await import("../commands/attest.js");
    await expect(attestCommand(["--type", "TEST_RESULTS", "--name", "Unit Tests"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid --evidence JSON", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { attestCommand } = await import("../commands/attest.js");
    await expect(
      attestCommand(["--type", "TEST_RESULTS", "--name", "Tests", "--passed", "--evidence", "not-json"]),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct API request on valid input", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "att-1", derId: "der-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { attestCommand } = await import("../commands/attest.js");
    await attestCommand([
      "--type", "TEST_RESULTS",
      "--name", "Unit Tests",
      "--passed",
      "--repo", "owner/repo",
      "--commit", "abc123",
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/attestations"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"type":"TEST_RESULTS"'),
      }),
    );
  });
});

describe("artifactCommand", () => {
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

    const { artifactCommand } = await import("../commands/artifact.js");
    await expect(artifactCommand([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when --sha256 is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { artifactCommand } = await import("../commands/artifact.js");
    await expect(artifactCommand(["--name", "api-server"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid sha256 format", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { artifactCommand } = await import("../commands/artifact.js");
    await expect(artifactCommand(["--name", "api", "--sha256", "not-a-hash"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("accepts valid 64-char hex sha256", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "art-1" }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const validHash = "a".repeat(64);
    const { artifactCommand } = await import("../commands/artifact.js");
    await artifactCommand(["--name", "app", "--sha256", validHash, "--repo", "o/r", "--commit", "abc"]);

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("rejects sha256 that is too short", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { artifactCommand } = await import("../commands/artifact.js");
    await expect(artifactCommand(["--name", "app", "--sha256", "abcdef"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects sha256 with non-hex characters", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const badHash = "g".repeat(64);
    const { artifactCommand } = await import("../commands/artifact.js");
    await expect(artifactCommand(["--name", "app", "--sha256", badHash])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("gateCommand", () => {
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

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid --min-score (negative)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand(["--environment", "prod", "--min-score", "-1"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for invalid --min-score (over 100)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand(["--environment", "prod", "--min-score", "101"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for non-numeric --min-score", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand(["--environment", "prod", "--min-score", "abc"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("defaults min-score to 80", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, score: 90, reason: "ok" }),
    } as Response);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand(["--environment", "staging"])).rejects.toThrow("process.exit");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("min-score=80"),
      expect.anything(),
    );
  });

  it("accepts --env as alias for --environment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, score: 95, reason: "ok" }),
    } as Response);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { gateCommand } = await import("../commands/gate.js");
    await expect(gateCommand(["--env", "production"])).rejects.toThrow("process.exit");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("environment=production"),
      expect.anything(),
    );
  });
});
