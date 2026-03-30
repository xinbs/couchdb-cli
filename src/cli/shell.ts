import { createInterface, type Interface } from "node:readline/promises";
import { cwd as processCwd, stdin, stdout, stderr } from "node:process";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import mime from "mime-types";

import { parseArgsStringToArgv } from "string-argv";

import type { CommandContext } from "./context.js";
import { acquireAuthenticatedConnection } from "../core/auth/session.js";
import { CliError, EXIT_CODES, normalizeError } from "../core/errors.js";
import { ancestorPaths, normalizeRemotePath, joinRemotePath } from "../core/fs/path.js";
import { FsService } from "../core/fs/service.js";
import { CouchClient } from "../core/http/client.js";
import { editBufferWithEditor } from "../core/editor/editor.js";
import { ensureObject, toIsoTimestamp } from "../core/utils.js";
import { formatTable } from "../commands/helpers.js";

interface ShellState {
  url: string;
  user: string;
  db?: string;
  dbMode?: "docs" | "fs";
  timeoutMs: number;
  sessionCookie?: string;
  password?: string;
  cwd: string;
  localCwd: string;
}

const SHELL_COMMANDS = [
  "help",
  "exit",
  "quit",
  "target",
  "mode",
  "whoami",
  "dbs",
  "db",
  "use",
  "use-db",
  "mkdb",
  "createdb",
  "initfs",
  "pwd",
  "lpwd",
  "lcd",
  "cd",
  "ls",
  "stat",
  "mkdir",
  "cat",
  "edit",
  "vim",
  "put",
  "cp",
  "get",
  "push",
  "pull",
  "rz",
  "sz",
  "rm",
  "login",
  "connect"
] as const;

const DOCS_DIR_MARKER = ".__cdb_dir__";

export async function startShell(context: CommandContext): Promise<void> {
  const auth = await acquireAuthenticatedConnection(context, {
    url: context.resolved.url,
    user: context.resolved.user,
    password: context.resolved.password,
    sessionCookie: context.resolved.sessionCookie,
    promptToRemember: true,
    forceFreshLogin: false
  });

  const state: ShellState = {
    url: auth.url,
    user: auth.user,
    db: context.resolved.db,
    dbMode: undefined,
    timeoutMs: context.resolved.timeoutMs,
    sessionCookie: auth.sessionCookie,
    password: auth.password,
    cwd: "/",
    localCwd: processCwd()
  };

  if (state.db && !(await doesDbExist(state, state.db))) {
    stdout.write(`Database ${state.db} does not exist. Starting from server root instead.\n`);
    state.db = undefined;
  }

  const readline = createInterface({
    input: stdin,
    output: stdout,
    completer: async (line: string) => completeShellInput(state, line)
  });

  try {
    while (true) {
      const prompt = `${formatPromptPath(state)}> `;
      const line = await readline.question(prompt);
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        break;
      }

      if (trimmed === "help") {
        printShellHelp();
        continue;
      }

      try {
        const argv = parseArgsStringToArgv(trimmed);
        await runShellCommand(context, state, argv, readline);
      } catch (error) {
        const cliError = normalizeError(error);
        stderr.write(`${cliError.code}: ${cliError.message}\n`);
      }
    }
  } finally {
    readline.close();
  }
}

async function runShellCommand(
  context: CommandContext,
  state: ShellState,
  argv: string[],
  readline: Interface
): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "pwd":
      stdout.write(`${state.cwd}\n`);
      return;
    case "db":
      stdout.write(`${state.db ?? "(server root)"}\n`);
      return;
    case "lpwd":
      stdout.write(`${state.localCwd}\n`);
      return;
    case "lcd":
      await shellLocalCd(state, args[0]);
      return;
    case "mode":
      printCurrentMode(state, await getCurrentMode(state));
      return;
    case "dbs":
      stdout.write(`${(await createClient(state).listDbs()).join("\n")}\n`);
      return;
    case "use":
    case "use-db":
      if (!args[0]) {
        stdout.write("Usage: use <db>\n");
        return;
      }
      if (!(await doesDbExist(state, args[0]))) {
        throw new Error(`Database ${args[0]} does not exist. Use \`dbs\` to list databases.`);
      }
      state.db = args[0];
      state.dbMode = undefined;
      state.cwd = "/";
      stdout.write(`Current db: ${state.db}\n`);
      printCurrentMode(state, await getCurrentMode(state));
      return;
    case "whoami": {
      const session = (await createClient(state).getSession()) as Record<string, unknown>;
      stdout.write(`${JSON.stringify(session, null, 2)}\n`);
      return;
    }
    case "cd":
      await shellCd(state, args[0] ?? "/");
      return;
    case "ls":
      await shellLs(state, args);
      return;
    case "stat":
      await shellStat(state, args[0]);
      return;
    case "mkdb":
    case "createdb":
      await shellCreateDb(state, args[0]);
      return;
    case "initfs":
      await shellInitFs(state);
      return;
    case "mkdir":
      await shellMkdir(state, args[0]);
      return;
    case "cat":
      await shellCat(state, args[0]);
      return;
    case "edit":
    case "vi":
    case "vim":
      await shellEdit(state, readline, args[0]);
      return;
    case "put":
      await shellPut(state, args[0], args[1]);
      return;
    case "cp":
      await shellCp(state, args[0], args[1]);
      return;
    case "get":
      await shellGet(state, args[0], args[1]);
      return;
    case "push":
      await shellPush(state, args[0], args[1]);
      return;
    case "pull":
      await shellPull(state, args[0], args[1]);
      return;
    case "rz":
      await shellRz(state, readline, args);
      return;
    case "sz":
      await shellSz(state, readline, args);
      return;
    case "rm":
      await shellRm(context, state, args, readline);
      return;
    case "login":
    case "connect": {
      const connection = await acquireAuthenticatedConnection(context, {
        url: args[0],
        user: args[1],
        promptToRemember: true,
        forceFreshLogin: true
      });
      state.url = connection.url;
      state.user = connection.user;
      state.password = connection.password;
      state.sessionCookie = connection.sessionCookie;
      state.dbMode = undefined;
      stdout.write(`Connected to ${state.url} as ${state.user}\n`);
      return;
    }
    case "target":
      stdout.write(
        `${JSON.stringify(
          {
            url: state.url,
            user: state.user,
            db: state.db ?? null,
            mode: await getCurrentMode(state),
            cwd: state.cwd,
            localCwd: state.localCwd
          },
          null,
          2
        )}\n`
      );
      return;
    default:
      if (command.startsWith("l") && command.length > 1) {
        await shellLocalCommand(state, readline, command.slice(1), args);
        return;
      }
      stdout.write(`Unknown shell command: ${command}\n`);
      printShellHelp();
  }
}

function createClient(state: ShellState): CouchClient {
  return new CouchClient({
    baseUrl: state.url,
    timeoutMs: state.timeoutMs,
    user: state.sessionCookie ? undefined : state.user,
    password: state.sessionCookie ? undefined : state.password,
    sessionCookie: state.sessionCookie,
    db: state.db
  });
}

function createFsService(state: ShellState): FsService {
  return new FsService(createClient(state), state.db!);
}

async function ensureDb(state: ShellState): Promise<void> {
  if (!state.db) {
    throw new Error("You are at server root. Use `ls` or `dbs` to list databases, then `cd <db>` or `use <db>`.");
  }
}

async function ensureFsDb(state: ShellState): Promise<void> {
  await ensureDb(state);
  const dbMode = await getDbMode(state);
  if (dbMode !== "fs") {
    throw new Error(
      `Database ${state.db} is a normal CouchDB database, not an fs database. Use \`ls\` to list docs, or run \`cdb --db ${state.db} fs init\` if you want file-style operations.`
    );
  }
}

