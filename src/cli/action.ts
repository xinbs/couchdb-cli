import type { Command } from "commander";

import { normalizeError } from "../core/errors.js";
import { printError, printSuccess, type CommandResult, type HumanFormatter } from "../core/output/index.js";
import { CommandContext } from "./context.js";

export type ActionHandler = (
  context: CommandContext,
  args: string[],
  options: Record<string, unknown>,
  command: Command
) => Promise<CommandResult | void>;

export function createAction(
  commandName: string,
  handler: ActionHandler,
  formatter?: HumanFormatter
): (...args: unknown[]) => Promise<void> {
  return async (...actionArgs: unknown[]) => {
    const command = actionArgs[actionArgs.length - 1] as Command;
    const context = await CommandContext.create(command.optsWithGlobals());

    try {
      const result = (await handler(
        context,
        command.processedArgs as string[],
        command.opts<Record<string, unknown>>(),
        command
      )) ?? { silent: true };
      printSuccess(context, commandName, result, formatter);
    } catch (error) {
      const cliError = normalizeError(error);
      printError(context, commandName, cliError);
      throw cliError;
    }
  };
}
