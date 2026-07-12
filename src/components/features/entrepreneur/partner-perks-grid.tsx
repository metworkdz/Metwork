'use client';

/**
 * Partner Perks grid for the entrepreneur dashboard.
 *
 * Card states:
 *  - not claimed          → "Reveal offer" button (POST /api/perks/:id/claim)
 *  - claimed CODE_POOL    → monospace code + copy-to-clipboard
 *  - claimed VOUCHER      → "View my pass" → public /verify/[code] page
 *    (the verify page is the single voucher renderer — no duplicate display
 *    logic in the dashboard).
 *
 * Server data comes from the RSC parent (listPerksForUser); a successful
 * claim updates local state directly so the reveal feels instant, then the
 * next server render stays consistent.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Check, Copy, Sparkles, Ticket, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { PartnerLogo } from '@/components/features/admin/perks-manager';
import type { UserPerkView } from '@/server/perks/service';

export function PartnerPerksGrid({ perks: initial }: { perks: UserPerkView[] }) {
  const t = useTranslations('pages.dashboard.entrepreneur.perks');
  const [perks, setPerks] = useState(initial);

  if (perks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('noPartnerPerks')}</p>
      </div>
    );
  }

  function applyClaim(perkId: string, claim: { code: string; claimedAt: string; verifyPath?: string }) {
    setPerks((list) =>
      list.map((p) => (p.id === perkId ? { ...p, claimStatus: 'claimed' as const, claim } : p)),
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {perks.map((perk) => (
        <PartnerPerkCard key={perk.id} perk={perk} onClaimed={applyClaim} />
      ))}
    </div>
  );
}

function PartnerPerkCard({
  perk,
  onClaimed,
}: {
  perk: UserPerkView;
  onClaimed: (perkId: string, claim: { code: string; claimedAt: string; verifyPath?: string }) => void;
}) {
  const t = useTranslations('pages.dashboard.entrepreneur.perks');
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch(`/api/perks/${perk.id}/claim`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        const code: string | undefined = data?.error?.code;
        if (code === 'OUT_OF_STOCK') setError(t('outOfStock'));
        else if (code === 'ALREADY_CLAIMED') setError(t('alreadyClaimed'));
        else if (code === 'TIER_TOO_LOW') setError(t('tierTooLow'));
        else setError(t('claimFailed'));
        return;
      }
      setJustClaimed(true);
      setTimeout(() => setJustClaimed(false), 2000);
      onClaimed(perk.id, {
        code: data.code,
        claimedAt: data.issuedAt ?? new Date().toISOString(),
        verifyPath: data.verifyPath,
      });
    } catch {
      setError(t('claimFailed'));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <PartnerLogo logoUrl={perk.logoUrl} partnerName={perk.partnerName} />
          <MembershipTierBadge tier={perk.minTier} size="xs" />
        </div>

        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {perk.partnerName}
          </p>
          <h3 className="mt-0.5 text-base font-semibold">{perk.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{perk.description}</p>
        </div>

        <div className="mt-auto pt-2">
          {perk.claimStatus === 'claimed' && perk.claim ? (
            perk.fulfillmentType === 'CODE_POOL' ? (
              <RevealedCode code={perk.claim.code} justClaimed={justClaimed} />
            ) : (
              <Button asChild variant="outline" className="w-full">
                <Link href={perk.claim.verifyPath ?? `/verify/${perk.claim.code}`}>
                  <Ticket className="me-1.5 size-4" />
                  {t('viewPass')}
                  <ExternalLink className="ms-1.5 size-3.5 text-muted-foreground" />
                </Link>
              </Button>
            )
          ) : perk.outOfStock ? (
            <Badge variant="warning" className="w-full justify-center py-2">
              {t('outOfStock')}
            </Badge>
          ) : (
            <Button onClick={reveal} loading={claiming} className="w-full">
              <Sparkles className="me-1.5 size-4" />
              {t('reveal')}
            </Button>
          )}
          {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RevealedCode({ code, justClaimed }: { code: string; justClaimed: boolean }) {
  const t = useTranslations('pages.dashboard.entrepreneur.perks');
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-1.5">
      {justClaimed && (
        <p className="flex items-center justify-center gap-1 text-xs font-medium text-emerald-600">
          <Check className="size-3.5" />
          {t('claimSuccess')}
        </p>
      )}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-semibold tracking-wide">
          {code}
        </code>
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          className="shrink-0"
          aria-label={t('copy')}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
