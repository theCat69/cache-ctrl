/**
 * Runtime guard for Zod `superRefine` contexts.
 *
 * @param value - Candidate refinement context value.
 * @returns Type predicate that confirms `value` exposes Zod-compatible `addIssue`.
 * @remarks This guard avoids unsafe assumptions when helper functions are reused outside
 * Zod's refinement pipeline.
 */
export function isRefinementContext(
  value: unknown,
): value is { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)["addIssue"] === "function";
}

/**
 * Rejects object keys that can be interpreted as traversal-capable file paths.
 *
 * @param record - Object whose keys are validated (for example `facts` map keys).
 * @param ctx - Zod refinement context used to report validation issues.
 * @remarks Security control: blocks keys containing `..`, leading `/`, `\\`, or `\x00`
 * to prevent path-traversal and null-byte injection when keys are later consumed as
 * filesystem-relative paths.
 */
export function rejectTraversalKeys(record: Record<string, unknown>, ctx: unknown): void {
  if (!isRefinementContext(ctx)) {
    return;
  }

  for (const key of Object.keys(record)) {
    if (key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\x00")) {
      ctx.addIssue({
        code: "custom",
        message: `facts key contains a path traversal or invalid character: "${key}"`,
        path: [key],
      });
    }
  }
}
