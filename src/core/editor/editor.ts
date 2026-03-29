import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { parseArgsStringToArgv } from "string-argv";

import { CliError, EXIT_CODES } from "../errors.js";

export async function editBufferWithEditor(
  buffer: Buffer,
  options: { fileName?: string; editor?: string } = {}
): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cdb-edit-"));
  const tempFile = path.join(tempDir, options.fileName ?? "buffer.txt");
  await writeFile(tempFile, buffer);

  try {
    await runEditor(options.editor ?? process.env.EDITOR ?? defaultEditor(), tempFile);
    return await readFile(tempFile);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runEditor(editorCommand: string, tempFile: string): Promise<void> {
  const argv = parseArgsStringToArgv(editorCommand);
  if (argv.length === 0) {
    throw new CliError("EDITOR_MISSING", "No editor command is configured.", EXIT_CODES.INPUT);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], [...argv.slice(1), tempFile], {
      stdio: "inherit"
    });

    child.once("error", (error) => {
      reject(new CliError("EDITOR_FAILED", error.message, EXIT_CODES.INPUT));
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new CliError("EDITOR_FAILED", `Editor exited with code ${code}.`, EXIT_CODES.INPUT));
    });
  });
}

function defaultEditor(): string {
  return process.platform === "win32" ? "notepad" : "vi";
}
