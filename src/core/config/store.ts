import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import envPaths from "env-paths";
import { z } from "zod";

export interface ProfileConfig {
  url: string;
  user?: string;
  password?: string;
  db?: string;
}

export interface SessionConfig {
  url: string;
  user?: string;
  cookie: string;
  updatedAt: string;
}

export interface CurrentTargetConfig {
  url: string;
  user?: string;
  db?: string;
}

export interface ProfilesStore {
  currentProfile?: string;
  currentTarget?: CurrentTargetConfig;
  profiles: Record<string, ProfileConfig>;
  sessions: Record<string, SessionConfig>;
}

const STORE_SCHEMA = z.object({
  currentProfile: z.string().optional(),
  currentTarget: z
    .object({
      url: z.string(),
      user: z.string().optional(),
      db: z.string().optional()
    })
    .optional(),
  profiles: z.record(
    z.string(),
    z.object({
      url: z.string(),
      user: z.string().optional(),
      password: z.string().optional(),
      db: z.string().optional()
    })
  ),
  sessions: z.record(
    z.string(),
    z.object({
      url: z.string(),
      user: z.string().optional(),
      cookie: z.string(),
      updatedAt: z.string()
    })
  )
});

const DEFAULT_STORE: ProfilesStore = {
  profiles: {},
  sessions: {}
};

export function makeSessionKey(url: string, user?: string): string {
  return `${url}::${user ?? ""}`;
}

export class ConfigStoreManager {
  private readonly configDir: string;

  public constructor(baseDir?: string) {
    this.configDir = baseDir ?? envPaths("cdb-cli", { suffix: "" }).config;
  }

  public getConfigDir(): string {
    return this.configDir;
  }

  public getStorePath(): string {
    return path.join(this.configDir, "profiles.json");
  }

  public async load(): Promise<ProfilesStore> {
    try {
      const content = await readFile(this.getStorePath(), "utf8");
      return STORE_SCHEMA.parse(JSON.parse(content));
    } catch (error) {
      if (isMissingFile(error)) {
        return structuredClone(DEFAULT_STORE);
      }
      throw error;
    }
  }

  public async save(store: ProfilesStore): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.getStorePath(), JSON.stringify(store, null, 2), "utf8");
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
