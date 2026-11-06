/**
 * The certificate as an image, for LinkedIn — the SAME page the participant
 * received, drawn by the same renderer, then rasterised.
 *
 * Public by nature, so it carries the QR code and the printed signatory names
 * but neither the handwritten signature images nor the stamp: a real signature
 * on a public image is a signature anyone can copy. (Owner's decision,
 * 2026-11-01.)
 *
 * Rasterising: pdfjs reads the one-page PDF and paints it on a native canvas
 * (@napi-rs/canvas, prebuilt for Vercel's Linux). The worker is imported here
 * explicitly — pdfjs would otherwise load it by a path the bundler cannot
 * see, and the lambda would ship without it.
 */
import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { renderCertificatesPdf, type CertificateImages } from '../render';
import { fetchCertificateImage } from '../images';
import type { CertificateSetup } from '../service';
import type { CertificateRecipient } from '../types';

/** Wide enough for the QR code to scan off a phone screen. */
const IMAGE_WIDTH_PX = 2000;

type PdfjsModule = typeof Pdfjs;
let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    // @ts-expect-error -- pdfjs ships no types for the worker entry
    const worker: unknown = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    // pdfjs runs its "worker" on the main thread when this global is set.
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return pdfjsPromise;
}

export async function rasterizeFirstPage(pdf: Buffer, widthPx = IMAGE_WIDTH_PX): Promise<Buffer> {
  const pdfjs = await loadPdfjs();
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // Our PDFs embed every font they use; no system fonts.
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const scale = widthPx / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    // A white ground: a transparent PNG shows black in some LinkedIn viewers.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as never, viewport, canvas: canvas as never }).promise;
    return await canvas.encode('png');
  } finally {
    await task.destroy();
  }
}

/** The participant's certificate, LinkedIn edition, as a PNG. */
export async function renderCertificateShareImage(
  setup: CertificateSetup,
  recipient: CertificateRecipient,
): Promise<Buffer> {
  const images: CertificateImages = {
    logo: (await fetchCertificateImage(setup.logoUrl)) ?? null,
    stamp: null,
    signatures: setup.settings.signatories.slice(0, 2).map(() => null),
  };
  const pdf = await renderCertificatesPdf({
    settings: { ...setup.settings, showStamp: false, showVerification: true },
    context: setup.context,
    recipients: [recipient],
    mode: 'DIGITAL',
    images,
  });
  return rasterizeFirstPage(pdf);
}
