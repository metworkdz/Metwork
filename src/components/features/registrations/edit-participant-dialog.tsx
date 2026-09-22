'use client';

/**
 * Correct a participant's name, email or phone.
 *
 * Only those three. Not the answers, not the amount, not the status — this is
 * for fixing a typo in a phone number, not for rewriting what somebody
 * submitted, and the server enforces the same narrow shape.
 *
 * Changing the email is the one edit with a consequence beyond the row: the
 * server refuses an address already used by another participant on the same
 * listing, because attendance de-duplicates by email and the two would merge
 * into one seat.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Registration } from '@/types/domain';

interface Props {
  registration: Registration | null;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  onSaved: (updated: Registration) => void;
}

export function EditParticipantDialog({ registration, onOpenChange, endpoint, onSaved }: Props) {
  const t = useTranslations('registrationsTable');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row the fields were loaded from, so reopening reloads them. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (registration && loadedFor !== registration.id) {
    setLoadedFor(registration.id);
    setFullName(registration.fullName);
    setEmail(registration.email);
    setPhone(registration.phone);
    setError(null);
  }

  async function save() {
    if (!registration) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`${endpoint}/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: registration.id, fullName, email, phone }),
      });
      const body = await res.json().catch(() => null) as
        { registration?: Registration; error?: { message?: string } } | null;

      if (!res.ok || !body?.registration) {
        setError(body?.error?.message ?? t('editFailed'));
        return;
      }
      onSaved(body.registration);
      onOpenChange(false);
    } catch {
      setError(t('editFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={registration !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="edit-name">{t('colName')}</Label>
            <Input
              id="edit-name"
              className="mt-1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={160}
            />
          </div>
          <div>
            <Label htmlFor="edit-email">{t('colEmail')}</Label>
            <Input
              id="edit-email"
              type="email"
              className="mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={320}
            />
          </div>
          <div>
            <Label htmlFor="edit-phone">{t('colPhone')}</Label>
            <Input
              id="edit-phone"
              type="tel"
              dir="ltr"
              className="mt-1"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('editCancel')}
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {t('editSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
