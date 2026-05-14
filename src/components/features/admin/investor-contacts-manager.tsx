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
import { MessageSquare } from 'lucide-react';
import type { InvestorContactRecord, InvestorContactStatus } from '@/server/db/store';

const STATUS_VARIANT: Record<InvestorContactStatus, 'warning' | 'success' | 'danger'> = {
  PENDING:   'warning',
  CONNECTED: 'success',
  DECLINED:  'danger',
};

interface Props { initial: InvestorContactRecord[] }

export function InvestorContactsManager({ initial }: Props) {
  const t = useTranslations('admin.investorContacts');
  const [contacts, setContacts] = useState(initial);
  const [editing,  setEditing]  = useState<InvestorContactRecord | null>(null);
  const [status,   setStatus]   = useState<InvestorContactStatus>('PENDING');
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  function openEdit(c: InvestorContactRecord) {
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
      setContacts((prev) => prev.map((c) => c.id === editing.id ? data.contact : c));
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
                      <TableCell className="font-medium">{c.startupName}</TableCell>
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
