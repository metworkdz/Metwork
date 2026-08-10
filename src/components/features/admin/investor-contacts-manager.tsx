'use client';

/**
 * Admin: review investor → founder contact requests and update status.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { FileText, MessageSquare } from 'lucide-react';
import type { InvestorContactRecord, InvestorContactStatus, StartupMaturityStage } from '@/server/db/store';

const STATUS_VARIANT: Record<InvestorContactStatus, 'warning' | 'success' | 'danger'> = {
  PENDING:   'warning',
  CONNECTED: 'success',
  DECLINED:  'danger',
};

/**
 * A contact request joined (read-only, at render time) with its startup's
 * maturityStage and pitchDeckUrl — context an admin needs to set up the
 * meeting without switching pages. Not persisted on InvestorContactRecord.
 */
export interface InvestorContactWithStartup extends InvestorContactRecord {
  startupMaturityStage: StartupMaturityStage | null;
  startupPitchDeckUrl: string | null;
}

interface Props { initial: InvestorContactWithStartup[] }

export function InvestorContactsManager({ initial }: Props) {
  const t = useTranslations('admin.investorContacts');
  const tStage = useTranslations('startup.profileForm');
  const [contacts, setContacts] = useState(initial);
  const [editing,  setEditing]  = useState<InvestorContactWithStartup | null>(null);
  const [status,   setStatus]   = useState<InvestorContactStatus>('PENDING');
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  function openEdit(c: InvestorContactWithStartup) {
    setEditing(c);
    setStatus(c.status);
    setNote(c.adminNote ?? '');
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/admin/investor-contacts/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, adminNote: note }),
      });
      if (!res.ok) throw new Error(t('updateFailed'));
      const data = await res.json() as { contact: InvestorContactRecord };
      // The API only returns the base record — keep the joined startup context.
      setContacts((prev) => prev.map((c) => c.id === editing.id ? { ...c, ...data.contact } : c));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
              icon={<MessageSquare className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colInvestor')}</TableHead>
                    <TableHead>{t('colStartup')}</TableHead>
                    <TableHead>{t('colFounder')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('colAdminNote')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.investorName}</div>
                        <div className="text-xs text-muted-foreground">{c.investorEmail}</div>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div>{c.startupName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {c.startupMaturityStage && (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {tStage(`stage${c.startupMaturityStage}`)}
                            </Badge>
                          )}
                          {c.startupPitchDeckUrl && (
                            <a
                              href={c.startupPitchDeckUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-600 hover:text-primary-700"
                            >
                              <FileText className="size-3" />
                              {t('pitchDeckLink')}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.founderName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status]}>
                          {c.status.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[20ch] truncate">
                        {c.adminNote ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                          {t('reviewButton')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>
              {editing && (
                <>
                  <strong>{editing.investorName}</strong> {t('dialogWantsToConnect')}{' '}
                  <strong>{editing.startupName}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              {(editing.startupMaturityStage || editing.startupPitchDeckUrl) && (
                <div className="flex flex-wrap items-center gap-2">
                  {editing.startupMaturityStage && (
                    <Badge variant="outline">
                      {tStage(`stage${editing.startupMaturityStage}`)}
                    </Badge>
                  )}
                  {editing.startupPitchDeckUrl && (
                    <a
                      href={editing.startupPitchDeckUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      <FileText className="size-4" />
                      {t('pitchDeckLink')}
                    </a>
                  )}
                </div>
              )}

              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="mb-1 text-xs font-medium text-foreground">{t('investorMessage')}</p>
                {editing.message}
              </div>

              <div className="space-y-1.5">
                <Label>{t('fieldStatus')}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as InvestorContactStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">{t('statusPending')}</SelectItem>
                    <SelectItem value="CONNECTED">{t('statusConnected')}</SelectItem>
                    <SelectItem value="DECLINED">{t('statusDeclined')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-note">{t('fieldAdminNote')}</Label>
                <Input
                  id="admin-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('adminNotePlaceholder')}
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>{t('cancel')}</Button>
            <Button loading={saving} onClick={save}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
