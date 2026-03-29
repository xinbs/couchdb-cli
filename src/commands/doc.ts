import { Command } from "commander";

import { createAction } from "../cli/action.js";
import { readJsonSource, deepMerge, ensureObject } from "../core/utils.js";
import { CliError, EXIT_CODES } from "../core/errors.js";
import { formatTable } from "./helpers.js";

export function registerDocCommands(program: Command): void {
  const doc = program.command("doc").description("Manage CouchDB documents");

  doc
    .command("list")
    .option("--limit <limit>", "Number of docs", "20")
    .option("--include-docs", "Include full docs")
    .description("List documents in the active database")
    .action(
      createAction(
        "doc list",
        async (context, _args, options) => {
          const { client } = context.getClient({ requireUrl: true, requireDb: true });
          const limit = Number.parseInt(String(options.limit), 10);
          return {
            data: await client.allDocs(undefined, {
              include_docs: Boolean(options.includeDocs),
              limit
            })
          };
        },
        (result) => {
          const data = result.data as { rows: Array<{ id: string; value: { rev?: string } }> };
          return formatTable(
            data.rows.map((row) => ({
              id: row.id,
              rev: row.value?.rev ?? ""
            })),
            ["id", "rev"]
          );
        }
      )
    );

  doc
    .command("get")
    .argument("<id>", "Document ID")
    .description("Fetch a document")
    .action(
      createAction(
        "doc get",
        async (context, args) => {
          const { client } = context.getClient({ requireUrl: true, requireDb: true });
          return {
            data: await client.getDoc(undefined, args[0])
          };
        },
        (result) => JSON.stringify(result.data, null, 2)
      )
    );

  doc
    .command("put")
    .argument("<id>", "Document ID")
    .option("--file <path>", "Read document JSON from file")
    .option("--data <json>", "Inline document JSON")
    .description("Create or replace a document")
    .action(
      createAction("doc put", async (context, args, options) => {
        const [id] = args;
        const { client } = context.getClient({ requireUrl: true, requireDb: true });
        const payload = ensureObject(
          await readJsonSource({
            file: options.file as string | undefined,
            data: options.data as string | undefined
          }),
          "Document payload must be a JSON object."
        );

        try {
          const current = await client.getDoc<Record<string, unknown>>(undefined, id);
          payload._rev = current._rev as string | undefined;
        } catch (error) {
          if (!(error instanceof CliError) || error.code !== "NOT_FOUND") {
            throw error;
          }
        }

        payload._id = id;
        return {
          data: await client.putDoc(undefined, id, payload),
          message: `Upserted document ${id}.`
        };
      })
    );

  doc
    .command("patch")
    .argument("<id>", "Document ID")
    .option("--file <path>", "Read patch JSON from file")
    .option("--data <json>", "Inline patch JSON")
    .description("Deep-merge a JSON object into a document")
    .action(
      createAction("doc patch", async (context, args, options) => {
        const [id] = args;
        const { client } = context.getClient({ requireUrl: true, requireDb: true });
        const current = await client.getDoc<Record<string, unknown>>(undefined, id);
        const patch = ensureObject(
          await readJsonSource({
            file: options.file as string | undefined,
            data: options.data as string | undefined
          }),
          "Patch payload must be a JSON object."
        );

        const merged = deepMerge(current, patch);
        merged._id = id;
        merged._rev = current._rev;
        return {
          data: await client.putDoc(undefined, id, merged),
          message: `Patched document ${id}.`
        };
      })
    );

  doc
    .command("delete")
    .argument("<id>", "Document ID")
    .description("Delete a document")
    .action(
      createAction("doc delete", async (context, args) => {
        const [id] = args;
        const { client } = context.getClient({ requireUrl: true, requireDb: true });
        const current = await client.getDoc<Record<string, unknown>>(undefined, id);
        const rev = current._rev;
        if (typeof rev !== "string") {
          throw new CliError("REV_MISSING", `Document ${id} has no _rev.`, EXIT_CODES.INPUT);
        }
        await client.deleteDoc(undefined, id, rev);
        return {
          data: { id, rev },
          message: `Deleted document ${id}.`
        };
      })
    );
}
