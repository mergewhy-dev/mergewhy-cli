import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";

describe("loadConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.MERGEWHY_API_URL;
    delete process.env.MERGEWHY_API_KEY;
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it("reads MERGEWHY_API_URL and MERGEWHY_API_KEY from env", () => {
    process.env.MERGEWHY_API_KEY = "test-key-123";
    process.env.MERGEWHY_API_URL = "https://custom.example.com";

    const config = loadConfig();
    expect(config.apiKey).toBe("test-key-123");
    expect(config.apiUrl).toBe("https://custom.example.com");
  });

  it("defaults apiUrl to https://mergewhy.com", () => {
    process.env.MERGEWHY_API_KEY = "test-key";

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://mergewhy.com");
  });

  it("strips trailing slashes from API URL", () => {
    process.env.MERGEWHY_API_KEY = "test-key";
    process.env.MERGEWHY_API_URL = "https://custom.example.com///";

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://custom.example.com");
  });

  it("exits if MERGEWHY_API_KEY is not set", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => loadConfig()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("MERGEWHY_API_KEY"));
  });
});

describe("apiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct headers and body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "123" }),
    } as Response);

    const config = { apiUrl: "https://api.test.com", apiKey: "key-abc" };
    await apiRequest(config, "POST", "/api/v1/test", { foo: "bar" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.com/api/v1/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer key-abc",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ foo: "bar" }),
      }),
    );
  });

  it("returns parsed JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "abc", derId: "der-1" }),
    } as Response);

    const config = { apiUrl: "https://api.test.com", apiKey: "key" };
    const result = await apiRequest(config, "GET", "/api/v1/test");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: "abc", derId: "der-1" });
  });

  it("handles non-JSON responses gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    } as unknown as Response);

    const config = { apiUrl: "https://api.test.com", apiKey: "key" };
    const result = await apiRequest(config, "GET", "/api/v1/broken");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.data).toEqual({});
  });

  it("does not send body for GET requests without body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const config = { apiUrl: "https://api.test.com", apiKey: "key" };
    await apiRequest(config, "GET", "/test");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.com/test",
      expect.objectContaining({ body: undefined }),
    );
  });
});

describe("formatSuccess", () => {
  it("logs a success message", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    formatSuccess("Done!");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Done!"));
    logSpy.mockRestore();
  });

  it("logs details when provided", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    formatSuccess("Done!", { id: "123" });
    expect(logSpy).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });
});

describe("formatError", () => {
  it("logs an error message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    formatError("Failed!");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed!"));
    errorSpy.mockRestore();
  });

  it("logs details when provided", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    formatError("Failed!", { reason: "timeout" });
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
