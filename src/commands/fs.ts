import { Command } from "commander";

import { createAction } from "../cli/action.js";
import { FsService } from "../core/fs/service.js";
import { formatTable } from "./helpers.js";

function formatFsList(result: { data?: unknown }): string {
  return formatTable(
    (result.data as Array<Record<string, string | number>>).map((entry) => ({
      type: entry.type as string,
      path: entry.path as string,
      size: entry.size as number | undefined,
      mime: entry.mime as string | undefined
    })),
    ["type", "path", "size", "mime"]
  );
}

export function registerFsCommands(program: Command): void {
  const fsCommand = program.command("fs").description("Manage a CouchDB-backed file tree");

  function createFsService(context: Parameters<Parameters<typeof createAction>[1]>[0]) {
    const { client, resolved } = context.getClient({ requireUrl: true, requireDb: true });
    return new FsService(client, resolved.db!);
  }

  fsCommand
    .command("init")
    .description("Initialize the active database as a cdbfs store")
    .action(
      createAction("fs init", async (context) => {
        const service = createFsService(context);
        await service.init();
        return {
          data: { db: context.resolved.db },
          message: `Initialized ${context.resolved.db} as cdbfs.`
        };
      })
    );

  fsCommand
    .command("ls")
    .argument("[path]", "Remote path", "/")
    .option("--recursive", "Walk recursively")
    .description("List directory contents")
    .action(
      createAction("fs ls", async (context, args, options) => {
        const service = createFsService(context);
        return {
          data: await service.list(args[0], Boolean(options.recursive))
        };
      }, formatFsList)
    );

  fsCommand
    .command("stat")
    .argument("<path>", "Remote path")
    .description("Show path metadata")
    .action(
      createAction(
        "fs stat",
        async (context, args) => {
          const service = createFsService(context);
          return {
            data: await service.stat(args[0])
          };
        },
        (result) => JSON.stringify(result.data, null, 2)
      )
    );

  fsCommand
    .command("mkdir")
    .argument("<path>", "Remote directory")
    .description("Create a directory path")
    .action(
      createAction("fs mkdir", async (context, args) => {
        const service = createFsService(context);
        const created = await service.mkdir(args[0]);
        return {
          data: { created: created.map((entry) => entry.path) },
          message: `Ensured directory ${args[0]}.`
        };
      })
    );

  fsCommand
    .command("cat")
    .argument("<path>", "Remote file")
    .description("Print a remote file as UTF-8")
    .action(
      createAction(
        "fs cat",
        async (context, args) => {
          const service = createFsService(context);
          return {
            data: { content: await service.cat(args[0]) }
          };
        },
        (result) => (result.data as { content: string }).content
      )
    );

  fsCommand
    .command("edit")
    .argument("<path>", "Remote file")
    .description("Edit a remote file using $EDITOR")
    .action(
      createAction("fs edit", async (context, args) => {
        const service = createFsService(context);
        const doc = await service.edit(args[0]);
        return {
          data: doc,
          message: `Updated ${doc.path}.`
        };
      })
    );

  fsCommand
    .command("put")
    .argument("<localFile>", "Local file")
    .argument("<remotePath>", "Remote path")
    .description("Upload one local file")
    .action(
      createAction("fs put", async (context, args) => {
        const service = createFsService(context);
        const doc = await service.putLocalFile(args[0], args[1]);
        return {
          data: doc,
          message: `Uploaded ${args[0]} to ${doc.path}.`
        };
      })
    );

  fsCommand
    .command("get")
    .argument("<remotePath>", "Remote file")
    .argument("<localFile>", "Local path")
    .description("Download one remote file")
    .action(
      createAction("fs get", async (context, args) => {
        const service = createFsService(context);
        await service.getToLocalFile(args[0], args[1]);
        return {
          data: { remotePath: args[0], localFile: args[1] },
          message: `Downloaded ${args[0]} to ${args[1]}.`
        };
      })
    );

  fsCommand
    .command("push")
    .argument("<localDir>", "Local directory")
    .argument("[remotePath]", "Remote directory", "/")
    .description("Upload a local directory tree")
    .action(
      createAction(
        "fs push",
        async (context, args) => {
          const service = createFsService(context);
          return {
            data: await service.pushDirectory(args[0], args[1])
          };
        },
        (result) => JSON.stringify(result.data, null, 2)
      )
    );

  fsCommand
    .command("pull")
    .argument("[remotePath]", "Remote directory", "/")
    .argument("<localDir>", "Local directory")
    .description("Download a remote directory tree")
    .action(
      createAction(
        "fs pull",
        async (context, args) => {
          const service = createFsService(context);
          return {
            data: await service.pullDirectory(args[0], args[1])
          };
        },
        (result) => JSON.stringify(result.data, null, 2)
      )
    );

  fsCommand
    .command("rm")
    .argument("<path>", "Remote path")
    .option("--recursive", "Delete directories recursively")
    .description("Delete a file or directory")
    .action(
      createAction("fs rm", async (context, args, options) => {
        await context.confirm(`Delete ${args[0]} from ${context.resolved.db}?`);
        const service = createFsService(context);
        const removed = await service.remove(args[0], Boolean(options.recursive));
        return {
          data: { removed },
          message: `Deleted ${removed} remote item(s).`
        };
      })
    );
}
