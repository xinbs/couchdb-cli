import path from "node:path";

export function normalizeRemotePath(input?: string): string {
  const raw = (input ?? "/").trim();
  if (!raw || raw === ".") {
    return "/";
  }

  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withRoot.length > 1 && withRoot.endsWith("/") ? withRoot.slice(0, -1) : withRoot;
}

export function parentRemotePath(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") {
    return "/";
  }

  const parent = path.posix.dirname(normalized);
  return normalizeRemotePath(parent);
}

export function joinRemotePath(...segments: string[]): string {
  return normalizeRemotePath(path.posix.join(...segments));
}

export function remotePathName(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath);
  return normalized === "/" ? "/" : path.posix.basename(normalized);
}

export function ancestorPaths(remotePath: string): string[] {
  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") {
    return ["/"];
  }

  const parts = normalized.split("/").filter(Boolean);
  const ancestors = ["/"];
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    ancestors.push(current);
  }
  return ancestors;
}
