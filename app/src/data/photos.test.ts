import { readCachedPhoto, refreshPhoto, savePhoto, type PhotoAnswer, type PhotoDisk } from './photos';

function fakes() {
  const store = new Map<string, string>();
  const kv = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) };
  const files = new Map<string, string>();
  const disk: PhotoDisk = {
    makeDirectory: async () => undefined,
    writeBase64: async (path, base64) => void files.set(path, base64),
    exists: async (path) => files.has(path),
  };
  return { kv, disk, files };
}
const DIR = 'file:///photos/';
const photo = (version: string) => ({ version, mimeType: 'image/jpeg', dataBase64: `data-${version}` });

describe('member photos on the phone', () => {
  test('a downloaded photo is kept and found again', async () => {
    const { kv, disk, files } = fakes();
    expect(await readCachedPhoto(kv, disk, '1000004764')).toBeNull();
    const saved = await savePhoto(kv, disk, DIR, '1000004764', photo('a1'));
    expect(saved.uri).toBe('file:///photos/1000004764-a1.jpg');
    expect(files.get(saved.uri)).toBe('data-a1');
    expect(await readCachedPhoto(kv, disk, '1000004764')).toEqual({ uri: saved.uri, version: 'a1' });
  });

  test('a photo whose file has gone is treated as not there', async () => {
    const { kv, disk, files } = fakes();
    const saved = await savePhoto(kv, disk, DIR, '1', photo('a1'));
    files.delete(saved.uri);
    expect(await readCachedPhoto(kv, disk, '1')).toBeNull();
  });

  test('asking again names the version it has, and an unchanged answer keeps what is there', async () => {
    const { kv, disk } = fakes();
    const asked: (string | null)[] = [];
    const ask = async (_code: string, have: string | null): Promise<PhotoAnswer> => {
      asked.push(have);
      return have === 'a1' ? 'UNCHANGED' : photo('a1');
    };
    const first = await refreshPhoto(kv, disk, DIR, '1', null, ask);
    expect(first?.version).toBe('a1');
    expect(await refreshPhoto(kv, disk, DIR, '1', 'a1', ask)).toBeNull();
    expect(asked).toEqual([null, 'a1']);
  });

  test('a changed picture is saved under a new name', async () => {
    const { kv, disk } = fakes();
    await savePhoto(kv, disk, DIR, '1', photo('a1'));
    const next = await refreshPhoto(kv, disk, DIR, '1', 'a1', async () => photo('b2'));
    expect(next?.uri).toBe('file:///photos/1-b2.jpg');
    expect((await readCachedPhoto(kv, disk, '1'))?.version).toBe('b2');
  });

  test('no photo, no connection or a full disk leaves things as they are and never throws', async () => {
    const { kv, disk } = fakes();
    expect(await refreshPhoto(kv, disk, DIR, '1', null, async () => null)).toBeNull();
    expect(await refreshPhoto(kv, disk, DIR, '1', null, async () => Promise.reject(new Error('offline')))).toBeNull();
    const full: PhotoDisk = { ...disk, writeBase64: async () => Promise.reject(new Error('disk full')) };
    expect(await refreshPhoto(kv, full, DIR, '1', null, async () => photo('a1'))).toBeNull();
    expect(await readCachedPhoto(kv, disk, '1')).toBeNull();
  });
});
