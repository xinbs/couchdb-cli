import { Command } from "commander";

import { registerAttachCommands } from "../commands/attach.js";
import { registerAuthCommands } from "../commands/auth.js";
import { registerDbCommands } from "../commands/db.js";
import { registerDocCommands } from "../commands/doc.js";
import { registerFsCommands } from "../commands/fs.js";
import { registerProfileCommands } from "../commands/profile.js";
import { createAction } from "./action.js";
import { startShell } from "./shell.js";

export function buildProgram(options: { shellMode?: boolean; version?: string } = {}): Command {
  const program = new Command();

  program
    .name("cdb")
    .description("CouchDB CLI. Start with `cdb auth login`, then use `cdb db list` to verify the connection.")
    .version(options.version ?? "0.0.0")
    .showHelpAfterError()
    .option("--profile <profile>", "Connection profile name")
    .option("--url <url>", "CouchDB base URL")
    .option("--user <user>", "CouchDB username")
    .option("--password <password>", "CouchDB password")
    .option("--db <db>", "Default database")
    .option("--json", "Emit stable machine-readable output")
    .option("--quiet", "Suppress human-readable success output")
    .option("--yes", "Automatically confirm destructive operations")
    .option("--timeout <ms>", "Request timeout in milliseconds", "10000");

  program.addHelpText(
    "after",
    `
Getting started:
  1. Interactive login:
     cdb auth login

  2. Or connect directly without prompts:
     cdb --url "http://127.0.0.1:5984" --user admin --password secret db list

  3. If you use a .env file:
     set -a; source ./.env; set +a
     cdb db list

  4. Create a test database and try fs mode:
     TEST_DB="cdb_cli_test_$(date +%s)"
     cdb db create "$TEST_DB"
     cdb --db "$TEST_DB" fs init

Useful next commands:
  cdb auth login --help
  cdb profile --help
  cdb fs --help
`
  );

  if (options.shellMode) {
    program.exitOverride();
  } else {
    program.exitOverride();
  }

  registerProfileCommands(program);
  registerAuthCommands(program);
  registerDbCommands(program);
  registerDocCommands(program);
  registerAttachCommands(program);
  registerFsCommands(program);

  program
    .command("shell")
    .description("Launch a persistent interactive shell with remembered login/db/cwd state")
    .action(
      createAction("shell", async (context) => {
        await startShell(context);
        return { silent: true };
      })
    );

  return program;
}
