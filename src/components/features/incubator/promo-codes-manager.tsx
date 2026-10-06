'use client';

/**
 * The incubator's promo codes: create, edit, deactivate, delete, and choose
 * which of their programs and spaces each code works on.
 *
 * Data comes from the server page as props and every mutation ends in
 * `router.refresh()`, the same loop the admin page uses — there is one source
 * of truth and no client cache to drift from it.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { ScopedPromoCode } from '@/lib/promo-code-ui';
import { PromoCodeDialog } from './promo-code-dialog';
import { PromoCodeActions, PromoStatusBadge, PromoUsage, ScopeChips } from './promo-code-parts';
import type { PickerProgram, PickerSpace } from './promo-scope-picker';

interface Props {
  codes: ScopedPromoCode[];
  programs: PickerProgram[];
  spaces: PickerSpace[];
}

export function PromoCodesManager({ codes, programs, spaces }: Props) {
  const t = useTranslations('incubator.promoCodes');
  const locale = useLocale() as Locale;
  const [creating, setCreating] = useState(false);
  // The record is kept after close so the dialog does not flip to "create" while it animates out.
  const [editing, setEditing] = useState<ScopedPromoCode | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const startEdit = (c: ScopedPromoCode) => { setEditing(c); setEditOpen(true); };

  const expiry = (c: ScopedPromoCode) => (c.expiresAt ? formatDate(c.expiresAt, locale) : '—');

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {t('newCode')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {codes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Tag className="size-6 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{t('emptyDescription')}</p>
            </div>
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 text-start">{t('colCode')}</th>
                      <th className="px-4 py-3 text-start">{t('colDiscount')}</th>
                      <th className="px-4 py-3 text-start">{t('colValidFor')}</th>
                      <th className="px-4 py-3 text-start">{t('colUsage')}</th>
                      <th className="px-4 py-3 text-start">{t('colExpiry')}</th>
                      <th className="px-4 py-3 text-start">{t('colStatus')}</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => (
                      <tr key={c.id} className="border-b border-border align-top last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-mono font-semibold tracking-wide">{c.code}</td>
                        <td className="px-4 py-3">{c.discountPercent}%</td>
                        <td className="px-4 py-3"><ScopeChips promo={c} programs={programs} spaces={spaces} /></td>
                        <td className="px-4 py-3"><PromoUsage promo={c} /></td>
                        <td className="whitespace-nowrap px-4 py-3">{expiry(c)}</td>
                        <td className="px-4 py-3"><PromoStatusBadge promo={c} /></td>
                        <td className="px-4 py-3"><PromoCodeActions promo={c} onEdit={() => startEdit(c)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile / tablet: cards */}
              <ul className="divide-y divide-border lg:hidden">
                {codes.map((c) => (
                  <li key={c.id} className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-base font-semibold tracking-wide">{c.code}</span>
                      <PromoStatusBadge promo={c} />
                    </div>
                    {/* Separate items, not one "·"-joined string: mixed digits and Arabic text reorder in RTL. */}
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span dir="ltr">{c.discountPercent}%</span>
                      <PromoUsage promo={c} />
                      <span>{t('colExpiry')}: {expiry(c)}</span>
                    </p>
                    <ScopeChips promo={c} programs={programs} spaces={spaces} />
                    <PromoCodeActions promo={c} onEdit={() => startEdit(c)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <PromoCodeDialog open={creating} onOpenChange={setCreating} programs={programs} spaces={spaces} />
      <PromoCodeDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        programs={programs}
        spaces={spaces}
        promo={editing}
      />
    </div>
  );
}
