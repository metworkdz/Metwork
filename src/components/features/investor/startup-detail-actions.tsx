'use client';

/**
 * Client-side action buttons for the investor's startup detail page:
 *  • Save / unsave the listing
 *  • Contact founder (sends a request to admin for manual connection)
 *  • Add to investment tracker
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Bookmark, BookmarkCheck, CheckCircle2, MessageSquare, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface Props {
  startupId:   string;
  startupName: string;
  isSaved:     boolean;
}

type InvestmentStatus = 'PROSPECTING' | 'TERM_SHEET' | 'DUE_DILIGENCE' | 'CLOSED' | 'PASSED';

export function StartupDetailActions({ startupId, startupName, isSaved: initialSaved }: Props) {
  const t = useTranslations('investor.actions');

  const [saved,          setSaved]          = useState(initialSaved);
  const [contactOpen,    setContactOpen]    = useState(false);
  const [addDealOpen,    setAddDealOpen]    = useState(false);
  const [message,        setMessage]        = useState('');
  const [contactSent,    setContactSent]    = useState(false);
  const [contactError,   setContactError]   = useState<string | null>(null);
  const [contactBusy,    setContactBusy]    = useState(false);
  const [dealAmount,     setDealAmount]     = useState('');
  const [dealEquity,     setDealEquity]     = useState('');
  const [dealStatus,     setDealStatus]     = useState<InvestmentStatus>('PROSPECTING');
  const [dealBusy,       setDealBusy]       = useState(false);
  const [dealError,      setDealError]      = useState<string | null>(null);
  const [dealAdded,      setDealAdded]      = useState(false);
  const [, startTransition] = useTransition();

  function toggleSave() {
    startTransition(async () => {
      setSaved((s) => !s);
      await fetch(`/api/startups/${startupId}/save`, {
        method: 'POST',
        credentials: 'include',
      });
    });
  }

  async function submitContact() {
    if (message.trim().length < 10) {
      setContactError(t('contactErrorMinLength'));
      return;
    }
    setContactBusy(true); setContactError(null);
    try {
      const res = await fetch(`/api/startups/${startupId}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? t('contactErrorFailed'));
      }
      setContactSent(true);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : t('contactErrorFailed'));
    } finally {
      setContactBusy(false);
    }
  }

  async function submitDeal() {
    const amount = parseInt(dealAmount, 10) || 0;
    const equity = parseFloat(dealEquity) || 0;
    setDealBusy(true); setDealError(null);
    try {
      const res = await fetch('/api/investor/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startupName: startupName,
          startupId:   startupId,
          amount,
          equity,
          status:  dealStatus,
          notes:   '',
        }),
      });
      if (!res.ok) throw new Error(t('errorAddFailed'));
      setDealAdded(true);
      setTimeout(() => { setAddDealOpen(false); setDealAdded(false); }, 1500);
    } catch (err) {
      setDealError(err instanceof Error ? err.message : t('errorFailed'));
    } finally {
      setDealBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={toggleSave}
          className="gap-2"
        >
          {saved
            ? <><BookmarkCheck className="size-4 text-primary-600" /> {t('saved')}</>
            : <><Bookmark className="size-4" /> {t('save')}</>}
        </Button>

        <Button
          variant="outline"
          onClick={() => { setContactOpen(true); setContactSent(false); setContactError(null); setMessage(''); }}
          className="gap-2"
        >
          <MessageSquare className="size-4" />
          {t('contactFounder')}
        </Button>

        <Button
          onClick={() => { setAddDealOpen(true); setDealAdded(false); setDealError(null); }}
          className="gap-2"
        >
          <TrendingUp className="size-4" />
          {t('addToTracker')}
        </Button>
      </div>

      {/* Contact founder dialog */}
      <Dialog open={contactOpen} onOpenChange={(o) => { if (!o) setContactOpen(false); }}>
        <DialogContent className="max-w-md">
          {contactSent ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="size-7 text-emerald-600" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">{t('requestSentTitle')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('requestSentDesc', { name: startupName })}
              </p>
              <Button className="mt-6" onClick={() => setContactOpen(false)}>{t('done')}</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('contactDialogTitle')}</DialogTitle>
                <DialogDescription>
                  {t('contactDialogDesc', { name: startupName })}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <Label htmlFor="contact-msg">{t('fieldMessage')}</Label>
                <textarea
                  id="contact-msg"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder={t('fieldMessagePlaceholder')}
                  className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">{t('charCount', { count: message.length })}</p>
                {contactError && (
                  <p className="text-xs text-destructive">{contactError}</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactBusy}>{t('cancel')}</Button>
                <Button loading={contactBusy} onClick={submitContact}>{t('sendRequest')}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add to tracker dialog */}
      <Dialog open={addDealOpen} onOpenChange={(o) => { if (!o) setAddDealOpen(false); }}>
        <DialogContent className="max-w-sm">
          {dealAdded ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="size-7 text-emerald-600" />
              </div>
              <p className="mt-4 font-semibold">{t('addedToTracker')}</p>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('trackerDialogTitle')}</DialogTitle>
                <DialogDescription>{t('trackerDialogDesc', { name: startupName })}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="td-amount">{t('fieldAmountDZD')}</Label>
                    <Input
                      id="td-amount"
                      type="number"
                      min={0}
                      value={dealAmount}
                      onChange={(e) => setDealAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="td-equity">{t('fieldEquity')}</Label>
                    <Input
                      id="td-equity"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={dealEquity}
                      onChange={(e) => setDealEquity(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fieldStage')}</Label>
                  <Select value={dealStatus} onValueChange={(v) => setDealStatus(v as InvestmentStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROSPECTING">{t('stageProspecting')}</SelectItem>
                      <SelectItem value="TERM_SHEET">{t('stageTermSheet')}</SelectItem>
                      <SelectItem value="DUE_DILIGENCE">{t('stageDueDiligence')}</SelectItem>
                      <SelectItem value="CLOSED">{t('stageClosed')}</SelectItem>
                      <SelectItem value="PASSED">{t('stagePassed')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {dealError && <p className="text-xs text-destructive">{dealError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDealOpen(false)} disabled={dealBusy}>{t('cancel')}</Button>
                <Button loading={dealBusy} onClick={submitDeal}>{t('addToTracker')}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
