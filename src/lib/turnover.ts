/**
 * Freelancer turnover (chiffre d'affaires) — client-safe and pure.
 *
 * Turnover is the sum, before tax, of the FACTURES issued in a calendar year.
 * Proformas and devis are offers, not sales; cancelled factures don't count;
 * the droit de timbre is a tax, not turnover.
 *
 * The auto-entrepreneur figures come from the tax calendar's sourced table
 * (`TAX_FIGURES`): ceiling LF 2023 art. 51, rate CIDTA 2026 art. 282 sexies,
 * minimum from the GN°12 bis notice.
 */
import { TAX_FIGURES } from '@/lib/tax-calendar';

export const AE_ANNUAL_CEILING_DZD = TAX_FIGURES.aeCeiling;
export const AE_IFU_RATE = TAX_FIGURES.aeIfuRate;
/** Ceiling alerts, as fractions of the ceiling. */
export const CEILING_ALERTS = [0.8, 0.95] as const;

export interface TurnoverInvoice {
  kind?: string | null;
  status: string;
  issuedAt: string;
  totals: { ht: number; tva?: number };
}

const isSale = (i: TurnoverInvoice) => (i.kind ?? 'FACTURE') === 'FACTURE' && i.status !== 'CANCELLED';

export function turnoverForYear(invoices: readonly TurnoverInvoice[], year: number): number {
  return invoices
    .filter((i) => isSale(i) && new Date(i.issuedAt).getUTCFullYear() === year)
    .reduce((sum, i) => sum + Math.max(0, Math.round(i.totals.ht)), 0);
}

/** Sales of one month ("YYYY-MM"): turnover before tax and the VAT invoiced — the G50 figures. */
export function salesForMonth(invoices: readonly TurnoverInvoice[], month: string): { ht: number; tva: number } {
  return invoices
    .filter((i) => isSale(i) && new Date(i.issuedAt).toISOString().slice(0, 7) === month)
    .reduce(
      (acc, i) => ({ ht: acc.ht + Math.max(0, Math.round(i.totals.ht)), tva: acc.tva + Math.max(0, Math.round(i.totals.tva ?? 0)) }),
      { ht: 0, tva: 0 },
    );
}

export interface CeilingView {
  turnover: number;
  ceiling: number;
  /** 0–1, capped at 1. */
  share: number;
  /** The highest alert threshold crossed, or null. */
  alert: (typeof CEILING_ALERTS)[number] | null;
  estimatedIfu: number;
}

export function aeCeilingView(turnover: number): CeilingView {
  const share = Math.min(1, turnover / AE_ANNUAL_CEILING_DZD);
  const crossed = CEILING_ALERTS.filter((a) => share >= a);
  return {
    turnover,
    ceiling: AE_ANNUAL_CEILING_DZD,
    share,
    alert: crossed.length ? crossed[crossed.length - 1]! : null,
    // The IFU can't be lower than the auto-entrepreneur minimum.
    estimatedIfu: Math.max(Math.round(turnover * AE_IFU_RATE), TAX_FIGURES.aeMinimumIfu),
  };
}