async function doesDbExist(state: ShellState, name: string): Promise<boolean> {
  try {
    await createServerClient(state).dbInfo(name);
    return true;
  } catch (error) {
    if (error instanceof CliError && error.code === "NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

function createServerClient(state: ShellState): CouchClient {
  return new CouchClient({
    baseUrl: state.url,
    timeoutMs: state.timeoutMs,
    user: state.sessionCookie ? undefined : state.user,
    password: state.sessionCookie ? undefined : state.password,
    sessionCookie: state.sessionCookie
  });
}

async function shellCd(state: ShellState, input: string): Promise<void> {
  const target = input.trim() || "/";

  if (!state.db) {
    if (target === "/" || target === ".") {
      state.cwd = "/";
      return;
    }

    const dbName = stripLeadingSlash(target);
    if (!(await doesDbExist(state, dbName))) {
      throw new Error(`Database ${dbName} does not exist. Use \`ls\` or \`dbs\` to see available databases.`);
    }
    state.db = dbName;
    state.dbMode = undefined;
    state.cwd = "/";
    printCurrentMode(state, await getCurrentMode(state));
    return;
  }

  if (target === "..") {
    if (state.cwd === "/") {
      state.db = undefined;
      state.dbMode = undefined;
      state.cwd = "/";
      return;
    }
    state.cwd = parentPath(state.cwd);
    return;
  }

  if (target === "/" || target === ".") {
    state.cwd = "/";
    return;
  }

  if ((await getDbMode(state)) !== "fs") {
    const virtualPath = resolveRemotePath(state.cwd, target);
    if (!(await docsPrefixExists(state, virtualPath))) {
      throw new Error(
        `Path ${virtualPath} does not exist in database ${state.db}. Use \`ls\` to list docs or \`cd ..\` to go back to the database list.`
      );
    }
    state.cwd = virtualPath;
    return;
  }

  state.cwd = await resolveAndValidateDirectory(state, target, false);
}

async function resolveAndValidateDirectory(
  state: ShellState,
  input: string,
  createIfMissing: boolean
): Promise<string> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const fsService = createFsService(state);
  if (createIfMissing) {
    await fsService.mkdir(remotePath);
    return remotePath;
  }
  const stat = await fsService.stat(remotePath);
  if (stat.type !== "dir") {
    throw new Error(`${remotePath} is not a directory.`);
  }
  return remotePath;
}

async function shellLs(state: ShellState, args: string[]): Promise<void> {
  if (!state.db) {
    const dbs = await createServerClient(state).listDbs();
    if (dbs.length === 0) {
      stdout.write("(no databases)\n");
      return;
    }
    for (const db of dbs) {
      stdout.write(`${db}\n`);
    }
    return;
  }

  if ((await getDbMode(state)) === "docs") {
    const pathArg = args.find((arg) => !arg.startsWith("-")) ?? ".";
    const basePath = resolveRemotePath(state.cwd, pathArg);
    const entries = await listDocEntries(state, pathArg);
    if (entries.length === 0) {
      stdout.write("(empty)\n");
      return;
    }
    stdout.write(
      `${formatTable(
        entries.map((entry) => ({
          type: entry.type,
          name: displayName(basePath, entry.path),
          size: entry.size ? formatBytes(entry.size) : "",
          modified: entry.modified ?? "",
          mime: entry.mime ?? ""
        })),
        ["type", "name", "size", "modified", "mime"]
      )}\n`
    );
    return;
  }

  const recursive = args.includes("-r") || args.includes("--recursive");
  const pathArg = args.find((arg) => !arg.startsWith("-")) ?? ".";
  const remotePath = resolveRemotePath(state.cwd, pathArg);
  const rows = await createFsService(state)
    .list(remotePath, recursive)
    .catch(async (error: unknown) => {
      if (error instanceof CliError && error.code === "NOT_FOUND") {
        const dbExists = await doesDbExist(state, state.db!);
        if (!dbExists) {
          throw new Error(`Database ${state.db} does not exist. Use \`ls\` or \`dbs\` to see available databases.`);
        }
        throw new Error(
          `Database ${state.db} exists, but it is not initialized for fs mode. Run \`cdb --db ${state.db} fs init\` if you want file-style operations in this database.`
        );
      }
      throw error;
    });
  if (rows.length === 0) {
    stdout.write("(empty)\n");
    return;
  }
  stdout.write(
    `${formatTable(
      rows.map((row) => ({
        type: row.type,
        name: displayName(remotePath, row.path),
        size: typeof row.size === "number" ? formatBytes(row.size) : "",
        modified: row.updatedAt ?? "",
        mime: row.mime ?? ""
      })),
      ["type", "name", "size", "modified", "mime"]
    )}\n`
  );
}

async function shellStat(state: ShellState, input?: string): Promise<void> {
  if (!input) {
    stdout.write("Usage: stat <path>\n");
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const node = await resolveDocsNode(state, input);
    stdout.write(`${JSON.stringify(node, null, 2)}\n`);
    return;
  }
  await ensureFsDb(state);
  const stat = await createFsService(state).stat(resolveRemotePath(state.cwd, input));
  stdout.write(`${JSON.stringify(stat, null, 2)}\n`);
}

async function shellMkdir(state: ShellState, input?: string): Promise<void> {
  if (!input) {
    stdout.write("Usage: mkdir <path>\n");
    return;
  }
  if (!state.db) {
    await shellCreateDb(state, input);
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const created = await ensureDocsDirectories(state, resolveRemotePath(state.cwd, input));
    stdout.write(`Ensured ${created.length} virtual director${created.length === 1 ? "y" : "ies"}.\n`);
    return;
  }
  await ensureFsDb(state);
  const created = await createFsService(state).mkdir(resolveRemotePath(state.cwd, input));
  stdout.write(`Ensured ${created.length} director${created.length === 1 ? "y" : "ies"}.\n`);
}

async function shellCreateDb(state: ShellState, input?: string): Promise<void> {
  if (!input) {
    stdout.write("Usage: mkdb <name>\n");
    return;
  }

  const name = input.trim();
  if (!name || name.includes("/")) {
    throw new Error("Database name must be a single name and cannot contain '/'.");
  }

  await createServerClient(state).createDb(name);
  state.db = name;
  state.dbMode = undefined;
  state.cwd = "/";
  stdout.write(`Created database ${name}.\n`);
  printCurrentMode(state, await getCurrentMode(state));
}

async function shellInitFs(state: ShellState): Promise<void> {
  await ensureDb(state);
  const service = createFsService(state);
  await service.init();
  state.dbMode = "fs";
  state.cwd = "/";
  stdout.write(`Initialized ${state.db} as cdbfs.\n`);
  printCurrentMode(state, "fs");
}

async function shellCat(state: ShellState, input?: string): Promise<void> {
  if (!input) {
    stdout.write("Usage: cat <path>\n");
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const content = await readDocsContentByShellPath(state, input);
    if (!content.textLike) {
      throw new Error(
        `Path ${content.remotePath} is binary (${content.contentType ?? "application/octet-stream"}). Use \`get\` or \`sz\` instead.`
      );
    }
    stdout.write(content.buffer.toString("utf8"));
    if (!content.buffer.toString("utf8").endsWith("\n")) {
      stdout.write("\n");
    }
    return;
  }
  await ensureFsDb(state);
  stdout.write(`${await createFsService(state).cat(resolveRemotePath(state.cwd, input))}\n`);
}

async function shellEdit(state: ShellState, readline: Interface, input?: string): Promise<void> {
  if (!input) {
    stdout.write("Usage: vim <path>\n");
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const result = await withPausedReadline(readline, () => editDocsContentByShellPath(state, input));
    stdout.write(`Updated ${result}\n`);
    return;
  }
  await ensureFsDb(state);
  const doc = await withPausedReadline(readline, () => createFsService(state).edit(resolveRemotePath(state.cwd, input)));
  stdout.write(`Updated ${doc.path}\n`);
}

async function shellPut(state: ShellState, localFile?: string, remotePathInput?: string): Promise<void> {
  if (!localFile) {
    stdout.write("Usage: put <localFile> [remotePath]\n");
    return;
  }
  const localPath = resolveLocalPath(state.localCwd, localFile);
  if ((await getDbMode(state)) === "docs") {
    const remotePath = await resolveDocsUploadTargetPath(state, localPath, remotePathInput);
    const result = await uploadLocalFileToDocs(state, localPath, remotePath);
    stdout.write(`Uploaded ${localPath} to ${result.path}\n`);
    return;
  }
  await ensureFsDb(state);
  const remotePath = resolveRemotePath(state.cwd, remotePathInput ?? path.basename(localPath));
  const doc = await createFsService(state).putLocalFile(localPath, remotePath);
  stdout.write(`Uploaded ${localPath} to ${doc.path}\n`);
}

async function shellCp(state: ShellState, sourceInput?: string, targetInput?: string): Promise<void> {
  if (!sourceInput) {
    stdout.write("Usage: cp <source> [target]\n");
    return;
  }

  await ensureDb(state);
  const source = await classifyCopySource(state, sourceInput);

  if (source === "local-file") {
    const localPath = resolveLocalPath(state.localCwd, sourceInput);
    const remotePath = await resolveRemoteTargetPathForLocalSource(state, localPath, targetInput, false);
    await shellPut(state, localPath, remotePath);
    return;
  }

  if (source === "local-dir") {
    const localPath = resolveLocalPath(state.localCwd, sourceInput);
    const remotePath = await resolveRemoteTargetPathForLocalSource(state, localPath, targetInput, true);
    await shellPush(state, localPath, remotePath);
    return;
  }

  const remoteNode = await resolveRemoteNodeForCopy(state, sourceInput);
  if (remoteNode.type === "dir") {
    const localDir = await resolveLocalTargetPathForRemoteSource(state, remoteNode.path, targetInput, true);
    await shellPull(state, remoteNode.path, localDir);
    return;
  }

  const localFile = await resolveLocalTargetPathForRemoteSource(state, remoteNode.path, targetInput, false);
  await shellGet(state, remoteNode.path, localFile);
}

async function shellGet(state: ShellState, remotePathInput?: string, localFile?: string): Promise<void> {
  if (!remotePathInput) {
    stdout.write("Usage: get <remotePath> [localFile]\n");
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const node = await resolveDocsNode(state, remotePathInput);
    if (node.type === "dir") {
      const outputDir = localFile
        ? resolveLocalPath(state.localCwd, localFile)
        : path.resolve(state.localCwd, path.posix.basename(node.path) || path.basename(state.db ?? "docs"));
      const result = await pullDocsDirectory(state, node.path, outputDir);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const content = await readDocsContentByShellPath(state, remotePathInput);
    const output = localFile
      ? resolveLocalPath(state.localCwd, localFile)
      : path.resolve(state.localCwd, content.fileName);
    await writeFileWithParents(output, content.buffer);
    stdout.write(`Downloaded ${content.remotePath} to ${output}\n`);
    return;
  }
  await ensureFsDb(state);
  const remotePath = resolveRemotePath(state.cwd, remotePathInput);
  const output = localFile
    ? resolveLocalPath(state.localCwd, localFile)
    : path.resolve(state.localCwd, path.basename(remotePath));
  await createFsService(state).getToLocalFile(remotePath, output);
  stdout.write(`Downloaded ${remotePath} to ${output}\n`);
}

async function shellPush(state: ShellState, localDir?: string, remotePathInput?: string): Promise<void> {
  if (!localDir) {
    stdout.write("Usage: push <localDir> [remotePath]\n");
    return;
  }
  const localPath = resolveLocalPath(state.localCwd, localDir);
  if ((await getDbMode(state)) === "docs") {
    const result = await pushLocalDirectoryToDocs(state, localPath, resolveRemotePath(state.cwd, remotePathInput ?? "."));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  await ensureFsDb(state);
  const result = await createFsService(state).pushDirectory(localPath, resolveRemotePath(state.cwd, remotePathInput ?? "."));
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function shellPull(state: ShellState, first?: string, second?: string): Promise<void> {
  if (!first) {
    stdout.write("Usage: pull [remotePath] <localDir>\n");
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const remotePath = second ? resolveRemotePath(state.cwd, first) : state.cwd;
    const localDir = resolveLocalPath(state.localCwd, second ?? first);
    const result = await pullDocsDirectory(state, remotePath, localDir);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  await ensureFsDb(state);
  const remotePath = second ? resolveRemotePath(state.cwd, first) : state.cwd;
  const localDir = resolveLocalPath(state.localCwd, second ?? first);
  const result = await createFsService(state).pullDirectory(remotePath, localDir);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function shellRz(state: ShellState, readline: Interface, args: string[]): Promise<void> {
  const { localArgs, remotePathInput } = parseRzArgs(args);
  const stagingDir = await mkdtemp(path.join(tmpdir(), "cdb-rz-"));
  const dbMode = await getDbMode(state);

  try {
    const targetBase = resolveRemotePath(state.cwd, remotePathInput ?? ".");
    stdout.write(`Receiving file(s) via zmodem into temp dir ${stagingDir}\n`);
    stdout.write(`Remote target base: ${targetBase}\n`);
    const zmodem = await runLocalProcessWithResult(state, readline, "rz", localArgs, { cwd: stagingDir });
    if (zmodem.signal) {
      throw new Error(`rz terminated by signal ${zmodem.signal}. Remote database was not changed.`);
    }
    if (zmodem.code && zmodem.code !== 0) {
      throw new Error(`rz exited with code ${zmodem.code}. Remote database was not changed.`);
    }
    const received = await readdir(stagingDir, { withFileTypes: true });

    if (received.length === 0) {
      stdout.write("No file received by rz. Remote database was not changed.\n");
      return;
    }

    stdout.write(`Received ${received.length} item(s): ${received.map((entry) => entry.name).join(", ")}\n`);

    if (dbMode === "docs") {
      const result = await uploadReceivedEntriesToDocs(state, stagingDir, received, targetBase, remotePathInput);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    await ensureFsDb(state);
    const fsService = createFsService(state);
    const targetStat = await fsService.stat(targetBase).catch(() => undefined);
    const result = await uploadReceivedEntriesToFs(state, fsService, stagingDir, received, targetBase, remotePathInput, targetStat);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function parseRzArgs(args: string[]): { localArgs: string[]; remotePathInput?: string } {
  const localArgs: string[] = [];
  let remotePathInput: string | undefined;

  for (const arg of args) {
    if (!remotePathInput && !arg.startsWith("-")) {
      remotePathInput = arg;
      continue;
    }
    localArgs.push(arg);
  }

  return { localArgs, remotePathInput };
}

async function shellSz(state: ShellState, readline: Interface, args: string[]): Promise<void> {
  const { localArgs, remotePaths } = parseSzArgs(args);
  if (remotePaths.length === 0) {
    stdout.write("Usage: sz [options] <remotePath> [remotePath...]\n");
    return;
  }

  const stagingDir = await mkdtemp(path.join(tmpdir(), "cdb-sz-"));
  const dbMode = await getDbMode(state);

  try {
    const staged = dbMode === "docs"
      ? await stageDocsPathsForSz(state, stagingDir, remotePaths)
      : await stageFsPathsForSz(state, stagingDir, remotePaths);
    const stagedPaths = staged.paths;
    const finalArgs = staged.needsRecursive && !localArgs.includes("-r") ? ["-r", ...localArgs, ...stagedPaths] : [...localArgs, ...stagedPaths];
    stdout.write(`Sending ${remotePaths.length} remote item(s) via zmodem: ${remotePaths.join(", ")}\n`);
    const zmodem = await runLocalProcessWithResult(state, readline, "sz", finalArgs);
    if (zmodem.signal) {
      throw new Error(`sz terminated by signal ${zmodem.signal}.`);
    }
    if (zmodem.code && zmodem.code !== 0) {
      throw new Error(`sz exited with code ${zmodem.code}.`);
    }
    stdout.write("sz transfer completed.\n");
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function parseSzArgs(args: string[]): { localArgs: string[]; remotePaths: string[] } {
  const localArgs: string[] = [];
  const remotePaths: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("-") && remotePaths.length === 0) {
      localArgs.push(arg);
      continue;
    }
    remotePaths.push(arg);
  }

  return { localArgs, remotePaths };
}

async function shellRm(context: CommandContext, state: ShellState, args: string[], readline: Interface): Promise<void> {
  const recursive = args.includes("-r") || args.includes("--recursive");
  const pathArg = args.find((arg) => !arg.startsWith("-"));
  if (!pathArg) {
    stdout.write("Usage: rm [-r] <path>\n");
    return;
  }
  if (!state.db) {
    const name = stripLeadingSlash(pathArg.trim());
    if (!name || name.includes("/")) {
      throw new Error("At server root, `rm` expects a database name like `rm testdb`.");
    }
    if (!(await doesDbExist(state, name))) {
      throw new Error(`Database ${name} does not exist. Use \`ls\` or \`dbs\` to see available databases.`);
    }
    await confirmShellAction(context, readline, `Delete database ${name}?`);
    await createServerClient(state).deleteDb(name);
    stdout.write(`Deleted database ${name}\n`);
    return;
  }
  if ((await getDbMode(state)) === "docs") {
    const targetPath = resolveRemotePath(state.cwd, pathArg);
    const exactDocId = toDocId(targetPath);
    const exactDoc = await tryGetDoc(state, exactDocId);
    if (exactDoc && typeof exactDoc._rev === "string") {
      await confirmShellAction(context, readline, `Delete doc ${exactDocId}?`);
      await createClient(state).deleteDoc(undefined, exactDocId, exactDoc._rev);
      stdout.write(`Deleted doc ${exactDocId}\n`);
      return;
    }
    const docs = await listDocsUnderPrefix(state, targetPath);
    if (docs.length === 0) {
      throw new Error(`Path ${targetPath} does not exist in database ${state.db}.`);
    }
    if (!recursive) {
      throw new Error(`Path ${targetPath} is a virtual directory. Use \`rm -r ${pathArg}\` to delete all docs under it.`);
    }
    await confirmShellAction(context, readline, `Delete ${docs.length} doc(s) under ${targetPath}?`);
    for (const doc of docs) {
      await createClient(state).deleteDoc(undefined, String(doc._id), String(doc._rev));
    }
    stdout.write(`Deleted ${docs.length} doc(s) under ${targetPath}\n`);
    return;
  }
  await ensureFsDb(state);
  const remotePath = resolveRemotePath(state.cwd, pathArg);
  const stat = await createFsService(state).stat(remotePath);
  await confirmShellAction(
    context,
    readline,
    stat.type === "dir"
      ? `Delete directory ${remotePath}${recursive ? " recursively" : ""} from ${state.db}?`
      : `Delete file ${remotePath} from ${state.db}?`
  );
  const removed = await createFsService(state).remove(remotePath, recursive);
  stdout.write(`Deleted ${removed} remote item(s)\n`);
}

async function confirmShellAction(context: CommandContext, readline: Interface, message: string): Promise<void> {
  if (context.resolved.yes) {
    return;
  }

  const answer = await readline.question(`${message} [y/N] `);
  if (!/^(y|yes)$/i.test(answer.trim())) {
    throw new CliError("ABORTED", "Operation aborted.", EXIT_CODES.INPUT);
  }
}

async function shellLocalCd(state: ShellState, input?: string): Promise<void> {
  const target = input?.trim() ? resolveLocalPath(state.localCwd, input) : homedir();
  const stats = await stat(target);
  if (!stats.isDirectory()) {
    throw new Error(`Local path ${target} is not a directory.`);
  }
  state.localCwd = target;
  stdout.write(`Local cwd: ${state.localCwd}\n`);
}

async function shellLocalCommand(
  state: ShellState,
  readline: Interface,
  command: string,
  args: string[]
): Promise<void> {
  if (command === "cd") {
    await shellLocalCd(state, args[0]);
    return;
  }

  await runLocalProcess(state, readline, command, args);
}

async function runLocalProcess(
  state: ShellState,
  readline: Interface,
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<void> {
  const result = await runLocalProcessWithResult(state, readline, command, args, options);
  if (result.signal) {
    throw new Error(`Local command ${command} terminated by signal ${result.signal}.`);
  }
  if (result.code && result.code !== 0) {
    throw new Error(`Local command ${command} exited with code ${result.code}.`);
  }
}

async function runLocalProcessWithResult(
  state: ShellState,
  readline: Interface,
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    readline.pause();
    const child = spawn(command, args, {
      cwd: options.cwd ?? state.localCwd,
      stdio: "inherit",
      env: process.env
    });

    child.on("error", (error) => {
      readline.resume();
      reject(error);
    });

    child.on("exit", (code, signal) => {
      readline.resume();
      resolve({ code, signal });
    });
  });
}

async function withPausedReadline<T>(readline: Interface, action: () => Promise<T>): Promise<T> {
  readline.pause();
  try {
    return await action();
  } finally {
    readline.resume();
  }
}

function resolveLocalPath(base: string, input: string): string {
  if (input === "~") {
    return homedir();
  }

  if (input.startsWith("~/")) {
    return path.resolve(homedir(), input.slice(2));
  }

  if (path.isAbsolute(input)) {
    return path.normalize(input);
  }

  return path.resolve(base, input);
}

function getRzRemoteFragment(tokens: string[], endsWithSpace: boolean): string {
  const args = tokens.slice(1);
  if (endsWithSpace) {
    return "";
  }

  const fragment = args[args.length - 1] ?? "";
  if (fragment.startsWith("-")) {
    return "";
  }

  return fragment;
}

function getSzRemoteFragment(tokens: string[], endsWithSpace: boolean): string {
  const args = tokens.slice(1);
  if (endsWithSpace) {
    return "";
  }

  const fragment = args[args.length - 1] ?? "";
  if (fragment.startsWith("-")) {
    return "";
  }

  return fragment;
}

async function completeShellInput(state: ShellState, line: string): Promise<[string[], string]> {
  const { tokens, fragment } = parseCompletionInput(line);
  const endsWithSpace = /\s$/.test(line);

  if (tokens.length === 0) {
    return [SHELL_COMMANDS.map((command) => `${command} `), fragment];
  }

  if (tokens.length === 1 && !line.endsWith(" ")) {
    const matches = SHELL_COMMANDS.filter((command) => command.startsWith(tokens[0])).map((command) => `${command} `);
    return [matches, tokens[0]];
  }

  const command = tokens[0];
  const argIndex = line.endsWith(" ") ? tokens.length - 1 : tokens.length - 2;

  if (shouldCompleteDatabaseName(state, command, argIndex)) {
    const matches = await completeDatabaseName(state, fragment);
    return [matches, fragment];
  }

  if (command === "cp") {
    const result = await completeCpInput(state, tokens, fragment, endsWithSpace, argIndex);
    return [result.matches, result.fragment];
  }

  if (shouldCompleteRemotePath(state, command, argIndex)) {
    const directoriesOnly = command === "cd";
    const remoteFragment =
      command === "rz"
        ? getRzRemoteFragment(tokens, endsWithSpace)
        : command === "sz"
          ? getSzRemoteFragment(tokens, endsWithSpace)
          : fragment;
    const matches = await completeRemotePath(state, remoteFragment, directoriesOnly);
    return [matches, remoteFragment];
  }

  if ((command === "rz" || command === "sz") && fragment.startsWith("-")) {
    const matches = ["-b", "-e", "-y", "-Y", "-E", "-c", "-i", "-q", "-r", "-v"].filter((flag) => flag.startsWith(fragment));
    return [matches, fragment];
  }

  if (shouldCompleteLocalPath(command, argIndex)) {
    const directoryOnly = command === "lcd" || command === "push" || (command === "pull" && argIndex >= 1);
    const matches = await completeLocalPath(state.localCwd, fragment, directoryOnly);
    return [matches, fragment];
  }

  return [[], fragment];
}

async function completeCpInput(
  state: ShellState,
  tokens: string[],
  fragment: string,
  endsWithSpace: boolean,
  argIndex: number
): Promise<{ matches: string[]; fragment: string }> {
  const sourceFragment = argIndex <= 0 ? fragment : endsWithSpace ? "" : (tokens[1] ?? "");

  if (argIndex <= 0) {
    if (looksLikeExplicitLocalPath(fragment)) {
      return {
        matches: await completeLocalPath(state.localCwd, fragment, false),
        fragment
      };
    }

    if (looksLikeExplicitRemotePath(fragment)) {
      return {
        matches: await completeRemotePath(state, fragment, false),
        fragment
      };
    }

    const localMatches = await completeLocalPath(state.localCwd, fragment, false);
    const remoteMatches = state.db ? await completeRemotePath(state, fragment, false) : [];
    return {
      matches: [...new Set([...localMatches, ...remoteMatches])].sort((a, b) => a.localeCompare(b)),
      fragment
    };
  }

  if (looksLikeExplicitLocalPath(sourceFragment)) {
    return {
      matches: await completeRemotePath(state, fragment, false),
      fragment
    };
  }

  if (looksLikeExplicitRemotePath(sourceFragment)) {
    return {
      matches: await completeLocalPath(state.localCwd, fragment, false),
      fragment
    };
  }

  const localMatches = await completeLocalPath(state.localCwd, fragment, false);
  const remoteMatches = state.db ? await completeRemotePath(state, fragment, false) : [];
  return {
    matches: [...new Set([...localMatches, ...remoteMatches])].sort((a, b) => a.localeCompare(b)),
    fragment
  };
}

function parseCompletionInput(line: string): { tokens: string[]; fragment: string } {
  const endsWithSpace = /\s$/.test(line);
  const trimmed = line.trim();

  if (!trimmed) {
    return { tokens: [], fragment: "" };
  }

  const tokens = trimmed.split(/\s+/);
  return {
    tokens,
    fragment: endsWithSpace ? "" : tokens[tokens.length - 1]
  };
}

function shouldCompleteLocalPath(command: string, argIndex: number): boolean {
  if (command.startsWith("l") && command.length > 1) {
    return true;
  }

  if (command === "lcd" && argIndex === 0) {
    return true;
  }

  if ((command === "put" || command === "cp" || command === "push") && argIndex === 0) {
    return true;
  }

  if (command === "cp" && argIndex === 1) {
    return true;
  }

  if (command === "get" && argIndex === 1) {
    return true;
  }

  if (command === "pull" && argIndex === 1) {
    return true;
  }

  return false;
}

function shouldCompleteDatabaseName(state: ShellState, command: string, argIndex: number): boolean {
  if (state.db) {
    return false;
  }

  if ((command === "cd" || command === "use" || command === "use-db" || command === "rm") && argIndex === 0) {
    return true;
  }

  return false;
}

function shouldCompleteRemotePath(state: ShellState, command: string, argIndex: number): boolean {
  if (!state.db) {
    return false;
  }

  if ((command === "cd" || command === "ls" || command === "stat" || command === "cat" || command === "edit" || command === "vim" || command === "get" || command === "rm" || command === "mkdir") && argIndex === 0) {
    return true;
  }

  if ((command === "put" || command === "cp" || command === "push") && argIndex === 1) {
    return true;
  }

  if (command === "pull" && argIndex === 0) {
    return true;
  }

  if (command === "rz") {
    return argIndex >= 0;
  }

  if (command === "sz") {
    return argIndex >= 0;
  }

  return false;
}

async function completeLocalPath(base: string, fragment: string, directoriesOnly: boolean): Promise<string[]> {
  const rawFragment = fragment || ".";
  const normalizedFragment = rawFragment === "~" ? rawFragment : rawFragment.replace(/\/+$/, "");
  const searchBase = fragment.endsWith("/") ? fragment : normalizedFragment;

  let parentInput: string;
  let namePrefix: string;

  if (fragment.endsWith("/")) {
    parentInput = searchBase || ".";
    namePrefix = "";
  } else {
    parentInput = path.dirname(searchBase);
    namePrefix = path.basename(searchBase);
  }

  if (parentInput === ".") {
    parentInput = fragment.startsWith("/") ? "/" : ".";
  }

  const parentPath = resolveLocalPath(base, parentInput);
  const entries = await readdir(parentPath, { withFileTypes: true }).catch(() => []);
  const displayParent =
    parentInput === "."
      ? fragment.startsWith("./")
        ? "./"
        : ""
      : parentInput === "/"
        ? "/"
        : parentInput.endsWith("/")
          ? parentInput
          : `${parentInput}/`;

  return entries
    .filter((entry) => entry.name.startsWith(namePrefix))
    .filter((entry) => !directoriesOnly || entry.isDirectory())
    .map((entry) => `${displayParent}${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort((a, b) => a.localeCompare(b));
}

async function completeDatabaseName(state: ShellState, fragment: string): Promise<string[]> {
  const dbs = await createServerClient(state).listDbs().catch(() => []);
  const hasLeadingSlash = fragment.startsWith("/");
  const prefix = stripLeadingSlash(fragment);

  return dbs
    .filter((name) => name.startsWith(prefix))
    .map((name) => `${hasLeadingSlash ? "/" : ""}${name}`)
    .sort((a, b) => a.localeCompare(b));
}

async function completeRemotePath(state: ShellState, fragment: string, directoriesOnly: boolean): Promise<string[]> {
  const remoteFragment = fragment || ".";
  const remoteParentFragment = getRemoteParentFragment(remoteFragment);
  const parentRemotePath = resolveRemotePath(state.cwd, remoteParentFragment);
  const namePrefix = getRemoteNamePrefix(remoteFragment);
  const displayParent = getRemoteDisplayParent(remoteFragment, remoteParentFragment);
  const mode = await getDbMode(state);

  const entries =
    mode === "fs" ? await listFsCompletionEntries(state, parentRemotePath) : await listDocCompletionEntries(state, parentRemotePath);

  return entries
    .filter((entry) => entry.name.startsWith(namePrefix))
    .filter((entry) => !directoriesOnly || entry.type === "dir")
    .map((entry) => `${displayParent}${entry.name}${entry.type === "dir" ? "/" : ""}`)
    .sort((a, b) => a.localeCompare(b));
}

function getRemoteParentFragment(fragment: string): string {
  if (!fragment || fragment === ".") {
    return ".";
  }

  if (fragment.endsWith("/")) {
    return fragment;
  }

  const dirname = path.posix.dirname(fragment);
  if (dirname === ".") {
    if (fragment.startsWith("/")) {
      return "/";
    }
    if (fragment.startsWith("./")) {
      return "./";
    }
  }
  return dirname;
}

function getRemoteNamePrefix(fragment: string): string {
  if (!fragment || fragment === "." || fragment.endsWith("/")) {
    return "";
  }
  return path.posix.basename(fragment);
}

function getRemoteDisplayParent(fragment: string, parentFragment: string): string {
  if (parentFragment === ".") {
    return fragment.startsWith("./") ? "./" : "";
  }

  if (parentFragment === "/") {
    return "/";
  }

  return parentFragment.endsWith("/") ? parentFragment : `${parentFragment}/`;
}

function looksLikeExplicitLocalPath(input: string): boolean {
  return input === "~" || input.startsWith("./") || input.startsWith("../") || input.startsWith("~/");
}

function looksLikeExplicitRemotePath(input: string): boolean {
  return input.startsWith("/");
}

async function listFsCompletionEntries(
  state: ShellState,
  parentRemotePath: string
): Promise<Array<{ name: string; type: "dir" | "file" }>> {
  try {
    const rows = await createFsService(state).list(parentRemotePath, false);
    return rows.map((row) => ({
      name: row.name,
      type: row.type
    }));
  } catch {
    return [];
  }
}

async function listDocCompletionEntries(
  state: ShellState,
  parentRemotePath: string
): Promise<Array<{ name: string; type: "dir" | "doc" }>> {
  try {
    const rows = await listDocEntries(state, parentRemotePath);
    return rows.map((row) => ({
      name: displayName(parentRemotePath, row.path),
      type: row.type === "dir" ? "dir" : "doc"
    }));
  } catch {
    return [];
  }
}

function resolveRemotePath(cwd: string, input: string): string {
  if (!input || input === ".") {
    return cwd;
  }
  if (input.startsWith("/")) {
    return normalizeRemotePath(input);
  }
  return joinRemotePath(cwd, input);
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function parentPath(remotePath: string): string {
  if (remotePath === "/") {
    return "/";
  }
  const normalized = normalizeRemotePath(remotePath);
  const parent = path.posix.dirname(normalized);
  return parent === "." ? "/" : normalizeRemotePath(parent);
}

function displayName(basePath: string, fullPath: string): string {
  const normalizedBase = normalizeRemotePath(basePath);
  const normalizedFull = normalizeRemotePath(fullPath);

  if (normalizedBase === normalizedFull) {
    return normalizedBase === "/" ? "/" : path.posix.basename(normalizedFull);
  }

  if (normalizedBase === "/") {
    return normalizedFull.slice(1);
  }

  const prefix = `${normalizedBase}/`;
  if (normalizedFull.startsWith(prefix)) {
    return normalizedFull.slice(prefix.length);
  }

  return path.posix.basename(normalizedFull);
}

function formatPromptPath(state: ShellState): string {
  if (!state.db) {
    return "cdb:/";
  }

  if (state.cwd === "/") {
    return `cdb:/${state.db}`;
  }

  const relative = state.cwd.slice(1);
  return `cdb:/${state.db}/${relative}`;
}

async function getCurrentMode(state: ShellState): Promise<"root" | "docs" | "fs"> {
  if (!state.db) {
    return "root";
  }

  return getDbMode(state);
}

function printCurrentMode(state: ShellState, mode: "root" | "docs" | "fs"): void {
  if (mode === "root") {
    stdout.write("Mode: root. `ls` lists databases. `mkdir <db>` or `mkdb <db>` creates a database.\n");
    return;
  }

  if (mode === "docs") {
    stdout.write(
      `Mode: docs. \`ls\` shows JSON docs plus attachment-backed files in virtual directories. Use \`initfs\` only if you want the dedicated fs data model.\n`
    );
    return;
  }

  stdout.write("Mode: fs. Use `ls`, `mkdir`, `put`, `get`, `vim`, `push`, `pull` like a file tree.\n");
}

async function getDbMode(state: ShellState): Promise<"docs" | "fs"> {
  await ensureDb(state);
  if (state.dbMode) {
    return state.dbMode;
  }
  try {
    await createClient(state).getLocalDoc(undefined, "cdbfs_meta");
    state.dbMode = "fs";
    return state.dbMode;
  } catch (error) {
    if (error instanceof CliError && error.code === "NOT_FOUND") {
      state.dbMode = "docs";
      return state.dbMode;
    }
    throw error;
  }
}

async function listDocs(state: ShellState, prefix?: string): Promise<string[]> {
  const query =
    prefix && prefix !== "/" && prefix !== "."
      ? {
          startkey: JSON.stringify(prefix),
          endkey: JSON.stringify(`${prefix}\ufff0`)
        }
      : {};
  const response = await createClient(state).allDocs(undefined, {
    limit: 200,
    ...query
  });
  return response.rows.map((row) => row.id);
}

async function listDocEntries(
  state: ShellState,
  input: string
): Promise<Array<{ type: "dir" | "doc" | "file"; path: string; size?: number; modified?: string; mime?: string }>> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const prefix = toDocId(remotePath);
  const docs = await listDocsWithBodies(state, prefix ? `${prefix}/` : undefined);
  const entries = new Map<string, { type: "dir" | "doc" | "file"; path: string; size?: number; modified?: string; mime?: string }>();

  for (const doc of docs) {
    const id = String(doc._id);
    const relative = prefix ? id.slice(prefix.length + 1) : id;
    if (!relative) {
      continue;
    }
    if (relative === DOCS_DIR_MARKER) {
      continue;
    }
    const [first, ...rest] = relative.split("/");
    const childPath = remotePath === "/" ? `/${first}` : `${remotePath}/${first}`;
    if (rest.length > 0) {
      if (!entries.has(childPath)) {
        entries.set(childPath, { type: "dir", path: childPath });
      }
    } else if (!entries.has(childPath)) {
      entries.set(childPath, {
        type: extractDocDisplayType(doc),
        path: childPath,
        size: extractDisplaySize(doc),
        modified: extractModifiedAt(doc),
        mime: extractDisplayMime(doc)
      });
    }
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function docsPrefixExists(state: ShellState, remotePath: string): Promise<boolean> {
  const prefix = toDocId(remotePath);
  if (!prefix) {
    return true;
  }
  if (await hasDocsDirMarker(state, remotePath)) {
    return true;
  }
  const docs = await listDocs(state, `${prefix}/`);
  return docs.length > 0;
}

async function resolveDocsNode(
  state: ShellState,
  input: string
): Promise<
  | { type: "dir"; path: string; prefix: string; count: number }
  | { type: "doc"; path: string; id: string; doc: Record<string, unknown> }
> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const docId = toDocId(remotePath);
  if (!docId) {
    const docs = await listDocsWithBodies(state);
    return {
      type: "dir",
      path: remotePath,
      prefix: docId,
      count: docs.filter((doc) => !isDirMarkerDoc(doc)).length
    };
  }
  const exactDoc = await tryGetDoc(state, docId);
  if (exactDoc) {
    return {
      type: "doc",
      path: remotePath,
      id: docId,
      doc: exactDoc
    };
  }
  const docs = await listDocs(state, `${docId}/`);
  if (docs.length === 0) {
    throw new Error(`Path ${remotePath} does not exist in database ${state.db}.`);
  }
  return {
    type: "dir",
    path: remotePath,
    prefix: docId,
    count: docs.filter((id) => !isDirMarkerId(id)).length
  };
}

async function getDocByShellPath(state: ShellState, input: string): Promise<Record<string, unknown>> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const docId = toDocId(remotePath);
  const doc = await tryGetDoc(state, docId);
  if (doc) {
    return doc;
  }
  if (await docsPrefixExists(state, remotePath)) {
    throw new Error(`Path ${remotePath} is a virtual directory, not a document.`);
  }
  throw new Error(`Document ${docId} does not exist in database ${state.db}.`);
}

async function editDocByShellPath(state: ShellState, input: string): Promise<Record<string, unknown>> {
  const original = await getDocByShellPath(state, input);
  const docId = String(original._id);
  const editedBuffer = await editBufferWithEditor(Buffer.from(`${JSON.stringify(original, null, 2)}\n`, "utf8"), {
    fileName: path.basename(docId) || "document.json"
  });
  const payload = ensureObject(JSON.parse(editedBuffer.toString("utf8")), "Edited document must be a JSON object.");
  payload._id = docId;
  payload._rev = original._rev;
  await createClient(state).putDoc(undefined, docId, payload);
  return payload;
}

async function editDocsContentByShellPath(state: ShellState, input: string): Promise<string> {
  const content = await readDocsContentByShellPath(state, input);
  if (content.kind === "json-doc") {
    const doc = await editDocByShellPath(state, input);
    return String(doc._id);
  }

  if (!content.textLike) {
    throw new Error(
      `Path ${content.remotePath} is binary (${content.contentType ?? "application/octet-stream"}). Use \`get\` or \`sz\` instead of \`vim\`.`
    );
  }

  const editedBuffer = await editBufferWithEditor(content.buffer, {
    fileName: content.fileName
  });
  await writeDocsAttachmentContent(state, content.remotePath, editedBuffer, content.contentType, content.attachmentName);
  return content.remotePath;
}

type DocsShellContent =
  | {
      kind: "json-doc";
      remotePath: string;
      docId: string;
      fileName: string;
      buffer: Buffer;
      contentType: "application/json";
      textLike: true;
      doc: Record<string, unknown>;
    }
  | {
      kind: "attachment";
      remotePath: string;
      docId: string;
      fileName: string;
      buffer: Buffer;
      contentType: string;
      textLike: boolean;
      doc: Record<string, unknown>;
      attachmentName: string;
    };

interface DocsUploadResult {
  path: string;
  docId: string;
  kind: "json-doc" | "attachment";
}

async function readDocsContentByShellPath(state: ShellState, input: string): Promise<DocsShellContent> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const doc = await getDocByShellPath(state, input);
  const docId = String(doc._id);
  const primary = getPrimaryAttachment(doc);

  if (!primary) {
    return {
      kind: "json-doc",
      remotePath,
      docId,
      fileName: path.posix.basename(docId) || "document.json",
      buffer: Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8"),
      contentType: "application/json",
      textLike: true,
      doc
    };
  }

  const attachment = await createClient(state).getAttachment(undefined, docId, primary.name);
  const contentType = attachment.contentType ?? primary.contentType ?? "application/octet-stream";
  return {
    kind: "attachment",
    remotePath,
    docId,
    fileName: primary.fileName,
    buffer: attachment.buffer,
    contentType,
    textLike: isTextLikeContent(contentType, primary.fileName),
    doc,
    attachmentName: primary.name
  };
}

async function uploadLocalFileToDocs(state: ShellState, localPath: string, remotePath: string): Promise<DocsUploadResult> {
  const normalizedRemotePath = normalizeRemotePath(remotePath);
  const localBuffer = await readFile(localPath);
  const existing = await tryGetDoc(state, toDocId(normalizedRemotePath));
  const jsonObject = tryParseJsonObject(localBuffer);

  if (shouldStoreAsJsonDoc(localPath, normalizedRemotePath, existing, jsonObject)) {
    await ensureDocsDirectories(state, parentPath(normalizedRemotePath));
    const payload = { ...jsonObject! };
    payload._id = toDocId(normalizedRemotePath);
    if (existing && typeof existing._rev === "string") {
      payload._rev = existing._rev;
    }
    await createClient(state).putDoc(undefined, payload._id as string, payload);
    return {
      path: normalizedRemotePath,
      docId: String(payload._id),
      kind: "json-doc"
    };
  }

  const mimeType = mime.lookup(localPath) || mime.lookup(path.posix.basename(normalizedRemotePath)) || "application/octet-stream";
  await writeDocsAttachmentContent(state, normalizedRemotePath, localBuffer, String(mimeType), getPrimaryAttachment(existing)?.name);
  return {
    path: normalizedRemotePath,
    docId: toDocId(normalizedRemotePath),
    kind: "attachment"
  };
}

async function resolveDocsUploadTargetPath(state: ShellState, localPath: string, remotePathInput?: string): Promise<string> {
  const candidate = resolveRemotePath(state.cwd, remotePathInput ?? path.basename(localPath));
  if (!remotePathInput) {
    return candidate;
  }

  const node = await resolveDocsNodeOrUndefined(state, candidate);
  if (node?.type === "dir") {
    return resolveRemotePath(candidate, path.basename(localPath));
  }

  return candidate;
}

async function writeDocsAttachmentContent(
  state: ShellState,
  remotePath: string,
  buffer: Buffer,
  contentType: string,
  attachmentNameHint?: string
): Promise<void> {
  const normalizedRemotePath = normalizeRemotePath(remotePath);
  await ensureDocsDirectories(state, parentPath(normalizedRemotePath));
  const docId = toDocId(normalizedRemotePath);
  const client = createClient(state);
  const existing = await tryGetDoc(state, docId);
  const attachmentName =
    attachmentNameHint ??
    getPrimaryAttachment(existing)?.name ??
    (path.posix.basename(normalizedRemotePath) || "content");
  const timestamp = toIsoTimestamp();
  const previousAttachments = getAttachmentEntries(existing);
  const payload: Record<string, unknown> = {
    _id: docId,
    type: "file",
    path: normalizedRemotePath,
    filename: path.posix.basename(normalizedRemotePath),
    size: buffer.length,
    mime: contentType,
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : timestamp,
    updatedAt: timestamp
  };

  if (existing && typeof existing._rev === "string") {
    payload._rev = existing._rev;
  }

  let currentRev = (await client.putDoc(undefined, docId, payload)).rev;

  for (const existingAttachment of previousAttachments) {
    if (existingAttachment.name === attachmentName) {
      continue;
    }
    currentRev = (await client.deleteAttachment(undefined, docId, existingAttachment.name, currentRev)).rev;
  }

  await client.putAttachment(undefined, docId, attachmentName, buffer, currentRev, contentType);
}

async function pushLocalDirectoryToDocs(
  state: ShellState,
  localDir: string,
  remoteBasePath: string
): Promise<{ uploaded: number; directoriesEnsured: number }> {
  const details = await stat(localDir);
  if (!details.isDirectory()) {
    throw new Error(`Local path ${localDir} is not a directory.`);
  }

  const normalizedBase = normalizeRemotePath(remoteBasePath);
  let uploaded = 0;
  let directoriesEnsured = 0;

  async function visit(localPath: string, remotePath: string): Promise<void> {
    const created = await ensureDocsDirectories(state, remotePath);
    directoriesEnsured += created.length;
    const entries = await readdir(localPath, { withFileTypes: true });

    if (entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      const nextLocalPath = path.join(localPath, entry.name);
      const nextRemotePath = resolveRemotePath(remotePath, entry.name);
      if (entry.isDirectory()) {
        await visit(nextLocalPath, nextRemotePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      await uploadLocalFileToDocs(state, nextLocalPath, nextRemotePath);
      uploaded += 1;
    }
  }

  await visit(localDir, normalizedBase);
  return { uploaded, directoriesEnsured };
}

async function pullDocsDirectory(
  state: ShellState,
  remotePathInput: string,
  localDir: string
): Promise<{ downloaded: number; directoriesCreated: number }> {
  const remotePath = resolveRemotePath(state.cwd, remotePathInput);
  const node = await resolveDocsNode(state, remotePath);
  if (node.type !== "dir") {
    throw new Error(`Path ${remotePath} is a document, not a directory. Use \`get ${path.posix.basename(remotePath)}\` instead.`);
  }

  let downloaded = 0;
  let directoriesCreated = 0;

  async function visit(currentRemotePath: string, currentLocalDir: string): Promise<void> {
    await mkdir(currentLocalDir, { recursive: true });
    directoriesCreated += 1;
    const entries = await listDocEntries(state, currentRemotePath);
    for (const entry of entries) {
      const outputPath = path.join(currentLocalDir, path.posix.basename(entry.path));
      if (entry.type === "dir") {
        await visit(entry.path, outputPath);
        continue;
      }
      const content = await readDocsContentByShellPath(state, entry.path);
      await writeFileWithParents(outputPath, content.buffer);
      downloaded += 1;
    }
  }

  await visit(remotePath, localDir);
  return { downloaded, directoriesCreated };
}

async function uploadReceivedEntriesToDocs(
  state: ShellState,
  stagingDir: string,
  received: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>,
  targetBase: string,
  remotePathInput?: string
): Promise<{ uploaded: number; directoriesEnsured: number }> {
  let uploaded = 0;
  let directoriesEnsured = 0;
  const targetNode = await resolveDocsNodeOrUndefined(state, targetBase);

  if (received.length > 1 && targetNode?.type === "doc") {
    throw new Error("rz received multiple files, but the target path is a document.");
  }

  for (const entry of received) {
    const localPath = path.join(stagingDir, entry.name);
    const remotePath =
      targetNode?.type === "dir" || received.length > 1 || !remotePathInput
        ? resolveRemotePath(targetBase, entry.name)
        : targetBase;

    if (entry.isDirectory()) {
      const result = await pushLocalDirectoryToDocs(state, localPath, remotePath);
      uploaded += result.uploaded;
      directoriesEnsured += result.directoriesEnsured;
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await uploadLocalFileToDocs(state, localPath, remotePath);
    uploaded += 1;
  }

  return { uploaded, directoriesEnsured };
}

async function uploadReceivedEntriesToFs(
  state: ShellState,
  fsService: FsService,
  stagingDir: string,
  received: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>,
  targetBase: string,
  remotePathInput: string | undefined,
  targetStat?: { type: "file" | "dir" }
): Promise<{ uploaded: number; directoriesUploaded: number }> {
  if (received.length > 1 && targetStat?.type === "file") {
    throw new Error("rz received multiple files, but the target path is a file.");
  }

  let uploaded = 0;
  let directoriesUploaded = 0;

  for (const entry of received) {
    const localPath = path.join(stagingDir, entry.name);
    const remotePath =
      targetStat?.type === "dir" || received.length > 1 || !remotePathInput
        ? resolveRemotePath(targetBase, entry.name)
        : targetBase;

    if (entry.isDirectory()) {
      await fsService.pushDirectory(localPath, remotePath);
      directoriesUploaded += 1;
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await fsService.putLocalFile(localPath, remotePath);
    uploaded += 1;
  }

  return { uploaded, directoriesUploaded };
}

async function stageDocsPathsForSz(
  state: ShellState,
  stagingDir: string,
  remotePaths: string[]
): Promise<{ paths: string[]; needsRecursive: boolean }> {
  const stagedPaths: string[] = [];
  let needsRecursive = false;

  for (const remotePathInput of remotePaths) {
    const remotePath = resolveRemotePath(state.cwd, remotePathInput);
    const node = await resolveDocsNode(state, remotePath);
    const localPath = path.join(stagingDir, path.posix.basename(remotePath) || path.basename(state.db ?? "docs"));

    if (node.type === "dir") {
      needsRecursive = true;
      await pullDocsDirectory(state, remotePath, localPath);
    } else {
      const content = await readDocsContentByShellPath(state, remotePath);
      await writeFileWithParents(localPath, content.buffer);
    }

    stagedPaths.push(localPath);
  }

  return { paths: stagedPaths, needsRecursive };
}

async function stageFsPathsForSz(
  state: ShellState,
  stagingDir: string,
  remotePaths: string[]
): Promise<{ paths: string[]; needsRecursive: boolean }> {
  await ensureFsDb(state);
  const fsService = createFsService(state);
  const stagedPaths: string[] = [];
  let needsRecursive = false;

  for (const remotePathInput of remotePaths) {
    const remotePath = resolveRemotePath(state.cwd, remotePathInput);
    const details = await fsService.stat(remotePath);
    const localPath = path.join(stagingDir, path.posix.basename(remotePath));

    if (details.type === "dir") {
      needsRecursive = true;
      await fsService.pullDirectory(remotePath, localPath);
    } else {
      await fsService.getToLocalFile(remotePath, localPath);
    }

    stagedPaths.push(localPath);
  }

  return { paths: stagedPaths, needsRecursive };
}

async function resolveDocsNodeOrUndefined(
  state: ShellState,
  remotePath: string
): Promise<
  | { type: "dir"; path: string; prefix: string; count: number }
  | { type: "doc"; path: string; id: string; doc: Record<string, unknown> }
  | undefined
> {
  try {
    return await resolveDocsNode(state, remotePath);
  } catch (error) {
    if (error instanceof Error && /does not exist/.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

async function classifyCopySource(
  state: ShellState,
  sourceInput: string
): Promise<"local-file" | "local-dir" | "remote"> {
  const localKind = await getLocalPathKind(state.localCwd, sourceInput);
  const remoteKind = await getRemotePathKind(state, sourceInput);

  if (looksLikeExplicitLocalPath(sourceInput)) {
    if (localKind) {
      return localKind === "dir" ? "local-dir" : "local-file";
    }
    throw new Error(`Local path ${resolveLocalPath(state.localCwd, sourceInput)} does not exist.`);
  }

  if (looksLikeExplicitRemotePath(sourceInput)) {
    if (remoteKind) {
      return "remote";
    }
    throw new Error(`Remote path ${resolveRemotePath(state.cwd, sourceInput)} does not exist.`);
  }

  if (localKind && !remoteKind) {
    return localKind === "dir" ? "local-dir" : "local-file";
  }

  if (remoteKind && !localKind) {
    return "remote";
  }

  if (localKind && remoteKind) {
    return localKind === "dir" ? "local-dir" : "local-file";
  }

  throw new Error(
    `Cannot resolve copy source ${sourceInput}. Use ./ or ~/ for local paths, or /... for explicit remote paths.`
  );
}

async function getLocalPathKind(base: string, input: string): Promise<"file" | "dir" | undefined> {
  try {
    const details = await stat(resolveLocalPath(base, input));
    if (details.isDirectory()) {
      return "dir";
    }
    if (details.isFile()) {
      return "file";
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function getRemotePathKind(state: ShellState, input: string): Promise<"file" | "dir" | undefined> {
  const remotePath = resolveRemotePath(state.cwd, input);
  if ((await getDbMode(state)) === "docs") {
    const node = await resolveDocsNodeOrUndefined(state, remotePath);
    if (!node) {
      return undefined;
    }
    return node.type === "dir" ? "dir" : "file";
  }

  try {
    const details = await createFsService(state).stat(remotePath);
    return details.type === "dir" ? "dir" : "file";
  } catch {
    return undefined;
  }
}

async function resolveRemoteNodeForCopy(
  state: ShellState,
  input: string
): Promise<
  | { type: "dir"; path: string }
  | { type: "file"; path: string }
> {
  const remotePath = resolveRemotePath(state.cwd, input);
  const kind = await getRemotePathKind(state, input);
  if (!kind) {
    throw new Error(`Remote path ${remotePath} does not exist.`);
  }
  return {
    type: kind,
    path: remotePath
  };
}

async function resolveRemoteTargetPathForLocalSource(
  state: ShellState,
  localPath: string,
  targetInput: string | undefined,
  sourceIsDir: boolean
): Promise<string> {
  const baseName = path.basename(localPath);
  if (!targetInput) {
    return sourceIsDir ? resolveRemotePath(state.cwd, baseName) : resolveRemotePath(state.cwd, baseName);
  }

  const candidate = resolveRemotePath(state.cwd, targetInput);
  const existingKind = await getRemotePathKind(state, targetInput);
  if (existingKind === "dir") {
    return resolveRemotePath(candidate, baseName);
  }
  return candidate;
}

async function resolveLocalTargetPathForRemoteSource(
  state: ShellState,
  remotePath: string,
  targetInput: string | undefined,
  sourceIsDir: boolean
): Promise<string> {
  const baseName = path.posix.basename(remotePath);
  if (!targetInput) {
    return path.resolve(state.localCwd, baseName);
  }

  const candidate = resolveLocalPath(state.localCwd, targetInput);
  const existingKind = await getLocalPathKind(state.localCwd, targetInput);
  if (existingKind === "dir") {
    return path.join(candidate, baseName);
  }
  if (sourceIsDir && targetInput === ".") {
    return path.resolve(state.localCwd, baseName);
  }
  return candidate;
}

function tryParseJsonObject(buffer: Buffer): Record<string, unknown> | undefined {
  try {
    return ensureObject(JSON.parse(buffer.toString("utf8")), "Document payload must be a JSON object.");
  } catch {
    return undefined;
  }
}

function shouldStoreAsJsonDoc(
  localPath: string,
  remotePath: string,
  existing: Record<string, unknown> | undefined,
  parsedJson: Record<string, unknown> | undefined
): boolean {
  if (!parsedJson) {
    return false;
  }
  if (existing && !hasAttachments(existing)) {
    return true;
  }

  const lowerExt = path.extname(localPath).toLowerCase();
  const remoteBase = path.posix.basename(remotePath).toLowerCase();
  return lowerExt === ".json" || remoteBase === "manifest";
}

function hasAttachments(doc: Record<string, unknown> | undefined): boolean {
  return getAttachmentEntries(doc).length > 0;
}

function getAttachmentEntries(
  doc: Record<string, unknown> | undefined
): Array<{ name: string; contentType?: string; length?: number }> {
  const attachments = doc?._attachments;
  if (!attachments || typeof attachments !== "object") {
    return [];
  }

  return Object.entries(attachments)
    .filter(([, value]) => value && typeof value === "object")
    .map(([name, value]) => ({
      name,
      contentType: typeof (value as Record<string, unknown>).content_type === "string"
        ? String((value as Record<string, unknown>).content_type)
        : undefined,
      length: typeof (value as Record<string, unknown>).length === "number"
        ? Number((value as Record<string, unknown>).length)
        : undefined
    }));
}

function getPrimaryAttachment(
  doc: Record<string, unknown> | undefined
): { name: string; contentType?: string; length?: number; fileName: string } | undefined {
  const attachments = getAttachmentEntries(doc);
  if (attachments.length === 0) {
    return undefined;
  }

  const preferredName = [
    "content",
    typeof doc?._id === "string" ? path.posix.basename(String(doc._id)) : undefined
  ].find((value): value is string => Boolean(value));

  const exact = preferredName ? attachments.find((entry) => entry.name === preferredName) : undefined;
  if (exact) {
    return {
      ...exact,
      fileName: exact.name === "content" && typeof doc?._id === "string" ? path.posix.basename(String(doc._id)) : exact.name
    };
  }

  const first = attachments.length === 1 ? attachments[0] : attachments.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
  return {
    ...first,
    fileName: first.name === "content" && typeof doc?._id === "string" ? path.posix.basename(String(doc._id)) : first.name
  };
}

function isTextLikeContent(contentType: string | undefined, fileName: string): boolean {
  const normalized = (contentType ?? "").toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("javascript")
  ) {
    return true;
  }

  const ext = path.extname(fileName).toLowerCase();
  return [
    ".txt",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".xml",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".sh"
  ].includes(ext);
}

async function writeFileWithParents(outputPath: string, buffer: Buffer): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
}

async function tryGetDoc(state: ShellState, docId: string): Promise<Record<string, unknown> | undefined> {
  if (!docId) {
    return undefined;
  }
  try {
    return await createClient(state).getDoc<Record<string, unknown>>(undefined, docId);
  } catch (error) {
    if (error instanceof CliError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

async function listDocsUnderPrefix(
  state: ShellState,
  remotePath: string
): Promise<Array<Record<string, unknown>>> {
  const prefix = `${toDocId(remotePath)}/`;
  const response = await createClient(state).allDocs(undefined, {
    include_docs: true,
    startkey: JSON.stringify(prefix),
    endkey: JSON.stringify(`${prefix}\ufff0`),
    limit: 500
  });
  return response.rows
    .map((row) => row.doc)
    .filter((doc): doc is Record<string, unknown> => Boolean(doc));
}

async function listDocsWithBodies(
  state: ShellState,
  prefix?: string
): Promise<Array<Record<string, unknown>>> {
  const query =
    prefix && prefix !== "/" && prefix !== "."
      ? {
          include_docs: true,
          startkey: JSON.stringify(prefix),
          endkey: JSON.stringify(`${prefix}\ufff0`)
        }
      : {
          include_docs: true
        };
  const response = await createClient(state).allDocs(undefined, {
    limit: 500,
    ...query
  });
  return response.rows
    .map((row) => row.doc)
    .filter((doc): doc is Record<string, unknown> => Boolean(doc));
}

async function ensureDocsDirectories(state: ShellState, remotePath: string): Promise<string[]> {
  await ensureDb(state);

  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") {
    return [];
  }

  const created: string[] = [];
  for (const dirPath of ancestorPaths(normalized).filter((entry) => entry !== "/")) {
    const docAtPath = await tryGetDoc(state, toDocId(dirPath));
    if (docAtPath && !isDirMarkerDoc(docAtPath)) {
      throw new Error(`Path ${dirPath} already exists as a document in database ${state.db}.`);
    }

    if (await hasDocsDirMarker(state, dirPath)) {
      continue;
    }

    const timestamp = toIsoTimestamp();
    await createClient(state).putDoc(undefined, docsDirMarkerId(dirPath), {
      _id: docsDirMarkerId(dirPath),
      type: "cdb_dir",
      path: dirPath,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    created.push(dirPath);
  }

  return created;
}

function docsDirMarkerId(remotePath: string): string {
  return `${toDocId(remotePath)}/${DOCS_DIR_MARKER}`;
}

function isDirMarkerId(id: string): boolean {
  return id.endsWith(`/${DOCS_DIR_MARKER}`);
}

function isDirMarkerDoc(doc: Record<string, unknown>): boolean {
  return typeof doc._id === "string" && isDirMarkerId(String(doc._id));
}

async function hasDocsDirMarker(state: ShellState, remotePath: string): Promise<boolean> {
  if (normalizeRemotePath(remotePath) === "/") {
    return true;
  }
  return Boolean(await tryGetDoc(state, docsDirMarkerId(remotePath)));
}

function extractModifiedAt(doc: Record<string, unknown>): string | undefined {
  const candidates = [
    doc.uploaded_at,
    doc.uploadedAt,
    doc.published_at,
    doc.publishedAt,
    doc.updated_at,
    doc.updatedAt,
    doc.modified_at,
    doc.modifiedAt
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function extractDisplaySize(doc: Record<string, unknown>): number {
  const attachmentSize = extractAttachmentSize(doc);
  if (attachmentSize !== undefined) {
    return attachmentSize;
  }

  if (typeof doc.size === "number" && Number.isFinite(doc.size) && doc.size >= 0) {
    return doc.size;
  }

  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

function extractDocDisplayType(doc: Record<string, unknown>): "doc" | "file" {
  return getPrimaryAttachment(doc) ? "file" : "doc";
}

function extractDisplayMime(doc: Record<string, unknown>): string | undefined {
  const primary = getPrimaryAttachment(doc);
  if (primary?.contentType) {
    return primary.contentType;
  }
  return extractDocDisplayType(doc) === "doc" ? "application/json" : undefined;
}

function extractAttachmentSize(doc: Record<string, unknown>): number | undefined {
  const attachments = doc._attachments;
  if (!attachments || typeof attachments !== "object") {
    return undefined;
  }

  let total = 0;
  let seen = false;

  for (const value of Object.values(attachments)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const length = (value as Record<string, unknown>).length;
    if (typeof length === "number" && Number.isFinite(length) && length >= 0) {
      total += length;
      seen = true;
    }
  }

  return seen ? total : undefined;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function toDocId(remotePath: string): string {
  return stripLeadingSlash(normalizeRemotePath(remotePath));
}

function printShellHelp(): void {
  stdout.write(
    `Shell commands:
  help                     Show this help
  exit | quit              Leave the shell
  target                   Show current url/user/db/cwd
  mode                     Show current shell mode and what commands make sense here
  lpwd                     Show local working directory used by put/get/push/pull
  lcd [path]               Change local working directory
  l<cmd> ...               Run a local command, for example \`lls -la\`, \`lcp a b\`, \`lmkdir tmp\`
  whoami                   Ask CouchDB who you are
  dbs                      List databases on the CouchDB server
  db                       Show current database, or server root
  use <db>                 Switch current database directly
  mkdb <db>                Create a database and enter it
  createdb <db>            Alias of mkdb
  initfs                   Initialize the current database for file-style storage
  pwd                      Show current path
  cd <db>                  From server root, enter a database
  cd [path]                Inside a database, change virtual/real remote directory
  cd ..                    From database root, go back to server root
  ls                       At server root: list databases. In a docs db: list virtual dirs, JSON docs, and attachment files. In an fs db: list directories/files
  stat <path>              Show remote metadata
  mkdir <path>             At server root: create a database. In a docs/fs db: create a directory
  cat <path>               Print remote file or JSON doc
  vi <path>                Alias of vim
  vim <path>               Edit remote file or JSON doc via $EDITOR
  put <local> [remote]     Upload local file
  cp <source> [target]     Auto-detect local<->remote copy; supports files and directories
  get <remote> [local]     Download remote file or doc tree
  push <localDir> [remote] Upload local directory
  pull [remote] <localDir> Download remote directory
  rz [options] [remote]    Receive file(s) into a temp dir via zmodem, then upload into the current remote directory
  sz [options] <remote>    Stage remote file(s) or directories in a temp dir, then send them via zmodem
  rm [-r] <path>           At server root: delete a database. In a db: delete docs/files
  login | connect          Re-login or switch target

Notes:
  - Modes:
    root  : database list mode
    docs  : CouchDB doc IDs shown as virtual directories; JSON docs stay as docs, attachments behave like files
    fs    : file-style storage mode initialized by \`initfs\`
  - Enter a database with \`cd <db>\` or \`use <db>\`.
  - At server root, \`mkdir <db>\` also creates a new database and enters it.
  - At server root, \`rm <db>\` deletes a database after confirmation.
  - In docs mode, empty directories are stored as hidden marker docs.
  - In docs mode, \`put/push/rz\` write JSON docs when the source is JSON-like, otherwise they write attachment-backed files.
  - Local paths in \`put/get/push/pull/cp\` are resolved from the local cwd shown by \`lpwd\`.
  - \`cp ./file.txt\` uploads into the current remote directory. \`cp remote.txt\` downloads into the current local directory.
  - \`cp ./dir\` uploads the whole directory into the current remote directory. \`cp remote-dir\` downloads it into the current local directory.
  - Use \`l<cmd>\` to run local commands in that local cwd. For example: \`lls\`, \`lcp\`, \`lmkdir\`, \`lrz\`.
  - \`rz\` receives into a temp dir, then uploads into the current docs/fs path.
  - \`sz\` is the reverse path: stage remote docs/files in a temp dir, then send them with local \`sz\`. Directories add \`-r\` automatically.
`
  );
}
