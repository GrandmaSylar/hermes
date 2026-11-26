import { z } from 'zod';

/**
 * KYC files for a member registered from the field. Same files the core app asks for on its
 * "KYC Documents" step, with the same limits: 5 MB each, pictures for the photo, signature and
 * thumbprint, and a picture or PDF for the ID card and proof of address.
 */

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export type DocumentKind = 'passportPhoto' | 'idFront' | 'idBack' | 'proofOfAddress' | 'signature' | 'thumbprint';

export const DOCUMENT_KINDS: DocumentKind[] = ['passportPhoto', 'idFront', 'idBack', 'proofOfAddress', 'signature', 'thumbprint'];

const IMAGES = ['image/jpeg', 'image/png', 'image/gif'];
const IMAGES_OR_PDF = [...IMAGES, 'application/pdf'];

export const ALLOWED_TYPES: Record<DocumentKind, string[]> = {
  passportPhoto: IMAGES,
  idFront: IMAGES_OR_PDF,
  idBack: IMAGES_OR_PDF,
  proofOfAddress: IMAGES_OR_PDF,
  signature: IMAGES,
  thumbprint: IMAGES,
};

export const KIND_LABEL: Record<DocumentKind, string> = {
  passportPhoto: 'Passport photo',
  idFront: 'ID card (front)',
  idBack: 'ID card (back)',
  proofOfAddress: 'Proof of address',
  signature: 'Signature',
  thumbprint: 'Thumbprint',
};

/** What the file really is, from its first bytes. The name and the declared type are not trusted. */
export function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Longest the base64 text of a file can be. */
export const MAX_DOCUMENT_BASE64 = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 8;

export const documentBody = z.object({
  kind: z.enum(['passportPhoto', 'idFront', 'idBack', 'proofOfAddress', 'signature', 'thumbprint']),
  fileName: z.string().trim().max(255).optional().default(''),
  dataBase64: z.string().min(8).max(MAX_DOCUMENT_BASE64, 'That file is larger than 5 MB.'),
});

export type DocumentBody = z.infer<typeof documentBody>;

export interface CheckedDocument {
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

/** Decodes and checks one file. Returns the problem as text when it is not acceptable. */
export function checkDocument(body: DocumentBody): CheckedDocument | { problem: string } {
  const label = KIND_LABEL[body.kind];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.dataBase64)) return { problem: `${label}: the file could not be read.` };
  const bytes = Buffer.from(body.dataBase64, 'base64');
  if (bytes.length === 0) return { problem: `${label}: the file is empty.` };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { problem: `${label} is larger than 5 MB.` };
  const mimeType = sniffMime(bytes);
  if (!mimeType || !ALLOWED_TYPES[body.kind].includes(mimeType)) {
    const allowed = body.kind === 'idFront' || body.kind === 'idBack' || body.kind === 'proofOfAddress' ? 'a JPG, PNG, GIF or PDF' : 'a JPG, PNG or GIF picture';
    return { problem: `${label} must be ${allowed}.` };
  }
  // Never keep a path a phone sent; only a plain file name.
  const fileName = body.fileName.replace(/^.*[\\/]/, '').replace(/[^\w .()-]/g, '_').slice(0, 200);
  return { kind: body.kind, fileName, mimeType, bytes };
}

/** The most a stored logo may be before it is left out: it is sent to every phone. */
export const MAX_LOGO_CHARS = 1_500_000;

/** A stored logo, if it is a picture data URL of a sensible size. Anything else is treated as no logo. */
export function logoFrom(value: unknown): { version: string; dataUri: string } | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_LOGO_CHARS) return null;
  if (!/^data:image\/(png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=\s]+$/.test(text)) return null;
  // A cheap fingerprint is enough: it only has to change when the picture does.
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return { version: `${text.length.toString(16)}-${(hash >>> 0).toString(16)}`, dataUri: text };
}

/** Biggest member photograph that is sent to a phone. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** A stored passport photograph, if it really is a picture of a sensible size. The type comes from the bytes, not from any label. */
export function photoFrom(value: unknown): { version: string; mimeType: string; dataBase64: string } | null {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > MAX_PHOTO_BYTES) return null;
  const mimeType = sniffMime(value);
  if (!mimeType || !mimeType.startsWith('image/')) return null;
  // Length plus a sample of the bytes: it only has to change when the picture does.
  let hash = 5381;
  const step = Math.max(1, Math.floor(value.length / 4096));
  for (let i = 0; i < value.length; i += step) hash = ((hash << 5) + hash + value[i]) | 0;
  return { version: `${value.length.toString(16)}-${(hash >>> 0).toString(16)}`, mimeType, dataBase64: value.toString('base64') };
}
