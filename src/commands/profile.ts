import { Command } from "commander";

import { createAction } from "../cli/action.js";
import type { ProfileConfig } from "../core/config/store.js";
import { CliError, EXIT_CODES } from "../core/errors.js";
import { formatKeyValueObject, formatTable } from "./helpers.js";

export function registerProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Save and switch between different CouchDB addresses/accounts");

  profile.addHelpText(
    "after",
    `
Examples:
  Save a target and make it current:
    cdb profile add prod --url "http://127.0.0.1:5984" --user admin --db mydb --current

  See saved targets:
    cdb profile list

  Switch target:
    cdb profile use prod
    cdb profile switch prod

  Show the current target:
    cdb profile current

Notes:
  - Profiles normally store url/user/db only.
  - Password is not stored unless you pass --save-password.
  - Remembered cookies are stored separately from profiles.
`
  );

  profile
    .command("add")
    .argument("<name>", "Profile name")
    .option("--url <url>", "CouchDB base URL")
    .option("--user <user>", "Basic auth user")
    .option("--password <password>", "Basic auth password")
    .option("--save-password", "Persist password in the profile")
    .option("--db <db>", "Default database")
    .option("--current", "Set as current profile")
    .description("Add or update a saved connection target")
    .action(
      createAction(
        "profile add",
        async (context, args, options) => {
          const [name] = args;
          const existing = context.store.profiles[name];
          const url =
            (options.url as string | undefined) ??
            existing?.url ??
            context.resolved.url ??
            (await context.prompt("CouchDB URL"));
          const user =
            (options.user as string | undefined) ??
            existing?.user ??
            context.resolved.user;

          context.store.profiles[name] = {
            url,
            user,
            password: options.savePassword ? (options.password as string | undefined) : undefined,
            db: (options.db as string | undefined) ?? existing?.db ?? context.resolved.db
          };

          if (options.current) {
            context.store.currentProfile = name;
            context.setCurrentTarget({
              url,
              user,
              db: context.store.profiles[name].db
            });
          }

          await context.saveStore();
          return {
            data: {
              name,
              profile: sanitizeProfile(context.store.profiles[name]),
              current: context.store.currentProfile === name
            },
            message: `Saved profile ${name}.`
          };
        }
      )
    );

  profile
    .command("list")
    .description("List saved profiles")
    .action(
      createAction(
        "profile list",
        async (context) => ({
          data: Object.entries(context.store.profiles).map(([name, value]) => ({
            name,
            current: context.store.currentProfile === name ? "*" : "",
            url: value.url,
            user: value.user ?? "",
            db: value.db ?? "",
            auth: value.password ? "password" : ""
          }))
        }),
        (result) =>
          formatTable(result.data as Array<Record<string, string>>, ["current", "name", "url", "user", "db", "auth"])
      )
    );

  profile
    .command("use")
    .argument("<name>", "Profile name")
    .description("Switch to a saved profile")
    .action(
      createAction("profile use", async (context, args) => {
        const [name] = args;
        if (!context.store.profiles[name]) {
          throw new CliError("PROFILE_NOT_FOUND", `Profile ${name} does not exist.`, EXIT_CODES.NOT_FOUND);
        }
        context.store.currentProfile = name;
        context.setCurrentTarget({
          url: context.store.profiles[name].url,
          user: context.store.profiles[name].user,
          db: context.store.profiles[name].db
        });
        await context.saveStore();
        return {
          data: { currentProfile: name },
          message: `Current profile set to ${name}.`
        };
      })
    );

  profile
    .command("switch")
    .argument("<name>", "Profile name")
    .description("Alias for profile use")
    .action(
      createAction("profile switch", async (context, args) => {
        const [name] = args;
        if (!context.store.profiles[name]) {
          throw new CliError("PROFILE_NOT_FOUND", `Profile ${name} does not exist.`, EXIT_CODES.NOT_FOUND);
        }
        context.store.currentProfile = name;
        context.setCurrentTarget({
          url: context.store.profiles[name].url,
          user: context.store.profiles[name].user,
          db: context.store.profiles[name].db
        });
        await context.saveStore();
        return {
          data: { currentProfile: name },
          message: `Current profile set to ${name}.`
        };
      })
    );

  profile
    .command("current")
    .description("Show the current saved profile and resolved connection target")
    .action(
      createAction(
        "profile current",
        async (context) => ({
          data: {
            currentProfile: context.store.currentProfile ?? null,
            currentTarget: context.store.currentTarget ?? null,
            resolved: sanitizeProfile({
              url: context.resolved.url ?? "",
              user: context.resolved.user,
              db: context.resolved.db
            })
          }
        }),
        (result) => formatKeyValueObject(result.data as Record<string, unknown>)
      )
    );

  profile
    .command("test")
    .argument("[name]", "Profile name")
    .description("Test whether a saved profile can talk to CouchDB")
    .action(
      createAction(
        "profile test",
        async (context, args) => {
          const [name] = args;
          const selected = name ?? context.store.currentProfile;
          if (!selected || !context.store.profiles[selected]) {
            throw new CliError(
              "PROFILE_NOT_FOUND",
              "Choose an existing profile or set a current profile first.",
              EXIT_CODES.NOT_FOUND
            );
          }

          const profileConfig = context.store.profiles[selected];
          const resolved = context.resolve(profileConfig);
          const { client } = context.getClient({
            overrides: {
              url: resolved.url,
              db: resolved.db,
              user: resolved.user,
              password: resolved.password
            }
          });
          const session = (await client.getSession()) as Record<string, unknown>;

          return {
            data: {
              profile: selected,
              session
            }
          };
        },
        (result) => formatKeyValueObject(result.data as Record<string, unknown>)
      )
    );
}

function sanitizeProfile(profile: ProfileConfig): Record<string, unknown> {
  return {
    url: profile.url,
    user: profile.user ?? null,
    db: profile.db ?? null,
    hasPassword: Boolean(profile.password)
  };
}
