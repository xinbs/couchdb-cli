import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";

import { CliError, EXIT_CODES } from "./errors.js";

export async function readJsonSource(options: {
  file?: string;
  data?: string;
}): Promise<unknown> {
  if (options.file) {
    return JSON.parse(await readFile(options.file, "utf8"));
  }

  if (options.data) {
    return JSON.parse(options.data);
  }

  if (!stdin.isTTY) {
    const chunks: string[] = [];
    stdin.setEncoding("utf8");
    for await (const chunk of stdin) {
      chunks.push(chunk);
    }
    return JSON.parse(chunks.join(""));
  }

  throw new CliError(
    "MISSING_JSON_INPUT",
    "Provide --file, --data, or pipe JSON into stdin.",
    EXIT_CODES.INPUT
  );
}

export function deepMerge<T>(target: T, source: unknown): T {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source as T;
  }

  const output = { ...target } as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    const currentValue = output[key];
    output[key] =
      isPlainObject(currentValue) && isPlainObject(value)
        ? deepMerge(currentValue, value)
        : value;
  }

  return output as T;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureObject(value: unknown, message: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new CliError("INVALID_JSON_SHAPE", message, EXIT_CODES.INPUT);
  }

  return value;
}

export function toIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}
