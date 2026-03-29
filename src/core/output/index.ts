import { stdout, stderr } from "node:process";

import type { CommandContext } from "../../cli/context.js";
import type { CliError } from "../errors.js";

export interface CommandResult {
  data?: unknown;
  message?: string;
  meta?: Record<string, unknown>;
  silent?: boolean;
}

export type HumanFormatter = (result: CommandResult) => string | undefined;

export function printSuccess(
  context: CommandContext,
  command: string,
  result: CommandResult = {},
  formatter?: HumanFormatter
): void {
  if (result.silent) {
    return;
  }

  if (context.resolved.json) {
    stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          command,
          data: result.data ?? null,
          meta: result.meta ?? {}
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (context.resolved.quiet) {
    return;
  }

  const formatted = formatter?.(result);
  if (formatted) {
    stdout.write(`${formatted}\n`);
    return;
  }

  if (typeof result.message === "string") {
    stdout.write(`${result.message}\n`);
    return;
  }

  if (result.data !== undefined) {
    stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  }
}

export function printError(context: CommandContext, command: string, error: CliError): void {
  if (context.resolved.json) {
    stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          command,
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? null
          }
        },
        null,
        2
      )}\n`
    );
    return;
  }

  stderr.write(`${error.code}: ${error.message}\n`);
}
