import type { KvRepo } from '@/data/repositories';

/**
 * Member passport photographs, kept on the phone so a profile opened later (or offline) still shows the face.
 * Each is a file in the app's own storage; the key-value store remembers which version of the picture it is.
 */

export interface PhotoPayload {
  version: string;
  mimeType: string;
  dataBase64: string;
}

/** What the server says when asked for a member's photo. */
export type PhotoAnswer = PhotoPayload | 'UNCHANGED' | null;

/** The phone's file operations, so the logic can be tested without a phone. */
export interface PhotoDisk {
  makeDirectory(path: string): Promise<void>;
  writeBase64(path: string, base64: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface CachedPhoto {
  uri: string;
  version: string;
}

const key = (code: string) => `photo.${code}`;
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

export function createPhotoDisk(): PhotoDisk {
  const legacy = () => import('expo-file-system/legacy');
  return {
    makeDirectory: async (path) => {
      const FS = await legacy();
      await FS.makeDirectoryAsync(path, { intermediates: true });
    },
    writeBase64: async (path, base64) => {
      const FS = await legacy();
      await FS.writeAsStringAsync(path, base64, { encoding: FS.EncodingType.Base64 });
    },
    exists: async (path) => {
      const FS = await legacy();
      return (await FS.getInfoAsync(path)).exists;
    },
  };
}

/** The folder photos live in, e.g. file:///data/.../photos/. */
export async function photoDirectory(): Promise<string> {
  const FS = await import('expo-file-system/legacy');
  return `${FS.documentDirectory}photos/`;
}

/** The saved photo for a member, if there is one and its file is still there. */
export async function readCachedPhoto(kv: KvRepo, disk: PhotoDisk, code: string): Promise<CachedPhoto | null> {
  const text = await kv.get(key(code));
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as Partial<CachedPhoto>;
    if (typeof saved.uri !== 'string' || typeof saved.version !== 'string') return null;
    return (await disk.exists(saved.uri)) ? { uri: saved.uri, version: saved.version } : null;
  } catch {
    return null;
  }
}

/** Keeps a downloaded photo. Replaces the old file for the member. */
export async function savePhoto(kv: KvRepo, disk: PhotoDisk, directory: string, code: string, photo: PhotoPayload): Promise<CachedPhoto> {
  const extension = EXTENSION[photo.mimeType.toLowerCase()] ?? 'jpg';
  // The version is in the name, so a changed picture never shows from an image cache by the old name.
  const uri = `${directory}${code}-${photo.version}.${extension}`;
  await disk.makeDirectory(directory);
  await disk.writeBase64(uri, photo.dataBase64);
  await kv.set(key(code), JSON.stringify({ uri, version: photo.version }));
  return { uri, version: photo.version };
}

/**
 * Asks the server for the member's photo (telling it which version is already here) and keeps it.
 * Returns the new photo, or null when nothing changed, there is none, or there was no connection.
 */
export async function refreshPhoto(
  kv: KvRepo,
  disk: PhotoDisk,
  directory: string,
  code: string,
  have: string | null,
  ask: (code: string, have: string | null) => Promise<PhotoAnswer>,
): Promise<CachedPhoto | null> {
  let answer: PhotoAnswer;
  try {
    answer = await ask(code, have);
  } catch {
    return null;
  }
  if (!answer || answer === 'UNCHANGED') return null;
  try {
    return await savePhoto(kv, disk, directory, code, answer);
  } catch {
    return null;
  }
}
