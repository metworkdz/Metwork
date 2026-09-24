'use client';

/**
 * Copy a program's public link — the one way in to an unlisted program, so it
 * sits right on the host's program row.
 *
 * The link carries no locale: the site sends each visitor to the program in
 * their own language.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function programPublicUrl(program: { id: string; slug?: string | null }): string {
  return `${window.location.origin}/programs/${encodeURIComponent(program.slug || program.id)}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // No clipboard API (plain http, older in-app browsers): the old way.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

export function CopyProgramLinkButton({
  program,
  className,
  size = 'sm',
}: {
  program: { id: string; slug?: string | null };
  className?: string;
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('programVisibility');
  const [copied, setCopied] = useState(false);

  async function onClick(e: React.MouseEvent) {
    // Rows are often clickable themselves; copying must not open the program.
    e.stopPropagation();
    await copyText(programPublicUrl(program));
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

