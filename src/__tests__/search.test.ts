import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("searchCommand", () => {
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

    const { searchCommand } = await import("../commands/search.js");
    await searchCommand(["--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("search"));
  });

  it("exits with 1 when neither --fingerprint nor --commit provided", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { searchCommand } = await import("../commands/search.js");
    await expect(searchCommand([])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sends correct fingerprint search", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], total: 0 }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { searchCommand } = await import("../commands/search.js");
    await searchCommand(["--fingerprint", "a".repeat(64)]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("fingerprint=" + "a".repeat(64)),
      expect.anything(),
    );
  });

  it("sends correct commit search", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], total: 0 }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { searchCommand } = await import("../commands/search.js");
    await searchCommand(["--commit", "abc123"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("commit=abc123"),
      expect.anything(),
    );
  });

  it("includes --type filter when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [], total: 0 }),
    } as Response);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { searchCommand } = await import("../commands/search.js");
    await searchCommand(["--commit", "abc", "--type", "artifact"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("type=artifact"),
      expect.anything(),
    );
  });

  it("displays results table", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { type: "artifact", id: "art-123456789012", name: "api-server", status: "compliant" },
        ],
        total: 1,
      }),
    } as Response);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { searchCommand } = await import("../commands/search.js");
    await searchCommand(["--fingerprint", "a".repeat(64)]);

    // Should have logged the success message and table
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 result"));
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

    const { searchCommand } = await import("../commands/search.js");
    await expect(searchCommand(["--fingerprint", "abc"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
