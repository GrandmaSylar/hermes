import type { KycKind } from '@/domain/registration';

/**
 * Where KYC pictures live on the phone between choosing them and sending them. They are copied into
 * the app's own storage (not the camera roll or cache, which can be cleared) and deleted once the
 * office has them. A fake stands in for this in tests.
 */
export interface FileStore {
  /** Copies a picked file into the app's storage for this registration. Returns its new address. */
  keep(sourceUri: string, localRegistrationId: string, kind: KycKind, extension: string): Promise<string>;
  /** The file's bytes as base64 text, ready to send. */
  readBase64(uri: string): Promise<string>;
  /** Deletes a file. Quietly does nothing when it is already gone. */
  remove(uri: string): Promise<void>;
}

const FOLDER = 'kyc';

export function createFileStore(): FileStore {
  // Loaded when first used, so a missing native module cannot stop the app starting.
  const fs = () => import('expo-file-system/legacy');
  return {
    async keep(sourceUri, localRegistrationId, kind, extension) {
      const FileSystem = await fs();
      const dir = `${FileSystem.documentDirectory}${FOLDER}/${localRegistrationId}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const target = `${dir}${kind}.${extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'}`;
      await FileSystem.copyAsync({ from: sourceUri, to: target });
      return target;
    },
    async readBase64(uri) {
      const FileSystem = await fs();
      return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    },
    async remove(uri) {
      const FileSystem = await fs();
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },
  };
}
