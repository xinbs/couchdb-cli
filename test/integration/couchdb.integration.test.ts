import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CouchClient } from "../../src/core/http/client.js";
import { FsService } from "../../src/core/fs/service.js";

const url = process.env.COUCHDB_URL;
const user = process.env.COUCHDB_USER;
const password = process.env.COUCHDB_PASSWORD;
const describeIfConfigured = url ? describe : describe.skip;

describeIfConfigured("couchdb integration", () => {
  const dbName = `cdb_cli_test_${Date.now()}`;
  let client: CouchClient;
  let dbClient: CouchClient;
  let fsService: FsService;

  beforeAll(async () => {
    client = new CouchClient({
      baseUrl: url!,
      user,
      password,
      timeoutMs: 10_000
    });
    dbClient = new CouchClient({
      baseUrl: url!,
      user,
      password,
      db: dbName,
      timeoutMs: 10_000
    });
    fsService = new FsService(dbClient, dbName);
    await client.createDb(dbName);
  });

  afterAll(async () => {
    await client.deleteDb(dbName);
  });

  it("supports document and attachment CRUD", async () => {
    await dbClient.putDoc(undefined, "doc-1", {
      _id: "doc-1",
      type: "note",
      title: "hello"
    });

    const doc = await dbClient.getDoc<Record<string, unknown>>(undefined, "doc-1");
    expect(doc.title).toBe("hello");

    const attachmentResult = await dbClient.putAttachment(
      undefined,
      "doc-1",
      "hello.txt",
      Buffer.from("world", "utf8"),
      doc._rev as string,
      "text/plain"
    );

    const attachment = await dbClient.getAttachment(undefined, "doc-1", "hello.txt");
    expect(attachment.buffer.toString("utf8")).toBe("world");

    await dbClient.deleteAttachment(undefined, "doc-1", "hello.txt", attachmentResult.rev);
    const updatedDoc = await dbClient.getDoc<Record<string, unknown>>(undefined, "doc-1");
    await dbClient.deleteDoc(undefined, "doc-1", updatedDoc._rev as string);
  });

  it("supports fs init, file writes, push, and pull", async () => {
    await fsService.init();
    await fsService.mkdir("/app/src");
    await fsService.writeFile("/app/src/index.txt", Buffer.from("console.log('hi')\n", "utf8"), {
      mime: "text/plain"
    });

    expect(await fsService.cat("/app/src/index.txt")).toContain("console.log");

    const localRoot = await mkdtemp(path.join(os.tmpdir(), "cdb-cli-local-"));
    const localPush = path.join(localRoot, "push");
    const localPull = path.join(localRoot, "pull");

    try {
      await fsService.pullDirectory("/app", localPull);
      expect((await readFile(path.join(localPull, "src/index.txt"), "utf8")).trim()).toBe("console.log('hi')");

      await mkdir(localPush, { recursive: true });
      await writeFile(path.join(localPush, "README.md"), "# hello\n", "utf8");
      await fsService.pushDirectory(localPush, "/app");
      expect(await fsService.cat("/app/README.md")).toBe("# hello\n");
    } finally {
      await rm(localRoot, { recursive: true, force: true });
    }
  });
});
