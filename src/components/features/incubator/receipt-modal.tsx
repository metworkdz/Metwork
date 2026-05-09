'use client';

import { useEffect, useState } from 'react';
import { Printer, X, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface VendorInfo {
  name: string;
  logoUrl: string | null;
  address: string | null;
  commercialRegNumber: string | null;
  nif: string | null;
}

interface ReceiptData {
  bookingId: string;
  issuedAt: string;
  source: 'online' | 'offline';
  paymentMethod: 'wallet' | 'manual';
  vendor: VendorInfo | null;
  customer: { name: string; email: string; phone: string; city: string; idNumber: string | null };
  item: {
    kind: string; name: string; vendor: string; city: string;
    unit: string; quantity: number; startsAt: string; endsAt: string;
  };
  payment: {
    amount: number; currency: string; status: string; method: string;
    transactionRef: string; paidAt: string;
  };
}

type Lang = 'en' | 'fr';

const L = {
  en: {
    title: 'Booking Receipt',
    ref: 'Receipt',
    issued: 'Issued',
    vendor: 'Vendor',
    rc: 'RC',
    nif: 'NIF',
    customer: 'Customer',
    idNumber: 'ID / Passport',
    spaceBooking: 'Space booking',
    programEnrollment: 'Program enrollment',
    payment: 'Payment',
    method: 'Method',
    wallet: 'Platform wallet',
    manual: 'Manual payment',
    ref2: 'Ref',
    status: 'Status',
    footer: 'Thank you for using Metwork · metwork.dz',
  },
  fr: {
    title: 'Reçu de Réservation',
    ref: 'Reçu',
    issued: 'Émis le',
    vendor: 'Prestataire',
    rc: 'RC',
    nif: 'NIF',
    customer: 'Client',
    idNumber: 'N° pièce d\'identité',
    spaceBooking: 'Réservation d\'espace',
    programEnrollment: 'Inscription au programme',
    payment: 'Paiement',
    method: 'Mode de paiement',
    wallet: 'Portefeuille Metwork',
    manual: 'Paiement manuel',
    ref2: 'Réf',
    status: 'Statut',
    footer: 'Merci d\'utiliser Metwork · metwork.dz',
  },
};

interface Props {
  bookingId: string;
  onClose: () => void;
}

export function ReceiptModal({ bookingId, onClose }: Props) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('en');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/incubator/receipts/${bookingId}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load receipt');
        const data = await res.json() as { receipt: ReceiptData };
        setReceipt(data.receipt);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Error'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  const t = L[lang];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg print:shadow-none print:border-none" id="receipt-print-area">
        <DialogHeader className="print:hidden">
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="py-8 text-center text-sm text-destructive">{error}</p>}

        {receipt && (
          <div className="space-y-5 text-sm">
            {/* ── Vendor / incubator header ── */}
            <div className="flex items-start justify-between border-b border-border pb-4">
              <div className="flex items-start gap-3">
                {receipt.vendor?.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={receipt.vendor.logoUrl}
                    alt={receipt.vendor.name}
                    className="h-10 w-10 rounded object-contain border border-border flex-shrink-0"
                  />
                )}
                <div>
                  <p className="text-lg font-bold tracking-tight">
                    {receipt.vendor?.name ?? 'Metwork'}
                  </p>
                  {receipt.vendor?.address && (
                    <p className="text-xs text-muted-foreground">{receipt.vendor.address}</p>
                  )}
                  {receipt.vendor?.commercialRegNumber && (
                    <p className="text-xs text-muted-foreground">{t.rc}: {receipt.vendor.commercialRegNumber}</p>
                  )}
                  {receipt.vendor?.nif && (
                    <p className="text-xs text-muted-foreground">{t.nif}: {receipt.vendor.nif}</p>
                  )}
                </div>
              </div>
              <div className="text-end flex-shrink-0">
                <p className="font-mono text-xs text-muted-foreground">
                  {t.ref} #{receipt.bookingId.slice(-8).toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.issued}: {new Date(receipt.issuedAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' })}
                </p>
                {receipt.source === 'offline' && (
                  <p className="mt-1 text-xs font-medium text-amber-600">Offline booking</p>
                )}
              </div>
            </div>

            {/* ── Customer ── */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.customer}</p>
              <p className="font-medium">{receipt.customer.name}</p>
              {receipt.customer.email && <p className="text-muted-foreground">{receipt.customer.email}</p>}
              {receipt.customer.phone && <p className="text-muted-foreground">{receipt.customer.phone}</p>}
              {receipt.customer.city && <p className="text-muted-foreground">{receipt.customer.city}</p>}
              {receipt.customer.idNumber && (
                <p className="text-muted-foreground text-xs">{t.idNumber}: {receipt.customer.idNumber}</p>
              )}
            </div>

            {/* ── Item ── */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {receipt.item.kind === 'SPACE' ? t.spaceBooking : t.programEnrollment}
              </p>
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
                <p className="font-medium">{receipt.item.name}</p>
                <p className="text-muted-foreground">{receipt.item.vendor} · {receipt.item.city}</p>
                <p className="text-muted-foreground">
                  {receipt.item.quantity}× {receipt.item.unit.toLowerCase()} ·{' '}
                  {new Date(receipt.item.startsAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}
                  {receipt.item.startsAt !== receipt.item.endsAt && (
                    <> — {new Date(receipt.item.endsAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</>
                  )}
                </p>
              </div>
            </div>

            {/* ── Payment ── */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payment}</p>
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      {t.method}: {receipt.payment.method === 'manual' ? t.manual : t.wallet}
                    </p>
                    <p className="text-muted-foreground text-xs">{t.ref2}: {receipt.payment.transactionRef}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(receipt.payment.paidAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium' })}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">{t.status}: {receipt.payment.status.toLowerCase()}</p>
                  </div>
                  <p className="text-xl font-bold tabular-nums">
                    {receipt.payment.amount === 0 ? 'Free' : `${receipt.payment.amount.toLocaleString()} ${receipt.payment.currency}`}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground border-t border-border pt-3">
              {t.footer}
            </p>
          </div>
        )}

        {receipt && (
          <div className="flex items-center justify-between print:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang((l) => l === 'en' ? 'fr' : 'en')}
              title="Toggle language"
            >
              <Languages className="size-4" />
              {lang === 'en' ? 'FR' : 'EN'}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                <X className="size-4" /> Close
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="size-4" /> Print / Save PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
