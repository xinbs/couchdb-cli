import { Command } from "commander";

import { createAction } from "../cli/action.js";
import { acquireAuthenticatedConnection } from "../core/auth/session.js";
import { CliError, EXIT_CODES } from "../core/errors.js";
import { formatKeyValueObject } from "./helpers.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Login, logout, and inspect the current CouchDB identity");

  auth
    .command("login")
    .option("--url <url>", "Override CouchDB URL")
    .option("--user <user>", "CouchDB username")
    .option("--password <password>", "CouchDB password")
    .option("--remember-cookie", "Persist the CouchDB session cookie for this url/user")
    .option("--no-remember-cookie", "Do not persist the CouchDB session cookie")
    .description("Login to CouchDB. If url/user/password are missing, prompt for them interactively.")
    .addHelpText(
      "after",
      `
Examples:
  Interactive login:
    cdb auth login

  Login without prompts:
    cdb auth login --url "http://127.0.0.1:5984" --user admin --password secret

  Login and remember only url + cookie:
    cdb auth login --remember-cookie

Notes:
  - Interactive login will ask for URL, username, password, then ask whether to record url + cookie.
  - By default, username and password are not saved.
  - Cookie persistence defaults to No unless you answer yes or pass --remember-cookie.
`
    )
    .action(
      createAction(
        "auth login",
        async (context, _args, options, command) => {
          const rememberOptionSource = command.getOptionValueSource("rememberCookie");
          const connection = await acquireAuthenticatedConnection(context, {
            url: options.url as string | undefined,
            user: options.user as string | undefined,
            password: options.password as string | undefined,
            rememberCookie:
              rememberOptionSource === "cli" ? Boolean(options.rememberCookie) : undefined,
            promptToRemember: true,
            forceFreshLogin: true
          });

          return {
            data: {
              url: connection.url,
              user: connection.user,
              rememberCookie: connection.rememberCookie
            },
            message: connection.rememberCookie
              ? `Authenticated and cached session cookie for ${connection.user}.`
              : `Authenticated as ${connection.user}. Session cookie was not persisted.`
          };
        }
      )
    );

  auth
    .command("logout")
    .description("Remove the cached session cookie for the current url + user")
    .action(
      createAction("auth logout", async (context) => {
        const resolved = context.resolve();
        if (!resolved.url) {
          throw new CliError("URL_REQUIRED", "No resolved CouchDB URL for logout.", EXIT_CODES.INPUT);
        }

        const removed = context.clearSession(resolved.url, resolved.user);
        if (removed) {
          await context.saveStore();
        }

        return {
          data: {
            removed,
            url: resolved.url,
            user: resolved.user ?? null
          },
          message: removed ? "Cached session removed." : "No cached session was found."
        };
      })
    );

  auth
    .command("whoami")
    .description("Show who CouchDB thinks you are right now")
    .action(
      createAction(
        "auth whoami",
        async (context) => {
          const { client } = context.getClient({ requireUrl: true });
          return {
            data: (await client.getSession()) as Record<string, unknown>
          };
        },
        (result) => formatKeyValueObject(result.data as Record<string, unknown>)
      )
    );
}
