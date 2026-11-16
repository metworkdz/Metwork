'use client';

/**
 * Copy an event's public link — same button as the program row, so the two
 * dashboards offer the same one-click share. The link carries no locale: the site
 * sends each visitor to the event in their own language.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { copyText } from '@/components/features/programs/copy-program-link';

export function eventPublicUrl(event: { id: string; slug?: string | null }): string {
  return `${window.location.origin}/events/${encodeURIComponent(event.slug || event.id)}`;
}

export function CopyEventLinkButton({
  event,
  className,
  size = 'sm',
}: {
  event: { id: string; slug?: string | null };
  className?: string;
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('programVisibility');
  const [copied, setCopied] = useState(false);

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    await copyText(eventPublicUrl(event));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Button type="button" variant="outline" size={size} className={className} onClick={(e) => void onClick(e)}>
      {copied ? <Check className="size-4 text-primary" /> : <Link2 className="size-4" />}
      {copied ? t('linkCopied') : t('copyLink')}
    </Button>
  );
}
