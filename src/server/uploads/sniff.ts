/**
 * File type from magic bytes — so a renamed file can't pass as an image or a
 * PDF. Shared by every private-document upload (business documents, tax
 * receipts).
 */
export function sniffDocumentMime(buf: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Under Vercel's 4.5 MB request cap, with room for the multipart envelope. */
export const MAX_PRIVATE_DOCUMENT_BYTES = 4 * 1024 * 1024;
