'use client';

/**
 * Bulk-add codes to a CODE_POOL perk's pool (newline-separated textarea).
 * POSTs to /api/admin/perks/:id/codes then refreshes the server table.
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';

export function PerkCodesForm({ perkId }: { perkId: string }) {
  const t = useTranslations('admin.perks');
  const router = useRouter();
  const [codes, setCodes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codes.trim()) { setError(t('codesRequired')); return; }
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/perks/${perkId}/codes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ codes }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error?.message ?? t('codesFailed'));
          return;
        }
        setSuccess(t('codesAdded', { added: data.added, skipped: data.skippedDuplicates }));
        setCodes('');
        router.refresh();
      } catch {
        setError(t('networkError'));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormField label={t('bulkCodes')} htmlFor="add-codes" hint={t('bulkCodesHint')}>
        <Textarea
          id="add-codes"
          rows={4}
          className="font-mono text-sm"
          value={codes}
          onChange={(e) => { setCodes(e.target.value); setError(null); setSuccess(null); }}
          placeholder={'SLICK-A1B2\nSLICK-C3D4'}
        />
      </FormField>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending}>
          {t('addCodes')}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
      </div>
    </form>
  );
}
