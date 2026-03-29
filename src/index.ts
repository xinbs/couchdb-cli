#!/usr/bin/env node

import { CommanderError } from "commander";

import { buildProgram } from "./cli/program.js";
import { CliError, normalizeError } from "./core/errors.js";

async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv);
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
