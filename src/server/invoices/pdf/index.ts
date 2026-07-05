/**
 * Invoice PDF entry point — template registry keyed by invoice.template.
 *
 * renderInvoicePdf(invoice) → A4 PDF Buffer. Reuses the receipt pipeline's
 * document lifecycle (pdfkit + embedded fonts, Vercel-serverless safe) and
 * renders ONLY the stored record via the view model — nothing is recomputed.
 */
import type { InvoiceRecord, InvoiceTemplate } from '@/server/db/store';
import { collectBuffer, fetchImageBuffer, makeDoc } from '@/server/notifications/receipt';
import { buildInvoiceViewModel } from './viewModel';
import { renderClassic } from './templates/classic';
import { renderGreenBand } from './templates/greenBand';
import { renderMinimal } from './templates/minimal';
import type { TemplateRenderer } from './templates/shared';

const TEMPLATES: Record<InvoiceTemplate, TemplateRenderer> = {
  CLASSIC: renderClassic,
  GREEN_BAND: renderGreenBand,
  MINIMAL: renderMinimal,
};

export async function renderInvoicePdf(invoice: InvoiceRecord): Promise<Buffer> {
  const vm = buildInvoiceViewModel(invoice);
  const logo = await fetchImageBuffer(vm.logoUrl);

  const doc = makeDoc();
  const render = TEMPLATES[invoice.template] ?? renderClassic;
  render(doc, vm, logo);
  return collectBuffer(doc);
}
