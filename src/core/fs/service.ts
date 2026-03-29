import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import mime from "mime-types";

import type { CouchClient } from "../http/client.js";
import { CliError, EXIT_CODES } from "../errors.js";
import { sha256, toIsoTimestamp } from "../utils.js";
import { editBufferWithEditor } from "../editor/editor.js";
import { ancestorPaths, joinRemotePath, normalizeRemotePath, parentRemotePath, remotePathName } from "./path.js";
import { planPush, type LocalFsEntry } from "./sync.js";
import type { FsDirDoc, FsDoc, FsFileDoc, FsListEntry } from "./types.js";

const FS_META_ID = "cdbfs_meta";

interface CouchRow<T> {
  id: string;
  doc?: T;
}

export class FsService {
  private readonly client: CouchClient;
  private readonly db: string;

  public constructor(client: CouchClient, db: string) {
    this.client = client;
    this.db = db;
  }

  public async init(): Promise<void> {
    try {
      await this.client.dbInfo(this.db);
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "NOT_FOUND") {
        throw error;
      }
      await this.client.createDb(this.db);
    }

    try {
      await this.client.getLocalDoc(this.db, FS_META_ID);
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "NOT_FOUND") {
        throw error;
      }

      await this.client.putLocalDoc(this.db, FS_META_ID, {
        type: "cdbfs",
        version: 1,
        createdAt: toIsoTimestamp()
      });
    }

    try {
      await this.getDoc("/");
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "NOT_FOUND") {
        throw error;
      }

      const timestamp = toIsoTimestamp();
      await this.client.putDoc(this.db, "/", {
        _id: "/",
        type: "dir",
        path: "/",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  public async stat(remotePath: string): Promise<FsDoc> {
    await this.ensureInitialized();
    return this.getDoc(normalizeRemotePath(remotePath));
  }

  public async list(remotePath = "/", recursive = false): Promise<FsListEntry[]> {
    await this.ensureInitialized();
    const basePath = normalizeRemotePath(remotePath);
    const baseDoc = await this.getDoc(basePath);
    if (baseDoc.type !== "dir") {
      throw new CliError("NOT_A_DIRECTORY", `${basePath} is not a directory.`, EXIT_CODES.INPUT);
    }

    const docs = await this.listSubtree(basePath);
    return docs
      .filter((entry) => entry.path !== basePath)
      .filter((entry) => recursive || isDirectChild(basePath, entry.path))
      .map((entry) => ({
        path: entry.path,
        name: remotePathName(entry.path),
        type: entry.type,
        size: entry.type === "file" ? entry.size : undefined,
        mime: entry.type === "file" ? entry.mime : undefined,
        sha256: entry.type === "file" ? entry.sha256 : undefined,
        updatedAt: entry.updatedAt
      }));
  }

  public async mkdir(remotePath: string): Promise<FsDirDoc[]> {
    await this.ensureInitialized();
    const normalized = normalizeRemotePath(remotePath);
    const existing = await this.tryGetDoc(normalized);
    if (existing?.type === "dir") {
      return [existing];
    }
    if (existing?.type === "file") {
      throw new CliError("PATH_IS_FILE", `${normalized} already exists as a file.`, EXIT_CODES.CONFLICT);
    }

    const timestamp = toIsoTimestamp();
    const missingPaths = await this.findMissingDirectories(normalized);
    const docs = missingPaths.map<FsDirDoc>((dirPath) => ({
      _id: dirPath,
      type: "dir",
      path: dirPath,
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    if (docs.length > 0) {
      await this.writeDocs(docs);
    }

    return docs;
  }

  public async readFile(remotePath: string): Promise<{ doc: FsFileDoc; buffer: Buffer }> {
    await this.ensureInitialized();
    const doc = await this.getDoc(normalizeRemotePath(remotePath));
    if (doc.type !== "file") {
      throw new CliError("NOT_A_FILE", `${doc.path} is not a file.`, EXIT_CODES.INPUT);
    }

    const attachment = await this.client.getAttachment(this.db, doc.path, "content");
    return {
      doc,
      buffer: attachment.buffer
    };
  }

  public async cat(remotePath: string): Promise<string> {
    const { buffer } = await this.readFile(remotePath);
    return buffer.toString("utf8");
  }

  public async edit(remotePath: string): Promise<FsFileDoc> {
    const normalized = normalizeRemotePath(remotePath);
    const current = await this.tryReadFile(normalized);
    const initial = current?.buffer ?? Buffer.from("", "utf8");
    const updated = await editBufferWithEditor(initial, {
      fileName: remotePathName(normalized)
    });

    if (Buffer.compare(initial, updated) === 0 && current) {
      return current.doc;
    }

    return this.writeFile(normalized, updated, {
      mime: current?.doc.mime ?? "text/plain"
    });
  }

  public async writeFile(
    remotePath: string,
    buffer: Buffer,
    options: { mime?: string } = {}
  ): Promise<FsFileDoc> {
    await this.ensureInitialized();
    const normalized = normalizeRemotePath(remotePath);
    if (normalized === "/") {
      throw new CliError("INVALID_FILE_PATH", "Cannot write file to root path.", EXIT_CODES.INPUT);
    }

    await this.mkdir(parentRemotePath(normalized));

    const existing = await this.tryGetDoc(normalized);
    if (existing?.type === "dir") {
      throw new CliError("PATH_IS_DIRECTORY", `${normalized} already exists as a directory.`, EXIT_CODES.CONFLICT);
    }

    const now = toIsoTimestamp();
    const fileDoc: FsFileDoc = {
      _id: normalized,
      _rev: existing?._rev,
      type: "file",
      path: normalized,
      size: buffer.byteLength,
      mime: options.mime ?? detectMime(normalized),
      sha256: sha256(buffer),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    const writeResults = await this.writeDocs([fileDoc]);
    const fileResult = writeResults[0];
    const rev = fileResult.rev;
    if (!rev) {
      throw new CliError("WRITE_FAILED", `Failed to update metadata for ${normalized}.`, EXIT_CODES.NETWORK);
    }

    const attachmentResult = await this.client.putAttachment(
      this.db,
      normalized,
      "content",
      buffer,
      rev,
      fileDoc.mime
    );

    return {
      ...fileDoc,
      _rev: attachmentResult.rev
    };
  }

  public async putLocalFile(localFile: string, remotePath: string): Promise<FsFileDoc> {
    const buffer = await readFile(localFile);
    return this.writeFile(remotePath, buffer, {
      mime: detectMime(localFile)
    });
  }

  public async getToLocalFile(remotePath: string, localFile: string): Promise<void> {
    const { buffer } = await this.readFile(remotePath);
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, buffer);
  }

  public async remove(remotePath: string, recursive = false): Promise<number> {
    await this.ensureInitialized();
    const normalized = normalizeRemotePath(remotePath);
    if (normalized === "/") {
      throw new CliError("ROOT_PROTECTED", "Refusing to delete root directory.", EXIT_CODES.INPUT);
    }

    const target = await this.getDoc(normalized);
    const subtree = target.type === "dir" ? await this.listSubtree(normalized) : [target];
    if (target.type === "dir" && !recursive && subtree.some((entry) => entry.path !== normalized)) {
      throw new CliError(
        "DIRECTORY_NOT_EMPTY",
        `${normalized} is not empty. Use --recursive to remove it.`,
        EXIT_CODES.INPUT
      );
    }

    const docs = subtree.map((entry) => ({
      _id: entry._id,
      _rev: entry._rev,
      _deleted: true
    }));
    const results = await this.writeDocs(docs);
    return results.length;
  }

  public async pushDirectory(localDir: string, remotePath = "/"): Promise<{
    createdDirs: number;
    uploadedFiles: number;
    skippedFiles: number;
  }> {
    await this.ensureInitialized();
    const normalized = normalizeRemotePath(remotePath);
    const localEntries = await scanLocalDirectory(localDir, normalized);
    const remoteEntries = await this.listSubtree(normalized).catch(async (error: unknown) => {
      if (error instanceof CliError && error.code === "NOT_FOUND") {
        await this.mkdir(normalized);
        return this.listSubtree(normalized);
      }
      throw error;
    });

    const pushPlan = planPush(localEntries, remoteEntries);
    if (pushPlan.createDirs.length > 0) {
      const timestamp = toIsoTimestamp();
      const dirDocs = pushPlan.createDirs.map<FsDirDoc>((dirPath) => ({
        _id: dirPath,
        type: "dir",
        path: dirPath,
        createdAt: timestamp,
        updatedAt: timestamp
      }));
      await this.writeDocs(dirDocs);
    }

    for (const entry of pushPlan.upsertFiles) {
      if (!entry.sourcePath) {
        continue;
      }
      await this.putLocalFile(entry.sourcePath, entry.path);
    }

    return {
      createdDirs: pushPlan.createDirs.length,
      uploadedFiles: pushPlan.upsertFiles.length,
      skippedFiles: pushPlan.skippedFiles.length
    };
  }

  public async pullDirectory(remotePath: string, localDir: string): Promise<{
    files: number;
    directories: number;
  }> {
    await this.ensureInitialized();
    const normalized = normalizeRemotePath(remotePath);
    const root = await this.getDoc(normalized);
    if (root.type !== "dir") {
      throw new CliError("NOT_A_DIRECTORY", `${normalized} is not a directory.`, EXIT_CODES.INPUT);
    }

    const docs = await this.listSubtree(normalized);
    let directories = 0;
    let files = 0;

    for (const doc of docs) {
      const relative = doc.path === normalized ? "" : doc.path.slice(normalized === "/" ? 1 : normalized.length + 1);
      const localPath = relative ? path.join(localDir, relative) : localDir;

      if (doc.type === "dir") {
        await mkdir(localPath, { recursive: true });
        directories += 1;
        continue;
      }

      const attachment = await this.client.getAttachment(this.db, doc.path, "content");
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, attachment.buffer);
      files += 1;
    }

    return { files, directories };
  }

  private async ensureInitialized(): Promise<void> {
    await this.client.getLocalDoc(this.db, FS_META_ID);
  }

  private async getDoc(remotePath: string): Promise<FsDoc> {
    return this.client.getDoc<FsDoc>(this.db, remotePath);
  }

  private async tryGetDoc(remotePath: string): Promise<FsDoc | undefined> {
    try {
      return await this.getDoc(remotePath);
    } catch (error) {
      if (error instanceof CliError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  private async tryReadFile(
    remotePath: string
  ): Promise<{ doc: FsFileDoc; buffer: Buffer } | undefined> {
    try {
      return await this.readFile(remotePath);
    } catch (error) {
      if (error instanceof CliError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  private async listSubtree(remotePath: string): Promise<FsDoc[]> {
    const normalized = normalizeRemotePath(remotePath);
    const range = subtreeRange(normalized);
    const response = await this.client.allDocs(this.db, {
      include_docs: true,
      startkey: JSON.stringify(range.startkey),
      endkey: JSON.stringify(range.endkey)
    });

    return response.rows
      .map((row) => (row as CouchRow<FsDoc>).doc)
      .filter((doc): doc is FsDoc => Boolean(doc) && typeof doc?.path === "string");
  }

  private async findMissingDirectories(remotePath: string): Promise<string[]> {
    const missing: string[] = [];
    for (const ancestor of ancestorPaths(remotePath)) {
      const doc = await this.tryGetDoc(ancestor);
      if (!doc) {
        missing.push(ancestor);
      } else if (doc.type !== "dir") {
        throw new CliError("PATH_IS_FILE", `${ancestor} exists as a file.`, EXIT_CODES.CONFLICT);
      }
    }
    return missing;
  }

  private async writeDocs(docs: object[]): Promise<
    Array<{ ok?: boolean; id: string; rev?: string; error?: string; reason?: string }>
  > {
    const results = await this.client.bulkDocs(this.db, docs);
    const conflict = results.find((entry) => entry.error);
    if (conflict) {
      throw new CliError("CONFLICT", conflict.reason ?? "Conflict while writing fs metadata.", EXIT_CODES.CONFLICT, {
        id: conflict.id
      });
    }
    return results;
  }
}

function detectMime(filePath: string): string {
  return mime.lookup(filePath) || "application/octet-stream";
}

function subtreeRange(remotePath: string): { startkey: string; endkey: string } {
  if (remotePath === "/") {
    return {
      startkey: "/",
      endkey: "/\ufff0"
    };
  }

  return {
    startkey: remotePath,
    endkey: `${remotePath}/\ufff0`
  };
}

function isDirectChild(basePath: string, targetPath: string): boolean {
  const relative = targetPath.slice(basePath === "/" ? 1 : basePath.length + 1);
  return relative.length > 0 && !relative.includes("/");
}

async function scanLocalDirectory(localDir: string, remoteRoot: string): Promise<LocalFsEntry[]> {
  const rootStat = await stat(localDir);
  if (!rootStat.isDirectory()) {
    throw new CliError("LOCAL_NOT_DIRECTORY", `${localDir} is not a directory.`, EXIT_CODES.INPUT);
  }

  const entries: LocalFsEntry[] = [{ path: remoteRoot, type: "dir", sourcePath: localDir }];

  async function walk(currentLocalDir: string, currentRemoteDir: string): Promise<void> {
    const children = await readdir(currentLocalDir, { withFileTypes: true });
    for (const child of children) {
      const localPath = path.join(currentLocalDir, child.name);
      const remotePath = joinRemotePath(currentRemoteDir, child.name);

      if (child.isDirectory()) {
        entries.push({ path: remotePath, type: "dir", sourcePath: localPath });
        await walk(localPath, remotePath);
        continue;
      }

      if (!child.isFile()) {
        continue;
      }

      const buffer = await readFile(localPath);
      entries.push({
        path: remotePath,
        type: "file",
        size: buffer.byteLength,
        mime: detectMime(localPath),
        sha256: sha256(buffer),
        sourcePath: localPath
      });
    }
  }

  await walk(localDir, remoteRoot);
  return entries;
}
