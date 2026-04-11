# Canonical catch-all error handling — convert unknown throws with toUnknownResult(err)

Use `toUnknownResult(err)` in command-level `catch` blocks so every unexpected exception is
returned as a typed `Result` failure with `ErrorCode.UNKNOWN`.

```typescript
// src/commands/list.ts

import { toUnknownResult } from "../utils/errors.js";
import { type Result } from "../types/result.js";
import type { ListArgs, ListResult } from "../types/commands.js";

export async function listCommand(args: ListArgs): Promise<Result<ListResult["value"]>> {
  try {
    // ... command orchestration
    return { ok: true, value: [] };
  } catch (err) {
    return toUnknownResult(err);
  }
}
```

```typescript
// src/commands/writeLocal.ts

import { toUnknownResult } from "../utils/errors.js";

export async function writeLocalCommand(args: WriteArgs): Promise<Result<WriteResult["value"]>> {
  try {
    // ... validation + write path
    return { ok: true, value: { file: "..." } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
```
