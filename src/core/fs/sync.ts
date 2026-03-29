import type { FsDoc } from "./types.js";

export interface LocalFsEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
  mime?: string;
  sha256?: string;
  sourcePath?: string;
}

export interface PushPlan {
  createDirs: string[];
  upsertFiles: LocalFsEntry[];
  skippedFiles: LocalFsEntry[];
}

export function planPush(localEntries: LocalFsEntry[], remoteEntries: FsDoc[]): PushPlan {
  const remoteMap = new Map(remoteEntries.map((entry) => [entry.path, entry]));
  const createDirs: string[] = [];
  const upsertFiles: LocalFsEntry[] = [];
  const skippedFiles: LocalFsEntry[] = [];

  for (const entry of localEntries) {
    const remote = remoteMap.get(entry.path);

    if (entry.type === "dir") {
      if (!remote || remote.type !== "dir") {
        createDirs.push(entry.path);
      }
      continue;
    }

    if (!remote || remote.type !== "file") {
      upsertFiles.push(entry);
      continue;
    }

    if (remote.sha256 === entry.sha256) {
      skippedFiles.push(entry);
      continue;
    }

    upsertFiles.push(entry);
  }

  return { createDirs, upsertFiles, skippedFiles };
}
