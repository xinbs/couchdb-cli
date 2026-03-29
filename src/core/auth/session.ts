import type { CommandContext } from "../../cli/context.js";
import { CliError, EXIT_CODES } from "../errors.js";
import { CouchClient } from "../http/client.js";

export interface AuthenticatedConnection {
  url: string;
  user: string;
  password?: string;
  sessionCookie?: string;
  rememberCookie: boolean;
}

export interface AcquireAuthOptions {
  url?: string;
  user?: string;
  password?: string;
  sessionCookie?: string;
  rememberCookie?: boolean;
  promptToRemember?: boolean;
  forceFreshLogin?: boolean;
}

export async function acquireAuthenticatedConnection(
  context: CommandContext,
  options: AcquireAuthOptions = {}
): Promise<AuthenticatedConnection> {
  const initial = context.resolve({
    url: options.url,
    user: options.user,
    password: options.password
  });

  const url = initial.url || (await context.prompt("CouchDB URL"));
  const user = initial.user || (await context.prompt("Username"));

  if (!url) {
    throw new CliError("URL_REQUIRED", "CouchDB URL is required.", EXIT_CODES.INPUT);
  }
  if (!user) {
    throw new CliError("USER_REQUIRED", "Username is required.", EXIT_CODES.INPUT);
  }

  const storedSessionCookie = options.sessionCookie ?? initial.sessionCookie;
  const canReuseSession = Boolean(storedSessionCookie) && !options.forceFreshLogin;

  if (canReuseSession) {
    return {
      url,
      user,
      sessionCookie: storedSessionCookie,
      rememberCookie: Boolean(options.rememberCookie)
    };
  }

  const password = initial.password || (await context.promptSecret("Password"));
  if (!password) {
    throw new CliError("PASSWORD_REQUIRED", "Password is required.", EXIT_CODES.INPUT);
  }

  const client = new CouchClient({
    baseUrl: url,
    timeoutMs: initial.timeoutMs,
    user,
    password
  });
  const response = await client.loginSession(user, password);

  const usedPrompt = !initial.url || !initial.user || !initial.password;
  const rememberCookie =
    options.rememberCookie ??
    (options.promptToRemember && usedPrompt
      ? await context.promptYesNo("Record this url + cookie for later reuse?", false)
      : false);

  if (rememberCookie) {
    context.upsertSession(url, user, response.cookie);
    context.setCurrentTarget({
      url,
      user,
      db: context.resolved.db
    });
    await context.saveStore();
  }

  return {
    url,
    user,
    password,
    sessionCookie: response.cookie,
    rememberCookie
  };
}
