export interface FsBaseDoc {
  _id: string;
  _rev?: string;
  type: "file" | "dir";
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface FsDirDoc extends FsBaseDoc {
  type: "dir";
}

export interface FsFileDoc extends FsBaseDoc {
  type: "file";
  size: number;
  mime: string;
  sha256: string;
}

export type FsDoc = FsDirDoc | FsFileDoc;

export interface FsListEntry {
  path: string;
  name: string;
  type: "file" | "dir";
  size?: number;
  mime?: string;
  sha256?: string;
  updatedAt: string;
}
