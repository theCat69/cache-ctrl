export interface FileSymbols {
  /** Resolved file paths this file imports from (relative imports only, resolved to absolute) */
  deps: string[];
  /** Exported symbol names declared in this file */
  defs: string[];
}
