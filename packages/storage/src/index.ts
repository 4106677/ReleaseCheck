import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class LocalStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    if (!/^[a-f0-9-]{36}\.png$/.test(key)) throw new Error('Invalid artifact key');
    return join(this.root, key);
  }

  async putPng(bytes: Buffer) {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('Artifact is not a PNG');
    }
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Artifact exceeds size limit');
    await mkdir(this.root, { recursive: true });
    const id = randomUUID();
    const key = `${id}.png`;
    const temporary = `${this.path(key)}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path(key));
    } finally {
      await rm(temporary, { force: true });
    }
    return {
      id,
      key,
      bytes: bytes.length,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  read(key: string) {
    return readFile(this.path(key));
  }
  remove(key: string) {
    return rm(this.path(key), { force: true });
  }
}
