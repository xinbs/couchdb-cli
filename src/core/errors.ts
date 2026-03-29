export const EXIT_CODES = {
  OK: 0,
  INPUT: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  CONFLICT: 5,
  NETWORK: 10
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export class CliError extends Error {
  public readonly exitCode: ExitCode;
  public readonly details?: unknown;
  public readonly code: string;

  public constructor(
    code: string,
    message: string,
    exitCode: ExitCode = EXIT_CODES.INPUT,
    details?: unknown
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export function normalizeError(error: unknown): CliError {
  if (isCliError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new CliError("UNEXPECTED_ERROR", error.message, EXIT_CODES.NETWORK, {
      name: error.name
    });
  }

  return new CliError("UNEXPECTED_ERROR", "Unknown error", EXIT_CODES.NETWORK);
}
