'use client';

/**
 * Client-side action buttons for the investor's startup detail page:
 *  • Save / unsave the listing
 *  • Contact founder (sends a request to admin for manual connection)
 *  • Add to investment tracker
 */
import { useState, useTransition } from 'react';
import { Bookmark, BookmarkCheck, CheckCircle2, MessageSquare, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
      setContactError('Please write at least 10 characters.');
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
        throw new Error(d.error?.message ?? 'Request failed');
      }
      setContactSent(true);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Request failed');
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
      if (!res.ok) throw new Error('Failed to add deal');
      setDealAdded(true);
      setTimeout(() => { setAddDealOpen(false); setDealAdded(false); }, 1500);
    } catch (err) {
      setDealError(err instanceof Error ? err.message : 'Failed');
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
            ? <><BookmarkCheck className="size-4 text-primary-600" /> Saved</>
            : <><Bookmark className="size-4" /> Save</>}
        </Button>

        <Button
          variant="outline"
          onClick={() => { setContactOpen(true); setContactSent(false); setContactError(null); setMessage(''); }}
          className="gap-2"
        >
          <MessageSquare className="size-4" />
          Contact founder
        </Button>

        <Button
          onClick={() => { setAddDealOpen(true); setDealAdded(false); setDealError(null); }}
          className="gap-2"
        >
          <TrendingUp className="size-4" />
          Add to tracker
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
              <h2 className="mt-4 text-lg font-semibold">Request sent!</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Our team will review your request and connect you with the founder of{' '}
                <span className="font-medium text-foreground">{startupName}</span> shortly.
              </p>
              <Button className="mt-6" onClick={() => setContactOpen(false)}>Done</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Contact founder</DialogTitle>
                <DialogDescription>
                  Your request will be reviewed by our team who will manually connect you with the founder of <strong>{startupName}</strong>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <Label htmlFor="contact-msg">Your message *</Label>
                <textarea
                  id="contact-msg"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Introduce yourself and explain your investment interest…"
                  className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">{message.length}/1000 characters</p>
                {contactError && (
                  <p className="text-xs text-destructive">{contactError}</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactBusy}>Cancel</Button>
                <Button loading={contactBusy} onClick={submitContact}>Send request</Button>
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
              <p className="mt-4 font-semibold">Added to your tracker!</p>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add to investment tracker</DialogTitle>
                <DialogDescription>Log this deal for <strong>{startupName}</strong>.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="td-amount">Amount (DZD)</Label>
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
                    <Label htmlFor="td-equity">Equity (%)</Label>
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
                  <Label>Stage</Label>
                  <Select value={dealStatus} onValueChange={(v) => setDealStatus(v as InvestmentStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROSPECTING">Prospecting</SelectItem>
                      <SelectItem value="TERM_SHEET">Term sheet</SelectItem>
                      <SelectItem value="DUE_DILIGENCE">Due diligence</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                      <SelectItem value="PASSED">Passed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {dealError && <p className="text-xs text-destructive">{dealError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDealOpen(false)} disabled={dealBusy}>Cancel</Button>
                <Button loading={dealBusy} onClick={submitDeal}>Add to tracker</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
