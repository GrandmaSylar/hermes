import type { FileStore } from '@/data/files';

/** A phone's file storage held in memory, for tests. `contents` maps each kept address to its base64 text. */
export function createFakeFiles(initial: Record<string, string> = {}) {
  const contents = new Map<string, string>(Object.entries(initial));
  const removed: string[] = [];
  const store: FileStore = {
    async keep(sourceUri, id, kind, extension) {
      const uri = `kept://${id}/${kind}.${extension}`;
      contents.set(uri, contents.get(sourceUri) ?? `bytes-of-${kind}`);
      return uri;
    },
    async readBase64(uri) {
      const text = contents.get(uri);
      if (text === undefined) throw new Error('missing');
      return text;
    },
    async remove(uri) {
      removed.push(uri);
      contents.delete(uri);
    },
  };
  return { store, contents, removed };
}
