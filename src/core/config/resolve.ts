import type { ProfilesStore } from "./store.js";
import { makeSessionKey } from "./store.js";

export interface GlobalOptions {
  profile?: string;
  url?: string;
  user?: string;
  password?: string;
  db?: string;
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
  timeout?: string | number;
}

export interface ConnectionOverrides {
  url?: string;
  db?: string;
  user?: string;
  password?: string;
}

export interface ResolvedConnection {
  profileName?: string;
  url?: string;
  db?: string;
  user?: string;
  password?: string;
  sessionCookie?: string;
  timeoutMs: number;
  json: boolean;
  quiet: boolean;
  yes: boolean;
}

export function resolveConnection(
  options: GlobalOptions,
  store: ProfilesStore,
  overrides: ConnectionOverrides = {},
  env: NodeJS.ProcessEnv = process.env
): ResolvedConnection {
  const profileName = options.profile ?? store.currentProfile;
  const profile = profileName ? store.profiles[profileName] : undefined;
  const currentTarget = profile ? undefined : store.currentTarget;

  const url = overrides.url ?? options.url ?? env.COUCH_URL ?? profile?.url ?? currentTarget?.url;
  const db = overrides.db ?? options.db ?? env.COUCH_DB ?? profile?.db ?? currentTarget?.db;
  const user = overrides.user ?? options.user ?? env.COUCH_USER ?? profile?.user ?? currentTarget?.user;
  const password = overrides.password ?? options.password ?? env.COUCH_PASSWORD ?? profile?.password;
  const sessionKey = url ? makeSessionKey(url, user) : undefined;
  const sessionCookie = sessionKey ? store.sessions[sessionKey]?.cookie : undefined;
  const timeoutInput = options.timeout ?? env.COUCH_TIMEOUT ?? 10_000;
  const timeoutMs =
    typeof timeoutInput === "string" ? Number.parseInt(timeoutInput, 10) || 10_000 : timeoutInput;

  return {
    profileName,
    url,
    db,
    user,
    password,
    sessionCookie,
    timeoutMs,
    json: Boolean(options.json),
    quiet: Boolean(options.quiet),
    yes: Boolean(options.yes)
  };
}
