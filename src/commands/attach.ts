import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { Command } from "commander";
import mime from "mime-types";

import { createAction } from "../cli/action.js";
import { CliError, EXIT_CODES } from "../core/errors.js";
import { formatTable } from "./helpers.js";

export function registerAttachCommands(program: Command): void {
  const attach = program.command("attach").description("Manage document attachments");

  attach
    .command("list")
    .argument("<docId>", "Document ID")
    .description("List attachments on a document")
    .action(
      createAction(
        "attach list",
        async (context, args) => {
          const { client } = context.getClient({ requireUrl: true, requireDb: true });
          const doc = (await client.getDoc<Record<string, unknown>>(undefined, args[0])) as Record<
            string,
            unknown
          >;
          const attachments = (doc._attachments ?? {}) as Record<
            string,
            { content_type?: string; length?: number }
          >;
          return {
            data: Object.entries(attachments).map(([name, value]) => ({
              name,
              contentType: value.content_type ?? "",
              length: value.length ?? 0
            }))
          };
        },
        (result) => formatTable(result.data as Array<Record<string, string | number>>, ["name", "contentType", "length"])
      )
    );

  attach
    .command("get")
    .argument("<docId>", "Document ID")
    .argument("<name>", "Attachment name")
    .option("--output <path>", "Write attachment to file")
    .description("Download an attachment")
    .action(
      createAction(
        "attach get",
        async (context, args, options) => {
          const [docId, name] = args;
          const { client } = context.getClient({ requireUrl: true, requireDb: true });
          const attachment = await client.getAttachment(undefined, docId, name);
          const output = options.output as string | undefined;
          if (output) {
            await mkdir(path.dirname(output), { recursive: true });
            await writeFile(output, attachment.buffer);
            return {
              data: { docId, name, output },
              message: `Wrote attachment to ${output}.`
            };
          }

          return {
            data: {
              docId,
              name,
              contentType: attachment.contentType,
              content: attachment.buffer.toString("utf8")
            }
          };
        },
        (result) => {
          const data = result.data as { content?: string };
          return data.content;
        }
      )
    );

  attach
    .command("put")
    .argument("<docId>", "Document ID")
    .argument("<file>", "Local file path")
    .option("--name <name>", "Attachment name override")
    .option("--content-type <contentType>", "Attachment content type")
    .description("Upload an attachment")
    .action(
      createAction("attach put", async (context, args, options) => {
        const [docId, file] = args;
        const attachmentName = (options.name as string | undefined) ?? path.basename(file);
        const contentType =
          ((options.contentType as string | undefined) ?? mime.lookup(file)) || "application/octet-stream";
        const { client } = context.getClient({ requireUrl: true, requireDb: true });
        const doc = await client.getDoc<Record<string, unknown>>(undefined, docId);
        const rev = doc._rev;
        if (typeof rev !== "string") {
          throw new CliError("REV_MISSING", `Document ${docId} has no _rev.`, EXIT_CODES.INPUT);
        }
        const buffer = await readFile(file);
        const response = await client.putAttachment(undefined, docId, attachmentName, buffer, rev, contentType);
        return {
          data: response,
          message: `Uploaded attachment ${attachmentName}.`
        };
      })
    );

  attach
    .command("delete")
    .argument("<docId>", "Document ID")
    .argument("<name>", "Attachment name")
    .description("Delete an attachment")
    .action(
      createAction("attach delete", async (context, args) => {
        const [docId, name] = args;
        const { client } = context.getClient({ requireUrl: true, requireDb: true });
        const doc = await client.getDoc<Record<string, unknown>>(undefined, docId);
        const rev = doc._rev;
        if (typeof rev !== "string") {
          throw new CliError("REV_MISSING", `Document ${docId} has no _rev.`, EXIT_CODES.INPUT);
        }
        const response = await client.deleteAttachment(undefined, docId, name, rev);
        return {
          data: response,
          message: `Deleted attachment ${name}.`
        };
      })
    );
}
