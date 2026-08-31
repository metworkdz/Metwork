'use client';

/**
 * The single reusable consultant-contract template.
 *
 * Paste your own already-drafted contract here, once. Creating a new
 * contract from then on is just picking a consultant — this text is merged
 * with their live data (`consultant-contracts/variables.ts`) into that
 * contract's own editable body, so replacing the template later never
 * rewrites a contract already created from an earlier version.
 *
 * The template IS the whole document: there is no separate auto-generated
 * letterhead or terms table layered on top of it (see `contract-pdf.ts`) —
 * write it exactly as you want it to read, including Metwork's own company
 * block if you want one printed, either as literal text or via the optional
 * `{{metwork_*}}` tokens below.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save, FileSignature } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CONSULTANT_CONTRACT_VARIABLES } from '@/server/consultant-contracts/variables';

export function ConsultantContractTemplateForm({ initial }: { initial: string | null }) {
  const t = useTranslations('admin.platformSettings');
  const [body, setBody] = useState(initial ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ consultantContractTemplate: body.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? t('saveFailed'));
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <p className="flex items-center gap-2 font-medium">
          <FileSignature className="size-4" /> {t('sectionContractTemplate')}
        </p>
        <p className="text-xs text-muted-foreground">{t('sectionContractTemplateDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!body.trim() && (
          <p className="text-xs text-amber-600">{t('contractTemplateUnsetWarning')}</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="contract-template">{t('contractTemplateLabel')}</Label>
          <Textarea
            id="contract-template"
            value={body}
            onChange={(e) => { setBody(e.target.value); setSaved(false); }}
            rows={16}
            dir="ltr"
            lang="fr"
            placeholder="ENTRE LES SOUSSIGNÉS : …"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('contractTemplateVariablesLabel')}</p>
          <div className="flex flex-wrap gap-1.5">
            {CONSULTANT_CONTRACT_VARIABLES.map((token) => (
              <code
                key={token}
                className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[11px]"
              >
                {`{{${token}}}`}
              </code>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button size="sm" loading={saving} onClick={() => void save()}>
            <Save className="size-3.5" /> {t('saveSettings')}
          </Button>
          {saved && <span className="text-xs text-emerald-600">{t('settingsSaved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
