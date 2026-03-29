import { Command } from "commander";

import { createAction } from "../cli/action.js";
import { formatKeyValueObject, formatNameList } from "./helpers.js";

export function registerDbCommands(program: Command): void {
  const db = program.command("db").description("Manage databases");

  db
    .command("list")
    .description("List databases")
    .action(
      createAction(
        "db list",
        async (context) => {
          const { client } = context.getClient({ requireUrl: true, requireDb: false });
          return { data: await client.listDbs() };
        },
        (result) => formatNameList(result.data as string[])
      )
    );

  db
    .command("create")
    .argument("<name>", "Database name")
    .description("Create a database")
    .action(
      createAction("db create", async (context, args) => {
        const { client } = context.getClient({ requireUrl: true, requireDb: false });
        const [name] = args;
        return {
          data: await client.createDb(name),
          message: `Created database ${name}.`
        };
      })
    );

  db
    .command("delete")
    .argument("<name>", "Database name")
    .description("Delete a database")
    .action(
      createAction("db delete", async (context, args) => {
        const [name] = args;
        await context.confirm(`Delete database ${name}?`);
        const { client } = context.getClient({ requireUrl: true, requireDb: false });
        await client.deleteDb(name);
        return {
          data: { name },
          message: `Deleted database ${name}.`
        };
      })
    );

  db
    .command("info")
    .argument("[name]", "Database name")
    .description("Show database info")
    .action(
      createAction(
        "db info",
        async (context, args) => {
          const [name] = args;
          const { client, resolved } = context.getClient({ requireUrl: true, requireDb: false });
          return {
            data: (await client.dbInfo(name ?? resolved.db)) as Record<string, unknown>
          };
        },
        (result) => formatKeyValueObject(result.data as Record<string, unknown>)
      )
    );
}
