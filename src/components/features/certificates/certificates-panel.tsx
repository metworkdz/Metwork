'use client';

/**
 * The « Attestations » tab of a program: who gets a certificate, and what it
 * looks like. Both halves stay mounted, so switching between them never
 * throws away a design the host has not saved yet.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Palette, Users } from 'lucide-react';

import { cn } from '@/lib/utils';

import { CertificateEditor } from './certificate-editor';
import { CertificateParticipants } from './certificate-participants';

interface Props {
  programId: string;
  apiBase: '/api/incubator/programs' | '/api/consultant/programs';
  uploadEndpoint: '/api/incubator/upload' | '/api/consultant/upload';
  uploadKind?: string;
}

export function CertificatesPanel({ programId, apiBase, uploadEndpoint, uploadKind }: Props) {
  const t = useTranslations('certificates');
  const [view, setView] = useState<'participants' | 'design'>('participants');

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="tablist">
        {([
          ['participants', t('viewParticipants'), Users],
          ['design', t('viewDesign'), Palette],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              'inline-flex min-h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors',
              view === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div hidden={view !== 'participants'}>
        <CertificateParticipants
          programId={programId}
          apiBase={apiBase}
          active={view === 'participants'}
          onEditDesign={() => setView('design')}
        />
      </div>
      <div hidden={view !== 'design'}>
        <CertificateEditor
          programId={programId}
          apiBase={apiBase}
          uploadEndpoint={uploadEndpoint}
          uploadKind={uploadKind}
        />
      </div>
    </div>
  );
}
