import { describe, expect, it } from "vitest";

import {
  ancestorPaths,
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath
} from "../../src/core/fs/path.js";

describe("remote path helpers", () => {
  it("normalizes slashes and adds a root prefix", () => {
    expect(normalizeRemotePath("folder\\nested\\file.txt")).toBe("/folder/nested/file.txt");
    expect(normalizeRemotePath("/folder/nested/")).toBe("/folder/nested");
  });

  it("joins and finds ancestors consistently", () => {
    expect(joinRemotePath("/folder", "nested", "file.txt")).toBe("/folder/nested/file.txt");
    expect(parentRemotePath("/folder/nested/file.txt")).toBe("/folder/nested");
    expect(ancestorPaths("/folder/nested/file.txt")).toEqual([
      "/",
      "/folder",
      "/folder/nested",
      "/folder/nested/file.txt"
    ]);
  });
});
