import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { tmpdir } from "os";

describe("fingerprintCommand", () => {
  const testDir = join(tmpdir(), "mergewhy-fingerprint-test-" + Date.now());

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("prints help with no args", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await fingerprintCommand([]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("fingerprint"));
  });

  it("prints help with --help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await fingerprintCommand(["--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("USAGE"));
  });

  it("exits with 1 when target is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["file"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["unknown", "target"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("hashes a file correctly", async () => {
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, "test.txt");
    const content = "hello world\n";
    writeFileSync(filePath, content);

    const expectedHash = createHash("sha256").update(Buffer.from(content)).digest("hex");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await fingerprintCommand(["file", filePath]);

    expect(logSpy).toHaveBeenCalledWith(expectedHash);
  });

  it("exits with 1 for nonexistent file", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["file", "/nonexistent/file.txt"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("hashes a directory deterministically", async () => {
    mkdirSync(join(testDir, "sub"), { recursive: true });
    writeFileSync(join(testDir, "b.txt"), "bbb");
    writeFileSync(join(testDir, "a.txt"), "aaa");
    writeFileSync(join(testDir, "sub", "c.txt"), "ccc");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await fingerprintCommand(["dir", testDir]);

    const hash1 = logSpy.mock.calls[0][0];
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    // Run again to verify determinism
    logSpy.mockClear();
    await fingerprintCommand(["dir", testDir]);
    const hash2 = logSpy.mock.calls[0][0];
    expect(hash2).toBe(hash1);
  });

  it("exits with 1 for nonexistent directory", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["dir", "/nonexistent/dir"])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when file target is a directory", async () => {
    mkdirSync(testDir, { recursive: true });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["file", testDir])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when dir target is a file", async () => {
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, "file.txt");
    writeFileSync(filePath, "data");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await expect(fingerprintCommand(["dir", filePath])).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("produces different hashes for different file contents", async () => {
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, "test.txt");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    writeFileSync(filePath, "content-a");
    const { fingerprintCommand } = await import("../commands/fingerprint.js");
    await fingerprintCommand(["file", filePath]);
    const hash1 = logSpy.mock.calls[0][0];

    logSpy.mockClear();
    writeFileSync(filePath, "content-b");
    await fingerprintCommand(["file", filePath]);
    const hash2 = logSpy.mock.calls[0][0];

    expect(hash1).not.toBe(hash2);
  });
});
