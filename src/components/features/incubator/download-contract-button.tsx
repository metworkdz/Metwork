'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileSignature, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ContractTemplateOption {
  id: string;
  name: string;
}

interface Props {
  bookingId: string;
  /** Templates that apply to this space booking (pre-filtered by category). */
  templates: ContractTemplateOption[];
}

/**
 * "Download contract" action for a SPACE booking. With one applicable template
 * it downloads directly; with several it opens a picker; with none it renders a
 * disabled hint so the incubator knows to create one.
 */
export function DownloadContractButton({ bookingId, templates }: Props) {
  const t = useTranslations('incubator.contracts');
  const [busy, setBusy] = useState(false);

  async function download(templateId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/incubator/bookings/${bookingId}/contract?templateId=${encodeURIComponent(templateId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] ?? `contract-${bookingId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  if (templates.length === 0) {
    return (
      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" disabled title={t('noTemplates')}>
        <FileSignature className="size-3.5" /> {t('download')}
      </Button>
    );
  }

  if (templates.length === 1) {
    const only = templates[0]!;
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-xs"
        disabled={busy}
        title={t('download')}
        onClick={() => void download(only.id)}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileSignature className="size-3.5" />}
        {busy ? t('generating') : t('download')}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy} title={t('downloadPick')}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileSignature className="size-3.5" />}
          {busy ? t('generating') : t('download')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[260px]">
        {templates.map((tpl) => (
          <DropdownMenuItem key={tpl.id} onClick={() => void download(tpl.id)} className="truncate">
            {tpl.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
