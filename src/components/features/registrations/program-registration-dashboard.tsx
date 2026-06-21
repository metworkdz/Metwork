'use client';

/**
 * ProgramRegistrationDashboard — tabbed management view.
 *
 * Tab 1: Registration Form Builder
 * Tab 2: Registrations list
 *
 * Used on both /dashboard/incubator/programs/[id] and
 * /dashboard/incubator/events/[id].
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList, Settings2, ExternalLink } from 'lucide-react';
import { RegistrationFormBuilder } from './form-builder';
import { RegistrationsTable } from './registrations-table';
import type { RegistrationFormField } from '@/types/domain';

interface ProgramRegistrationDashboardProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  entityTitle: string;
  entitySlug: string | null;
  initialFormFields: RegistrationFormField[];
}

type Tab = 'form' | 'registrations';

export function ProgramRegistrationDashboard({
  entityType,
  entityId,
  entityTitle,
  entitySlug,
  initialFormFields,
}: ProgramRegistrationDashboardProps) {
  const t = useTranslations('registrationDashboard');
  const [tab, setTab] = useState<Tab>('registrations');

  const publicPath = entityType === 'PROGRAM'
    ? `/programs/${entitySlug ?? entityId}`
    : `/events/${entitySlug ?? entityId}`;

  const tabs: { id: Tab; labelKey: string; Icon: React.ElementType }[] = [
    { id: 'registrations', labelKey: 'tabRegistrations', Icon: ClipboardList },
    { id: 'form',          labelKey: 'tabFormBuilder',   Icon: Settings2 },
  ];

  return (
    <div className="space-y-4">
      {/* Public page link */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-2.5">
        <ExternalLink className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground">{t('publicPage')}:</span>
        <a
          href={publicPath}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline truncate"
        >
          {publicPath}
        </a>
      </div>

      {/* Tabs — desktop (unchanged) */}
      <div className="hidden border-b border-border lg:flex">
        {tabs.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="size-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Tabs — mobile: horizontal scrollable pill bar */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
              tab === id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-lg border border-border bg-card p-3 lg:p-5">
        {tab === 'form' ? (
          <RegistrationFormBuilder
            entityType={entityType}
            entityId={entityId}
            initialFields={initialFormFields}
          />
        ) : (
          <RegistrationsTable
            entityType={entityType}
            entityId={entityId}
            entityTitle={entityTitle}
          />
        )}
      </div>
    </div>
  );
}
