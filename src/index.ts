#!/usr/bin/env node

import { CommanderError } from "commander";
import { createRequire } from "node:module";

import { buildProgram } from "./cli/program.js";
import { CliError, normalizeError } from "./core/errors.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

async function main(): Promise<void> {
  try {
    await buildProgram({ version: packageJson.version }).parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }

    const cliError = normalizeError(error);
    process.exitCode = cliError.exitCode;
  }
}

void main();
