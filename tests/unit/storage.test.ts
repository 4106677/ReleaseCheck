import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '@releasecheck/storage';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
describe('artifact storage', () => {
  it('rejects traversal and non-PNG content', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'releasecheck-storage-'));
    folders.push(folder);
    const storage = new LocalStorage(folder);
    expect(() => storage.read('../secret')).toThrow('Invalid artifact key');
    await expect(storage.putPng(Buffer.from('not png'))).rejects.toThrow('not a PNG');
    expect(await readdir(folder)).toEqual([]);
  });
  it('publishes complete PNG bytes and removes temporary files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'releasecheck-storage-'));
    folders.push(folder);
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=',
      'base64',
    );
    const storage = new LocalStorage(folder);
    const artifact = await storage.putPng(bytes);
    expect(await storage.read(artifact.key)).toEqual(bytes);
    expect(await readdir(folder)).toEqual([artifact.key]);
    expect(artifact.checksum).toHaveLength(64);
    await storage.remove(artifact.key);
    expect(await readdir(folder)).toEqual([]);
  });
});
