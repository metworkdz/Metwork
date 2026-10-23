/**
 * Freelancer turnover (chiffre d'affaires) — client-safe and pure.
 *
 * Turnover is the sum, before tax, of the FACTURES issued in a calendar year.
 * Proformas and devis are offers, not sales; cancelled factures don't count;
 * the droit de timbre is a tax, not turnover.
 *
 * ⚠ The auto-entrepreneur figures below (annual ceiling and IFU rate) come from
 * the plan, not from a text in `tax documents/` — that folder has no copy of
 * Loi 22-23. They are shown as an estimate with that caveat, and must be
 * confirmed by an accountant before the tax center (phase 4) relies on them.
 */
export const AE_ANNUAL_CEILING_DZD = 5_000_000;
export const AE_IFU_RATE = 0.005;
/** Ceiling alerts, as fractions of the ceiling. */
export const CEILING_ALERTS = [0.8, 0.95] as const;

export interface TurnoverInvoice {
  kind?: string | null;
  status: string;
  issuedAt: string;
  totals: { ht: number };
}

export function turnoverForYear(invoices: readonly TurnoverInvoice[], year: number): number {
  return invoices
    .filter((i) => (i.kind ?? 'FACTURE') === 'FACTURE' && i.status !== 'CANCELLED' && new Date(i.issuedAt).getUTCFullYear() === year)
    .reduce((sum, i) => sum + Math.max(0, Math.round(i.totals.ht)), 0);
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
    estimatedIfu: Math.round(turnover * AE_IFU_RATE),
  };
}
