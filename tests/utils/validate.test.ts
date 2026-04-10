import { describe, it, expect } from "vitest";
import { validateSubject } from "../../src/utils/validate.js";
import { ErrorCode } from "../../src/types/result.js";

describe("validateSubject", () => {
  it("accepts a subject of exactly 128 characters", () => {
    const subject = "a".repeat(128);
    const result = validateSubject(subject);
    expect(result.ok).toBe(true);
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
