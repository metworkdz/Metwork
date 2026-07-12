'use client';

/**
 * RegistrationsTable — incubator dashboard management view.
 *
 * Displays registrations for a single program or event with:
 *  - Search by name / email / phone
 *  - Status filter tabs (All / Confirmed / Waitlisted / Cancelled)
 *  - Paginated results
 *  - Cancel action per row
 *  - CSV export button
 *  - Custom field answer expansion
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Search, Download, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, Clock, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Registration, RegistrationFormField, RegistrationStatus } from '@/types/domain';

interface RegistrationsTableProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  entityTitle: string;
}

const PAGE_SIZE = 20;

type StatusFilter = 'ALL' | RegistrationStatus;

export function RegistrationsTable({
  entityType,
  entityId,
  entityTitle,
}: RegistrationsTableProps) {
  const t = useTranslations('registrationsTable');
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [formFields, setFormFields] = useState<RegistrationFormField[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();
  const searchRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchData = useCallback(async (options: {
    page: number;
    q: string;
    status: StatusFilter;
  }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        entityType,
        entityId,
        page: String(options.page),
        pageSize: String(PAGE_SIZE),
        q: options.q,
        ...(options.status !== 'ALL' ? { status: options.status } : {}),
      });
      const res = await fetch(`/api/incubator/registrations?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as {
        items: Registration[];
        formFields: RegistrationFormField[];
        total: number;
      };
      setRegistrations(data.items);
      setFormFields(data.formFields);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  // Initial load + re-fetch on filter change
  useEffect(() => {
    void fetchData({ page, q: search, status: statusFilter });
  }, [fetchData, page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  function handleSearch(q: string) {
    setSearch(q);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(1);
      void fetchData({ page: 1, q, status: statusFilter });
    }, 300);
  }

  function handleStatusChange(s: StatusFilter) {
    setStatusFilter(s);
    setPage(1);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
  }

  async function handleCancel(id: string) {
    if (!confirm(t('cancelConfirm'))) return;
    startTransition(async () => {
      const res = await fetch('/api/incubator/registrations', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setRegistrations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'CANCELLED' } : r)),
        );
      }
    });
  }

  function handleExport() {
    const params = new URLSearchParams({ entityType, entityId });
    window.open(`/api/incubator/registrations/export?${params}`, '_blank');
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusTabs: { value: StatusFilter; labelKey: string }[] = [
    { value: 'ALL',        labelKey: 'tabAll' },
    { value: 'CONFIRMED',  labelKey: 'tabConfirmed' },
    { value: 'WAITLISTED', labelKey: 'tabWaitlisted' },
    { value: 'CANCELLED',  labelKey: 'tabCancelled' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('subtitle', { count: total, title: entityTitle })}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
          <Download className="size-4" /> {t('exportCsv')}
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9 h-9"
          />
        </div>

        {/* Status tabs — horizontally scrollable on mobile */}
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {statusTabs.map(({ value, labelKey }) => (
            <button
              key={value}
              onClick={() => handleStatusChange(value)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors lg:py-1.5 ${
                statusFilter === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : registrations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <>
        {/* Desktop table (unchanged) */}
        <div className="hidden rounded-lg border border-border overflow-hidden lg:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colName')}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">{t('colEmail')}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">{t('colPhone')}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colStatus')}</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{t('colDate')}</th>
                {formFields.length > 0 && (
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colAnswers')}</th>
                )}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {registrations.map((reg) => (
                <RegistrationRow
                  key={reg.id}
                  registration={reg}
                  formFields={formFields}
                  onCancel={() => handleCancel(reg.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="space-y-3 lg:hidden">
          {registrations.map((reg) => (
            <RegistrationCard
              key={reg.id}
              registration={reg}
              formFields={formFields}
              onCancel={() => handleCancel(reg.id)}
            />
          ))}
        </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('paginationInfo', { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Row ─────────────────────────── */

function RegistrationRow({
  registration: reg,
  formFields,
  onCancel,
}: {
  registration: Registration;
  formFields: RegistrationFormField[];
  onCancel: () => void;
}) {
  const t = useTranslations('registrationsTable');
  const [expanded, setExpanded] = useState(false);

  const hasAnswers = reg.answers.length > 0 && formFields.length > 0;

  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 font-medium">{reg.fullName}</td>
        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{reg.email}</td>
        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{reg.phone}</td>
        <td className="px-4 py-3">
          <StatusBadge status={reg.status} />
        </td>
        <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">
          {new Date(reg.createdAt).toLocaleDateString()}
        </td>
        {formFields.length > 0 && (
          <td className="px-4 py-3">
            {hasAnswers && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {t('viewAnswers')}
                {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            )}
          </td>
        )}
        <td className="px-4 py-3 text-right">
          {reg.status !== 'CANCELLED' && (
            <button
              onClick={onCancel}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {t('cancel')}
            </button>
          )}
        </td>
      </tr>
      {/* Expanded answers row */}
      {expanded && hasAnswers && (
        <tr className="bg-muted/20">
          <td colSpan={formFields.length > 0 ? 7 : 6} className="px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {formFields.map((field) => {
                const answer = reg.answers.find((a) => a.fieldId === field.id);
                if (!answer) return null;
                const display = Array.isArray(answer.value)
                  ? answer.value.join(', ')
                  : String(answer.value);
                if (!display) return null;
                return (
                  <div key={field.id}>
                    <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                    <p className="text-sm mt-0.5">{display}</p>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ───────────────────── Mobile card (below lg) ───────────────────── */

function RegistrationCard({
  registration: reg,
  formFields,
  onCancel,
}: {
  registration: Registration;
  formFields: RegistrationFormField[];
  onCancel: () => void;
}) {
  const t = useTranslations('registrationsTable');
  const [expanded, setExpanded] = useState(false);

  const hasAnswers = reg.answers.length > 0 && formFields.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{reg.fullName}</p>
          {reg.email && <p className="truncate text-xs text-muted-foreground">{reg.email}</p>}
          {reg.phone && <p className="truncate text-xs text-muted-foreground">{reg.phone}</p>}
        </div>
        <div className="shrink-0">
          <StatusBadge status={reg.status} />
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {new Date(reg.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-4">
          {hasAnswers && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t('viewAnswers')}
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          )}
          {reg.status !== 'CANCELLED' && (
            <button
              onClick={onCancel}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>

      {expanded && hasAnswers && (
        <div className="mt-3 grid gap-2 border-t border-border/60 pt-3">
          {formFields.map((field) => {
            const answer = reg.answers.find((a) => a.fieldId === field.id);
            if (!answer) return null;
            const display = Array.isArray(answer.value)
              ? answer.value.join(', ')
              : String(answer.value);
            if (!display) return null;
            return (
              <div key={field.id}>
                <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                <p className="mt-0.5 text-sm">{display}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  if (status === 'CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        <CheckCircle2 className="size-3" /> Confirmed
      </span>
    );
  }
  if (status === 'WAITLISTED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Clock className="size-3" /> Waitlisted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
      <XCircle className="size-3" /> Cancelled
    </span>
  );
}
