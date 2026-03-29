import { writeFile } from "node:fs/promises";

import type { Command } from "commander";

import { CliError, EXIT_CODES } from "../core/errors.js";

export function requireStringOption(
  options: Record<string, unknown>,
  name: string,
  message: string
): string {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(name.toUpperCase(), message, EXIT_CODES.INPUT);
  }
  return value;
}

export function formatNameList(values: string[]): string {
  return values.length === 0 ? "(empty)" : values.join("\n");
}

export function formatKeyValueObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`)
    .join("\n");
}

export function formatTable(
  rows: Array<Record<string, string | number | undefined>>,
  columns: string[]
): string {
  if (rows.length === 0) {
    return "(empty)";
  }

  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))
  );

  return [
    columns.map((column, index) => column.padEnd(widths[index])).join("  "),
    columns.map((_, index) => "-".repeat(widths[index])).join("  "),
    ...rows.map((row) =>
      columns.map((column, index) => String(row[column] ?? "").padEnd(widths[index])).join("  ")
    )
  ].join("\n");
}

export function getCommandOrParent(command: Command): Command {
  return command.parent ?? command;
}

export async function writeOutputFile(filePath: string, content: Buffer): Promise<void> {
  await writeFile(filePath, content);
}
