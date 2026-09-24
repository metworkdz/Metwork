/**
 * Fetching the images a certificate is drawn with — the logo, the stamp and
 * the signatures — from URLs a host controls.
 *
 * Certificates use the same narrow door as every other PDF (invoices,
 * receipts, contracts): our own Cloudinary account over https, no redirects,
 * a size cap enforced while reading, a timeout. See src/server/pdf/images.ts.
 *
 * Anything refused comes back as null, which the renderer already treats as
 * "no image": the line stays blank to be signed by hand.
 *
 * Kept as its own module, under certificate names, so the renderer, the
 * settings schema and the render test's mock have one seam to point at.
 */
export {
  MAX_PDF_IMAGE_BYTES as MAX_CERTIFICATE_IMAGE_BYTES,
  isAllowedPdfImageUrl as isAllowedCertificateImageUrl,
  fetchPdfImage as fetchCertificateImage,
} from '@/server/pdf/images';
