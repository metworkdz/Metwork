'use client';

/**
 * Admin-only "Consultant link" dialog.
 *
 * Generates the consultant's durable sign-in link (`…/consultant?token=<token>`),
 * shown ONCE, so the admin can copy it and share it privately with the mentor.
 * The mentor sets a PIN on first access (and can change it anytime) to reach
 * their dashboard. Regenerating invalidates the previous link and all remembered
 * devices; "Revoke" clears durable access entirely.
 *
 * The raw token never round-trips again — only its hash is stored server-side.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, RefreshCw, ShieldX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mentorsService } from '@/services/mentors.service';
import { ApiClientError } from '@/lib/api-client';
import type { Mentor } from '@/types/mentor';

interface ConsultantLinkDialogProps {
  mentor: Mentor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after generate/revoke so the parent list reflects the new rotatedAt. */
  onChanged?: (mentor: Mentor) => void;
}

export function ConsultantLinkDialog({ mentor, open, onOpenChange, onChanged }: ConsultantLinkDialogProps) {
  const t = useTranslations('admin.mentorsManager');
  const [link, setLink] = useState<string | null>(null);
  const [rotatedAt, setRotatedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens for a (possibly different) mentor.
  useEffect(() => {
    if (open && mentor) {
      setLink(null);
      setRotatedAt(mentor.accessTokenRotatedAt ?? null);
      setRevoked(false);
      setCopied(false);
      setError(null);
    }
  }, [open, mentor]);

  async function generate() {
    if (!mentor) return;
    setGenerating(true); setError(null); setRevoked(false);
    try {
      const res = await mentorsService.generateAccessToken(mentor.id);
      const url = `${window.location.origin}/fr/consultant?token=${res.token}`;
      setLink(url);
      setRotatedAt(res.rotatedAt);
      onChanged?.({ ...mentor, accessTokenRotatedAt: res.rotatedAt });
    } catch (e) {
      setError(e instanceof ApiClientError ? (e.message || t('linkError')) : t('linkError'));
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context) — the field is selectable as a fallback.
      setError(t('copyFailed'));
    }
  }

  async function revoke() {
    if (!mentor) return;
    setRevoking(true); setError(null);
    try {
      await mentorsService.revokeAccessToken(mentor.id);
      setLink(null);
      setRotatedAt(null);
      setRevoked(true);
      onChanged?.({ ...mentor, accessTokenRotatedAt: null });
    } catch (e) {
      setError(e instanceof ApiClientError ? (e.message || t('linkError')) : t('linkError'));
    } finally {
      setRevoking(false);
    }
  }

  const hasActive = rotatedAt !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t('linkDialogTitle')}
          </DialogTitle>
          <DialogDescription>{t('linkDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {mentor && (
            <p className="text-sm font-medium text-foreground">{mentor.fullName}</p>
          )}

          {/* Active-link warning (shown before a fresh generate). */}
          {hasActive && !link && rotatedAt && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {t('linkActiveSince', { date: new Date(rotatedAt).toLocaleString() })}
            </p>
          )}

          {/* The generated link — shown once. */}
          {link && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" dir="ltr" />
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copy} aria-label={t('copy')}>
                  {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('linkHint')}</p>
            </div>
          )}

          {revoked && (
            <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('revoked')}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {hasActive && (
            <Button type="button" variant="outline" loading={revoking} onClick={revoke} className="text-destructive hover:text-destructive">
              <ShieldX className="size-4" />
              {t('revoke')}
            </Button>
          )}
          <Button type="button" loading={generating} onClick={generate}>
            <RefreshCw className="size-4" />
            {hasActive || link ? t('regenerate') : t('generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
