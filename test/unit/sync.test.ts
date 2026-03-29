import { describe, expect, it } from "vitest";

import { planPush } from "../../src/core/fs/sync.js";
import type { FsDoc } from "../../src/core/fs/types.js";

describe("planPush", () => {
  it("creates directories, uploads changed files, and skips unchanged files", () => {
    const localEntries = [
      { path: "/app", type: "dir" as const },
      { path: "/app/src", type: "dir" as const },
      { path: "/app/src/index.js", type: "file" as const, sha256: "new", sourcePath: "/tmp/index.js" },
      { path: "/app/README.md", type: "file" as const, sha256: "same", sourcePath: "/tmp/README.md" }
    ];

    const remoteEntries: FsDoc[] = [
      {
        _id: "/app",
        type: "dir",
        path: "/app",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        _id: "/app/README.md",
        type: "file",
        path: "/app/README.md",
        size: 10,
        mime: "text/markdown",
        sha256: "same",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];

    const plan = planPush(localEntries, remoteEntries);

    expect(plan.createDirs).toEqual(["/app/src"]);
    expect(plan.upsertFiles.map((entry) => entry.path)).toEqual(["/app/src/index.js"]);
    expect(plan.skippedFiles.map((entry) => entry.path)).toEqual(["/app/README.md"]);
  });
});
