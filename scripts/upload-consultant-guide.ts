/**
 * Publish the consultant starter guide (PDF) that the welcome email attaches.
 *
 * The guide is NOT bundled with the code — at ~4.3 MB it would ride along in
 * every lambda, and keeping it remote means marketing can replace it without a
 * deploy. Re-run this over the same public_id and the next welcome email
 * carries the new file; nothing else changes.
 *
 *   npx tsx scripts/upload-consultant-guide.ts <path-to.pdf>
 *
 * Uploaded as an AUTHENTICATED raw asset, like the signed contracts: the
 * account has "Allow delivery of PDF and ZIP files" off, so a public `.pdf`
 * URL answers 401. The sender fetches it server-side with a signed link.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isConfigured, uploadAuthenticatedRaw, signedRawDownloadUrl } from '@/lib/cloudinary';
import { CONSULTANT_GUIDE_PUBLIC_ID } from '@/server/notifications/consultant-guide';

const file = process.argv[2];

async function main(): Promise<void> {
  if (!file) {
    console.error('Usage: npx tsx scripts/upload-consultant-guide.ts <path-to.pdf>');
    process.exit(1);
  }
  if (!isConfigured()) {
    console.error('✘ Cloudinary is not configured (CLOUDINARY_* env vars).');
    process.exit(1);
  }

  const abs = path.resolve(file);
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    console.error(`✘ ${abs} is not a PDF.`);
    process.exit(1);
  }

  console.log(`Uploading ${path.basename(abs)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)…`);
  const up = await uploadAuthenticatedRaw(buf, { publicId: CONSULTANT_GUIDE_PUBLIC_ID });
  console.log('✔ public_id :', up.publicId);
  console.log('  bytes     :', up.bytes);

  // Read it straight back: an upload that "succeeded" but cannot be fetched
  // would silently ship welcome emails with no attachment.
  const res = await fetch(signedRawDownloadUrl(CONSULTANT_GUIDE_PUBLIC_ID));
  const back = Buffer.from(await res.arrayBuffer());
  const ok = res.ok && back.subarray(0, 5).toString('latin1') === '%PDF-';
  console.log(ok ? `✔ Verified: fetched ${back.length} bytes back as a PDF.` : '✘ Fetched it back and it is NOT a PDF.');
  if (!ok) process.exit(1);
}

void main();
