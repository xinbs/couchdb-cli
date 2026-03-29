import { Buffer } from "node:buffer";

import { fetch, type BodyInit, type Response } from "undici";

import { CliError, EXIT_CODES } from "../errors.js";

export interface CouchClientOptions {
  baseUrl: string;
  timeoutMs: number;
  user?: string;
  password?: string;
  sessionCookie?: string;
  db?: string;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: BodyInit | Buffer | URLSearchParams;
  json?: unknown;
  headers?: Record<string, string>;
  responseType?: "json" | "text" | "buffer" | "void";
}

interface CouchErrorBody {
  error?: string;
  reason?: string;
}

export class CouchClient {
  public readonly db?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly user?: string;
  private readonly password?: string;
  private readonly sessionCookie?: string;

  public constructor(options: CouchClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.timeoutMs = options.timeoutMs;
    this.user = options.user;
    this.password = options.password;
    this.sessionCookie = options.sessionCookie;
    this.db = options.db;
  }

  public async getSession(): Promise<unknown> {
    return this.request("GET", "/_session");
  }

  public async loginSession(user: string, password: string): Promise<{ cookie: string; body: unknown }> {
    const response = await this.rawRequest("POST", "/_session", {
      body: new URLSearchParams({ name: user, password }),
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      }
    });

    const cookie = response.headers.get("set-cookie");
    if (!cookie) {
      throw new CliError(
        "SESSION_COOKIE_MISSING",
        "CouchDB login succeeded but no session cookie was returned.",
        EXIT_CODES.AUTH
      );
    }

    return {
      cookie: cookie.split(";")[0],
      body: await response.json()
    };
  }

  public async listDbs(): Promise<string[]> {
    return this.request("GET", "/_all_dbs");
  }

  public async createDb(name: string): Promise<unknown> {
    return this.request("PUT", `/${encodeSegment(name)}`);
  }

  public async deleteDb(name: string): Promise<unknown> {
    return this.request("DELETE", `/${encodeSegment(name)}`);
  }

  public async dbInfo(name = this.requireDb()): Promise<unknown> {
    return this.request("GET", `/${encodeSegment(name)}`);
  }

  public async allDocs(
    db = this.requireDb(),
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<{ rows: Array<{ id: string; key: string; value: unknown; doc?: unknown }> }> {
    return this.request("GET", `/${encodeSegment(db)}/_all_docs`, { query });
  }

  public async getDoc<T = Record<string, unknown>>(
    db = this.requireDb(),
    id: string
  ): Promise<T> {
    return this.request("GET", `/${encodeSegment(db)}/${encodeSegment(id)}`);
  }

  public async putDoc(
    db = this.requireDb(),
    id: string,
    doc: Record<string, unknown>
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request("PUT", `/${encodeSegment(db)}/${encodeSegment(id)}`, {
      json: doc
    });
  }

  public async deleteDoc(
    db = this.requireDb(),
    id: string,
    rev: string
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request("DELETE", `/${encodeSegment(db)}/${encodeSegment(id)}`, {
      query: { rev }
    });
  }

  public async bulkDocs(
    db = this.requireDb(),
    docs: object[]
  ): Promise<Array<{ ok?: boolean; id: string; rev?: string; error?: string; reason?: string }>> {
    return this.request("POST", `/${encodeSegment(db)}/_bulk_docs`, {
      json: { docs }
    });
  }

  public async getAttachment(
    db = this.requireDb(),
    docId: string,
    name: string
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    const response = await this.rawRequest(
      "GET",
      `/${encodeSegment(db)}/${encodeSegment(docId)}/${encodeSegment(name)}`
    );
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? undefined
    };
  }

  public async putAttachment(
    db = this.requireDb(),
    docId: string,
    name: string,
    body: Buffer,
    rev: string,
    contentType = "application/octet-stream"
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request("PUT", `/${encodeSegment(db)}/${encodeSegment(docId)}/${encodeSegment(name)}`, {
      body,
      query: { rev },
      headers: {
        "content-type": contentType
      }
    });
  }

  public async deleteAttachment(
    db = this.requireDb(),
    docId: string,
    name: string,
    rev: string
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request("DELETE", `/${encodeSegment(db)}/${encodeSegment(docId)}/${encodeSegment(name)}`, {
      query: { rev }
    });
  }

  public async getLocalDoc<T = Record<string, unknown>>(
    db = this.requireDb(),
    id: string
  ): Promise<T> {
    return this.request("GET", `/${encodeSegment(db)}/_local/${encodeSegment(id)}`);
  }

  public async putLocalDoc(
    db = this.requireDb(),
    id: string,
    doc: Record<string, unknown>
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request("PUT", `/${encodeSegment(db)}/_local/${encodeSegment(id)}`, {
      json: doc
    });
  }

  private requireDb(): string {
    if (!this.db) {
      throw new CliError("DB_REQUIRED", "This command requires a database.", EXIT_CODES.INPUT);
    }

    return this.db;
  }

  private async request<T>(
    method: string,
    pathname: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const response = await this.rawRequest(method, pathname, options);

    if (options.responseType === "void" || response.status === 204) {
      return undefined as T;
    }

    if (options.responseType === "text") {
      return (await response.text()) as T;
    }

    if (options.responseType === "buffer") {
      return Buffer.from(await response.arrayBuffer()) as T;
    }

    return response.json() as Promise<T>;
  }

  private async rawRequest(method: string, pathname: string, options: RequestOptions = {}) {
    const url = new URL(trimLeadingSlash(pathname), this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      ...(options.headers ?? {})
    };

    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["content-type"] = "application/json";
    }

    if (this.user && this.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    } else if (this.sessionCookie) {
      headers.cookie = this.sessionCookie;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: body as BodyInit | undefined,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new CliError("NETWORK_ERROR", "Failed to reach CouchDB.", EXIT_CODES.NETWORK, {
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    if (!response.ok) {
      throw await this.toCliError(response);
    }

    return response;
  }

  private async toCliError(response: Response): Promise<CliError> {
    const details = await readErrorBody(response);

    if (response.status === 401 || response.status === 403) {
      return new CliError(
        "AUTH_FAILED",
        details.reason ?? "Authentication failed.",
        EXIT_CODES.AUTH,
        details
      );
    }

    if (response.status === 404) {
      return new CliError(
        "NOT_FOUND",
        details.reason ?? "Requested resource was not found.",
        EXIT_CODES.NOT_FOUND,
        details
      );
    }

    if (response.status === 409) {
      return new CliError(
        "CONFLICT",
        details.reason ?? "Conflict while writing to CouchDB.",
        EXIT_CODES.CONFLICT,
        details
      );
    }

    return new CliError(
      "HTTP_ERROR",
      details.reason ?? `CouchDB request failed with status ${response.status}.`,
      EXIT_CODES.NETWORK,
      details
    );
  }
}

async function readErrorBody(response: Response): Promise<CouchErrorBody> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as CouchErrorBody;
  }

  return {
    reason: await response.text()
  };
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
