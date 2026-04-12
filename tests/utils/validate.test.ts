import { describe, it, expect } from "vitest";
import { validateSubject } from "../../src/utils/validate.js";
import { ErrorCode } from "../../src/types/result.js";
import { rejectTraversalKeys } from "../../src/utils/traversal.js";

describe("validateSubject", () => {
  it("accepts a single-character subject", () => {
    const result = validateSubject("a");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("rejects an empty subject", () => {
    const result = validateSubject("");
    expect(result).toEqual({
      ok: false,
      error: 'Invalid subject "": must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/',
      code: ErrorCode.INVALID_ARGS,
    });
  });

  it("accepts a subject of exactly 128 characters", () => {
    const subject = "a".repeat(128);
    const result = validateSubject(subject);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeUndefined();
  });

  it("rejects a subject of 129 characters", () => {
    const subject = "a".repeat(129);
    const result = validateSubject(subject);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });

  it("rejects a subject starting with a non-alphanumeric character", () => {
    const result = validateSubject("-invalid-start");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });
});

describe("rejectTraversalKeys", () => {
  it("rejects keys containing backslash", () => {
    const issues: Array<{ code: string; message: string; path: string[] }> = [];
    const context = {
      addIssue: (issue: { code: "custom"; message: string; path: string[] }) => {
        issues.push(issue);
      },
    };

    rejectTraversalKeys({ "folder\\name": "value" }, context);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["folder\\name"]);
    expect(issues[0]?.message).toContain("path traversal or invalid character");
  });
});
