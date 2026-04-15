import { afterEach, describe, expect, it, vi } from "vitest";

import { getXdgCacheDir } from "../../src/platform/xdg.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getXdgCacheDir", () => {
  it("uses XDG_CACHE_HOME when provided", () => {
    vi.stubEnv("XDG_CACHE_HOME", "/tmp/custom-cache");

    expect(getXdgCacheDir("cache-ctrl")).toBe("/tmp/custom-cache/cache-ctrl");
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is unset", () => {
    vi.stubEnv("XDG_CACHE_HOME", "");

    const resolved = getXdgCacheDir("cache-ctrl");
    expect(resolved.endsWith("/.cache/cache-ctrl")).toBe(true);
  });

  it("ignores relative XDG_CACHE_HOME and falls back to ~/.cache", () => {
    vi.stubEnv("XDG_CACHE_HOME", "relative-cache");

    const resolved = getXdgCacheDir("cache-ctrl");
    expect(resolved.endsWith("/.cache/cache-ctrl")).toBe(true);
  });
});
