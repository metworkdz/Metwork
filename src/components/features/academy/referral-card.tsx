'use client';

/** "Invite a friend": the member's link, copy / WhatsApp share, and what it has brought so far. */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ReferralCard({ link, invited, pending, earned }: { link: string; invited: number; pending: number; earned: string }) {
  const t = useTranslations('academy.referral');
  const [copied, setCopied] = useState(false);
  const share = `https://wa.me/?text=${encodeURIComponent(`${t('shareText')} ${link}`)}`;
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <p className="font-display text-lg font-extrabold">{t('title')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('desc')}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-sm">{link}</code>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* copy blocked */ } }}>
            {copied ? <Check className="me-1.5 size-4" /> : <Copy className="me-1.5 size-4" />}{copied ? t('copied') : t('copy')}
          </Button>
          <Button asChild><a href={share} target="_blank" rel="noopener noreferrer"><Share2 className="me-1.5 size-4" />{t('whatsapp')}</a></Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('stats', { invited, pending, earned })}</p>
    </div>
  );
}
