import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type PutObjectInput = {
  key: string;
  data: Buffer | Readable;
  mimeType?: string;
};

export type StoredObject = {
  key: string;
  size: number;
  sha256: string;
  mimeType: string;
};

export type StoredObjectInfo = StoredObject & {
  updatedAt: Date;
};

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  open(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  move(sourceKey: string, targetKey: string): Promise<void>;
  stat(key: string): Promise<StoredObjectInfo>;
  list(prefix: string): Promise<StoredObjectInfo[]>;
}
