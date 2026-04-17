import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

const {
  lstatMock,
  mkdirMock,
  renameMock,
  unlinkMock,
  writeFileMock,
} = vi.hoisted(() => ({
  lstatMock: vi.fn(),
  mkdirMock: vi.fn(),
  renameMock: vi.fn(),
  unlinkMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  lstat: lstatMock,
  mkdir: mkdirMock,
  rename: renameMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));

import { downloadParser } from "../../src/http/parserDownloader.js";
import { ErrorCode } from "../../src/types/result.js";

describe("downloadParser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    mkdirMock.mockResolvedValue(undefined);
    lstatMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
  });

  it("returns cached parser path when file already exists", async () => {
    lstatMock.mockResolvedValue({
      isSymbolicLink(): boolean {
        return false;
      },
    });

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedWasmPath = resolve("/tmp/parsers/typescript.wasm");
    expect(result.value).toBe(expectedWasmPath);
    expect(lstatMock).toHaveBeenCalledWith(expectedWasmPath);
  });

  it("downloads and atomically writes parser file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1]).buffer),
      }),
    );

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const writtenTempPath = writeFileMock.mock.calls[0]?.[0];
    const expectedFinalPath = resolve("/tmp/parsers/typescript.wasm");
    expect(typeof writtenTempPath).toBe("string");
    expect(writtenTempPath).toContain(`/tmp/parsers/typescript.wasm.tmp.${process.pid}.`);
    expect(writeFileMock).toHaveBeenCalledWith(
      writtenTempPath,
      new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1]),
    );
    expect(renameMock).toHaveBeenCalledWith(writtenTempPath, expectedFinalPath);
  });

  it("returns PARSER_DOWNLOAD_ERROR on http failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSER_DOWNLOAD_ERROR);
  });

  it("returns PARSER_DOWNLOAD_ERROR for unknown language", async () => {
    const result = await downloadParser("ruby", "/tmp/parsers");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSER_DOWNLOAD_ERROR);
    expect(result.error).toContain("No WASM URL configured");
  });

  it("returns PARSER_DOWNLOAD_ERROR for invalid language identifier", async () => {
    const result = await downloadParser("../typescript", "/tmp/parsers");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSER_DOWNLOAD_ERROR);
    expect(result.error).toContain("Invalid language identifier");
  });

  it("uses fetch timeout and redirect error mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    await downloadParser("typescript", "/tmp/parsers");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns PARSER_DOWNLOAD_ERROR when downloaded bytes are not wasm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
      }),
    );

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSER_DOWNLOAD_ERROR);
    expect(result.error).toContain("is not a valid WASM binary");
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("re-downloads parser when cached path is a symlink", async () => {
    lstatMock.mockResolvedValue({
      isSymbolicLink(): boolean {
        return true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer),
      }),
    );

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(true);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("returns PARSER_DOWNLOAD_ERROR on write failure and cleans temp file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01]).buffer),
      }),
    );
    writeFileMock.mockRejectedValue(new Error("disk full"));

    const result = await downloadParser("typescript", "/tmp/parsers");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSER_DOWNLOAD_ERROR);
    const attemptedTempPath = unlinkMock.mock.calls[0]?.[0];
    expect(typeof attemptedTempPath).toBe("string");
    expect(attemptedTempPath).toContain(`/tmp/parsers/typescript.wasm.tmp.${process.pid}.`);
  });
});
