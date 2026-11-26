import { KYC_SLOTS, MAX_KYC_BYTES, type KycFile, type KycKind } from '@/domain/registration';

/**
 * Taking or choosing the KYC picture for one slot. Pictures are shrunk to a sensible size and saved as JPEG
 * before they are kept, so a modern phone's 10 MB photo becomes a few hundred kilobytes and always fits the
 * 5 MB limit. A PDF (ID card, proof of address) is kept as it is.
 */

export type CaptureSource = 'camera' | 'library' | 'file';

export type CaptureResult = { file: KycFile } | { cancelled: true } | { error: string };

/** Longest side of a kept picture. Enough to read an ID card or a signature. */
const MAX_SIDE = 1600;

const nameOf = (uri: string, fallback: string) => decodeURIComponent(uri.split('/').pop() ?? '') || fallback;

async function shrink(uri: string): Promise<{ uri: string; size: number }> {
  const [{ ImageManipulator, SaveFormat }, FileSystem] = await Promise.all([import('expo-image-manipulator'), import('expo-file-system/legacy')]);
  let rendered = await ImageManipulator.manipulate(uri).renderAsync();
  if (Math.max(rendered.width, rendered.height) > MAX_SIDE) {
    const context = ImageManipulator.manipulate(rendered);
    context.resize(rendered.width >= rendered.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    rendered = await context.renderAsync();
  }
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const info = await FileSystem.getInfoAsync(saved.uri);
  return { uri: saved.uri, size: info.exists && 'size' in info ? Number(info.size) : 0 };
}

export async function captureKycFile(kind: KycKind, source: CaptureSource): Promise<CaptureResult> {
  const slot = KYC_SLOTS.find((s) => s.kind === kind);
  if (!slot) return { error: 'Unknown document.' };
  try {
    if (source === 'file') {
      const DocumentPicker = await import('expo-document-picker');
      const picked = await DocumentPicker.getDocumentAsync({
        type: slot.pdf ? ['image/*', 'application/pdf'] : ['image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return { cancelled: true };
      const asset = picked.assets[0];
      const mime = (asset.mimeType ?? '').toLowerCase();
      if (mime === 'application/pdf') {
        if ((asset.size ?? 0) > MAX_KYC_BYTES) return { error: `${slot.label} is larger than 5 MB.` };
        return { file: { kind, uri: asset.uri, name: asset.name || `${kind}.pdf`, mimeType: 'application/pdf', size: asset.size ?? 0 } };
      }
      if (!mime.startsWith('image/')) return { error: `${slot.label} must be ${slot.pdf ? 'a picture or a PDF' : 'a picture'}.` };
      return keepPicture(kind, asset.uri, asset.name);
    }

    const ImagePicker = await import('expo-image-picker');
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return { error: source === 'camera' ? 'Camera access is switched off for this app. Allow it in the phone settings, or choose a picture instead.' : 'Photo access is switched off for this app. Allow it in the phone settings.' };
    }
    const options = { mediaTypes: ['images' as const], quality: 1, allowsEditing: false };
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets?.[0]) return { cancelled: true };
    const asset = picked.assets[0];
    return keepPicture(kind, asset.uri, asset.fileName);
  } catch {
    return { error: 'The picture could not be read. Try again.' };
  }
}

async function keepPicture(kind: KycKind, uri: string, name?: string | null): Promise<CaptureResult> {
  const small = await shrink(uri);
  const base = (name ?? nameOf(uri, kind)).replace(/\.[^.]+$/, '') || kind;
  return { file: { kind, uri: small.uri, name: `${base}.jpg`, mimeType: 'image/jpeg', size: small.size } };
}
