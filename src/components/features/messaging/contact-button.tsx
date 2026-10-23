'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link, useRouter } from '@/i18n/routing';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';

interface Props {
  toId: string;
  toName: string;
  contextType: 'VENTURE';
  contextId: string;
  /** Logged-in viewer's role, or null for a visitor. */
  viewerRole: string | null;
  /** Where to come back after login. */
  returnPath: string;
}

/** "Write to X" — opens a thread about an object, then goes to the inbox. */
export function ContactButton({ toId, toName, contextType, contextId, viewerRole, returnPath }: Props) {
  const t = useTranslations('inbox');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!viewerRole) {
    return (
      <Button asChild variant="outline"><Link href={`/login?next=${encodeURIComponent(returnPath)}`}><MessageSquare className="size-4" />{t('contact', { name: toName })}</Link></Button>
    );
  }
  if (viewerRole !== 'FREELANCER' && viewerRole !== 'ENTREPRENEUR') return null;
  const inbox = viewerRole === 'FREELANCER' ? '/dashboard/freelancer/messages' : '/dashboard/entrepreneur/messages';

  async function send() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toId, contextType, contextId, body }),
    });
    setBusy(false);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? 'GENERIC';
      setErr(t(`errors.${['BLOCKED', 'NOT_ALLOWED', 'CONTACT_LIMIT', 'RATE_LIMITED', 'MESSAGING_UNAVAILABLE'].includes(code) ? code : 'GENERIC'}`));
      return;
    }
    const { conversationId } = (await res.json()) as { conversationId: string };
    router.push(`${inbox}?c=${conversationId}`);
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}><MessageSquare className="size-4" />{t('contact', { name: toName })}</Button>
      {open && (
        <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className={SHEET_CONTENT_CLASS}>
            <DialogHeader><DialogTitle>{t('contact', { name: toName })}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <label htmlFor="first-message" className="sr-only">{t('placeholder')}</label>
              <Textarea id="first-message" rows={5} maxLength={4000} value={body} placeholder={t('firstPlaceholder')} className="text-base sm:text-sm" onChange={(e) => setBody(e.target.value)} />
              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
              <Button type="button" className="w-full" loading={busy} disabled={body.trim().length < 2} onClick={() => void send()}>{t('send')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
