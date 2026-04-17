#!/usr/bin/env bun

import { toUnknownResult } from "../src/errors.js";
import { main } from "../src/index.js";

void main().catch((error) => {
  process.stderr.write(JSON.stringify(toUnknownResult(error)) + "\n");
  process.exit(1);
});
