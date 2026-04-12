import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-search-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("searchCommand - scoring", () => {
  it("exact file stem match scores 100", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "opencode.json"),
      JSON.stringify({
        subject: "opencode",
        description: "Some unrelated description",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["opencode"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "opencode");
    expect(entry).toBeDefined();
    expect(entry!.score).toBe(100);
  });

  it("substring file stem match scores 80", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "opencode-skills.json"),
      JSON.stringify({
        subject: "opencode-skills",
        description: "Skills description",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["skills"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "opencode-skills");
    expect(entry).toBeDefined();
    // stem "opencode-skills" contains "skills" but is not exact match
    expect(entry!.score).toBeGreaterThanOrEqual(80);
  });

  it("subject exact word match scores 70", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "misc-file.json"),
      JSON.stringify({
        subject: "typescript best practices",
        description: "Some description",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["typescript"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "typescript best practices");
    expect(entry).toBeDefined();
    // "misc-file" stem doesn't contain "typescript"
    // subject "typescript best practices" has exact word "typescript" → 70
    expect(entry!.score).toBe(70);
  });

  it("subject substring match scores 50", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "misc-docs.json"),
      JSON.stringify({
        subject: "typescript configuration guide",
        description: "Some description",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["configurati"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "typescript configuration guide");
    expect(entry).toBeDefined();
    // "configurati" is a substring of "configuration" in the subject
    expect(entry!.score).toBe(50);
  });

  it("description keyword match scores 30", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "unrelated.json"),
      JSON.stringify({
        subject: "something else",
        description: "This covers zod validation schemas",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["zod"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "something else");
    expect(entry).toBeDefined();
    expect(entry!.score).toBe(30);
  });

  it("multi-keyword search is additive", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "typescript.json"),
      JSON.stringify({
        subject: "typescript",
        description: "TypeScript configuration docs",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["typescript", "config"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.find((e) => e.subject === "typescript");
    expect(entry).toBeDefined();
    // exact stem "typescript" = 100 + description "config" in "configuration" = 30
    expect(entry!.score).toBeGreaterThan(100);
  });

  it("results are sorted by score descending", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "alpha.json"),
      JSON.stringify({
        subject: "alpha project",
        description: "alpha description",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "alpha-tools.json"),
      JSON.stringify({
        subject: "alpha-tools",
        description: "tooling",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["alpha"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.value.length; i++) {
      expect(result.value[i - 1]!.score).toBeGreaterThanOrEqual(result.value[i]!.score);
    }
  });

  it("case-insensitive matching", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "TypeScript.json"),
      JSON.stringify({
        subject: "TypeScript",
        description: "TypeScript docs",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["typescript"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
  });

  it("files with no match are excluded from results", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "irrelevant.json"),
      JSON.stringify({
        subject: "irrelevant",
        description: "Nothing to see here",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["zxqwerty999"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("invalid JSON files are skipped with warning to stderr", async () => {
    await writeFile(join(tmpDir, EXTERNAL_DIR, "broken.json"), "{ not valid json }");
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "good.json"),
      JSON.stringify({
        subject: "good",
        description: "Good entry",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await searchCommand({ keywords: ["good"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should return the good entry and skip the broken one
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.some((e) => e.subject === "good")).toBe(true);
    expect(result.value.some((e) => e.subject === "broken")).toBe(false);
  });
});
