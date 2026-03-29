import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";

import {
  ConfigStoreManager,
  makeSessionKey,
  type CurrentTargetConfig,
  type ProfilesStore
} from "../core/config/store.js";
import {
  resolveConnection,
  type ConnectionOverrides,
  type GlobalOptions,
  type ResolvedConnection
} from "../core/config/resolve.js";
import { CliError, EXIT_CODES } from "../core/errors.js";
import { CouchClient } from "../core/http/client.js";

export class CommandContext {
  public readonly storeManager: ConfigStoreManager;
  public readonly store: ProfilesStore;
  public readonly globalOptions: GlobalOptions;
  public readonly resolved: ResolvedConnection;

  private constructor(
    storeManager: ConfigStoreManager,
    store: ProfilesStore,
    globalOptions: GlobalOptions,
    resolved: ResolvedConnection
  ) {
    this.storeManager = storeManager;
    this.store = store;
    this.globalOptions = globalOptions;
    this.resolved = resolved;
  }

  public static async create(globalOptions: GlobalOptions): Promise<CommandContext> {
    const storeManager = new ConfigStoreManager();
    const store = await storeManager.load();
    const resolved = resolveConnection(globalOptions, store);
    return new CommandContext(storeManager, store, globalOptions, resolved);
  }

  public resolve(overrides: ConnectionOverrides = {}): ResolvedConnection {
    return resolveConnection(this.globalOptions, this.store, overrides);
  }

  public getClient(options: {
    requireUrl?: boolean;
    requireDb?: boolean;
    overrides?: ConnectionOverrides;
  } = {}): { client: CouchClient; resolved: ResolvedConnection } {
    const resolved = this.resolve(options.overrides);
    if (options.requireUrl !== false && !resolved.url) {
      throw new CliError(
        "URL_REQUIRED",
        "No CouchDB URL resolved. Set --url, COUCH_URL, or configure a profile.",
        EXIT_CODES.INPUT
      );
    }

    if (options.requireDb && !resolved.db) {
      throw new CliError(
        "DB_REQUIRED",
        "No database resolved. Set --db, COUCH_DB, or configure a profile.",
        EXIT_CODES.INPUT
      );
    }

    return {
      client: new CouchClient({
        baseUrl: resolved.url!,
        timeoutMs: resolved.timeoutMs,
        user: resolved.user,
        password: resolved.password,
        sessionCookie: resolved.sessionCookie,
        db: resolved.db
      }),
      resolved
    };
  }

  public async saveStore(): Promise<void> {
    await this.storeManager.save(this.store);
  }

  public upsertSession(url: string, user: string | undefined, cookie: string): void {
    this.store.sessions[makeSessionKey(url, user)] = {
      url,
      user,
      cookie,
      updatedAt: new Date().toISOString()
    };
  }

  public setCurrentTarget(target: CurrentTargetConfig): void {
    this.store.currentTarget = target;
  }

  public clearSession(url: string, user?: string): boolean {
    const key = makeSessionKey(url, user);
    if (!this.store.sessions[key]) {
      return false;
    }
    delete this.store.sessions[key];
    return true;
  }

  public async confirm(message: string): Promise<void> {
    if (this.resolved.yes) {
      return;
    }

    if (!stdin.isTTY) {
      throw new CliError("CONFIRMATION_REQUIRED", `${message} Re-run with --yes to confirm.`, EXIT_CODES.INPUT);
    }

    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await readline.question(`${message} [y/N] `);
      if (!/^(y|yes)$/i.test(answer.trim())) {
        throw new CliError("ABORTED", "Operation aborted.", EXIT_CODES.INPUT);
      }
    } finally {
      readline.close();
    }
  }

  public async promptYesNo(message: string, defaultValue = false): Promise<boolean> {
    if (!stdin.isTTY) {
      throw new CliError("PROMPT_UNAVAILABLE", `${message} Cannot prompt in a non-interactive shell.`, EXIT_CODES.INPUT);
    }

    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const suffix = defaultValue ? "[Y/n]" : "[y/N]";
      const answer = await readline.question(`${message} ${suffix} `);
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        return defaultValue;
      }
      return normalized === "y" || normalized === "yes";
    } finally {
      readline.close();
    }
  }

  public async prompt(message: string, defaultValue?: string): Promise<string> {
    if (!stdin.isTTY) {
      throw new CliError("PROMPT_UNAVAILABLE", `${message} Cannot prompt in a non-interactive shell.`, EXIT_CODES.INPUT);
    }

    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const suffix = defaultValue ? ` (${defaultValue})` : "";
      const answer = await readline.question(`${message}${suffix}: `);
      return answer.trim() || defaultValue || "";
    } finally {
      readline.close();
    }
  }

  public async promptSecret(message: string): Promise<string> {
    if (!stdin.isTTY) {
      throw new CliError("PROMPT_UNAVAILABLE", `${message} Cannot prompt in a non-interactive shell.`, EXIT_CODES.INPUT);
    }

    let muted = false;
    const mutedOutput = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          stdout.write(chunk, encoding as BufferEncoding);
        }
        callback();
      }
    });

    const readline = createInterface({
      input: stdin,
      output: mutedOutput,
      terminal: true
    });

    try {
      stdout.write(`${message}: `);
      muted = true;
      const answer = await readline.question("");
      muted = false;
      stdout.write("\n");
      return answer.trim();
    } finally {
      readline.close();
    }
  }
}
