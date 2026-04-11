export function isRefinementContext(
  value: unknown,
): value is { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)["addIssue"] === "function";
}

export function rejectTraversalKeys(record: Record<string, unknown>, ctx: unknown): void {
  if (!isRefinementContext(ctx)) {
    return;
  }

  for (const key of Object.keys(record)) {
    if (key.includes("..") || key.startsWith("/") || key.includes("\x00")) {
      ctx.addIssue({
        code: "custom",
        message: `facts key contains a path traversal or invalid character: "${key}"`,
        path: [key],
      });
    }
  }
}
