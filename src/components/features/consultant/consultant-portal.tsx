'use client';

/**
 * Consultant self-service portal (magic-link authed; no platform user account).
 *
 * One client-driven screen: it calls GET /api/consultant/me — a 401 shows the
 * magic-link sign-in, success shows the dashboard (profile defaults, bookings
 * with link/complete actions, earnings, withdrawals). All data flows through
 * the flag-gated, requireConsultant-guarded /api/consultant/* endpoints.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  Calendar, Clock, LinkIcon, CheckCircle2, Wallet, LogOut, Loader2, Mail, Video, MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ApiClientError } from '@/lib/api-client';
import {
  consultantService,
  type ConsultantMe,
  type ConsultantBooking,
  type ConsultantWithdrawal,
} from '@/services/consultant.service';

type BadgeVariant = 'warning' | 'success' | 'danger' | 'info' | 'primary';
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING_PAYMENT: 'warning', AWAITING_LINK: 'info', READY: 'success',
  COMPLETED: 'primary', CANCELLED: 'danger',
};

function fmtDZD(n: number): string {
  return `${n.toLocaleString('fr-DZ')} DZD`;
}

export function ConsultantPortal() {
  const locale = useLocale();
  const params = useSearchParams();

  const [phase, setPhase] = useState<'loading' | 'signedOut' | 'signedIn'>('loading');
  const [me, setMe] = useState<ConsultantMe | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await consultantService.me();
      setMe(data);
      setPhase('signedIn');
    } catch {
      setPhase('signedOut');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (phase === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (phase === 'signedOut') {
    return <SignIn errorCode={params.get('error')} locale={locale} />;
  }

  return <Dashboard me={me!} onSignedOut={() => { setMe(null); setPhase('signedOut'); }} reload={load} />;
}

/* ─────────────────────────── Sign in ─────────────────────────── */

function SignIn({ errorCode, locale }: { errorCode: string | null; locale: string }) {
  const t = useTranslations('consultantPortal.signin');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await consultantService.requestLink(email.trim(), locale);
      setSent(true);
    } catch {
      setSent(true); // never reveal whether the email matched
    } finally {
      setSending(false);
    }
  }

  const errorMsg = errorCode
    ? ({ invalid: t('errorInvalid'), expired: t('errorExpired'), consumed: t('errorConsumed') } as Record<string, string>)[errorCode] ?? t('errorGeneric')
    : null;

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="size-5 text-primary" /> {t('heading')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-2 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
              <p className="font-medium">{t('sent')}</p>
              <p className="text-sm text-muted-foreground">{t('sentDesc')}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
              {errorMsg && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMsg}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cp-email">{t('emailLabel')}</Label>
                <Input
                  id="cp-email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')} dir="ltr" disabled={sending}
                />
              </div>
              <Button type="submit" className="w-full" loading={sending}>{t('submit')}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Dashboard ─────────────────────────── */

function Dashboard({ me, onSignedOut, reload }: { me: ConsultantMe; onSignedOut: () => void; reload: () => Promise<void> }) {
  const t = useTranslations('consultantPortal');

  async function signOut() {
    try { await consultantService.logout(); } catch { /* ignore */ }
    onSignedOut();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{me.mentor.fullName} · {me.mentor.position}</p>
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>
          <LogOut className="size-4" /> {t('nav.signOut')}
        </Button>
      </header>

      <EarningsSummary wallet={me.wallet} />
      <ProfileSection me={me} onSaved={reload} />
      <BookingsSection />
      <WithdrawalsSection wallet={me.wallet} onChange={reload} />
    </div>
  );
}

function EarningsSummary({ wallet }: { wallet: ConsultantMe['wallet'] }) {
  const t = useTranslations('consultantPortal.earnings');
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('pending')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtDZD(wallet.pendingBalance)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('available')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{fmtDZD(wallet.availableBalance)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileSection({ me, onSaved }: { me: ConsultantMe; onSaved: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.profile');
  const [mode, setMode] = useState<'ONLINE' | 'OFFLINE'>(me.mentor.defaultMeetingMode ?? 'ONLINE');
  const [link, setLink] = useState(me.mentor.defaultMeetingLink ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      await consultantService.updateProfile({
        defaultMeetingMode: mode,
        defaultMeetingLink: mode === 'ONLINE' ? (link.trim() || null) : null,
      });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('heading')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
        <div className="space-y-1.5">
          <Label>{t('modeLabel')}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as 'ONLINE' | 'OFFLINE')} disabled={saving}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ONLINE">{t('modeOnline')}</SelectItem>
              <SelectItem value="OFFLINE">{t('modeOffline')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === 'ONLINE' && (
          <div className="space-y-1.5">
            <Label htmlFor="cp-link">{t('linkLabel')}</Label>
            <Input id="cp-link" type="url" value={link} onChange={(e) => setLink(e.target.value)}
              placeholder={t('linkPlaceholder')} dir="ltr" disabled={saving} />
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={save} loading={saving} size="sm">{t('save')}</Button>
          {saved && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" />{t('saved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function BookingsSection() {
  const t = useTranslations('consultantPortal.bookings');
  const tStatus = useTranslations('admin.mentorBookings');
  const [items, setItems] = useState<ConsultantBooking[] | null>(null);

  const load = useCallback(async () => {
    try { setItems((await consultantService.bookings()).items); }
    catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const statusLabel = (s: string) => ({
    PENDING_PAYMENT: tStatus('statusPendingPayment'), AWAITING_LINK: tStatus('statusAwaitingLink'),
    READY: tStatus('statusReady'), COMPLETED: tStatus('statusCompleted'), CANCELLED: tStatus('statusCancelled'),
  } as Record<string, string>)[s] ?? s;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('heading')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {items === null ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : items.map((b) => (
          <BookingRow key={b.id} booking={b} statusLabel={statusLabel(b.status)} onChanged={load} />
        ))}
      </CardContent>
    </Card>
  );
}

function BookingRow({ booking, statusLabel, onChanged }: { booking: ConsultantBooking; statusLabel: string; onChanged: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.bookings');
  const [mode, setMode] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveLink() {
    setBusy(true); setError(null);
    try {
      await consultantService.setBookingLink(booking.id, { mode, link: mode === 'ONLINE' ? link.trim() : null });
      await onChanged();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : 'Error'); }
    finally { setBusy(false); }
  }
  async function complete() {
    setBusy(true); setError(null);
    try { await consultantService.completeBooking(booking.id); await onChanged(); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{booking.userName}</span>
        <Badge variant={STATUS_VARIANT[booking.status] ?? 'info'}>{statusLabel}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {booking.scheduledAt && <span className="inline-flex items-center gap-1"><Calendar className="size-3" />{new Date(booking.scheduledAt).toLocaleString()}</span>}
        {booking.durationMinutes && <span className="inline-flex items-center gap-1"><Clock className="size-3" />{booking.durationMinutes} min</span>}
        {booking.meetingMode === 'ONLINE' && booking.meetingLink && <span className="inline-flex items-center gap-1"><Video className="size-3" />{t('online')}</span>}
        {booking.meetingMode === 'OFFLINE' && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{t('inPerson')}</span>}
        <span className="tabular-nums">{fmtDZD(booking.amountCharged)}</span>
      </div>
      <p className="mt-1.5 text-muted-foreground line-clamp-2">{booking.message}</p>

      {booking.status === 'AWAITING_LINK' && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-2.5">
          <p className="text-xs font-medium">{t('setLinkHeading')}</p>
          <div className="flex flex-wrap gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as 'ONLINE' | 'OFFLINE')} disabled={busy}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ONLINE">{t('online')}</SelectItem>
                <SelectItem value="OFFLINE">{t('inPerson')}</SelectItem>
              </SelectContent>
            </Select>
            {mode === 'ONLINE' && (
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" dir="ltr"
                className="h-8 flex-1 text-xs" disabled={busy} />
            )}
            <Button size="sm" className="h-8" onClick={saveLink} loading={busy}>
              <LinkIcon className="size-3.5" /> {t('setLinkCta')}
            </Button>
          </div>
        </div>
      )}

      {booking.status === 'READY' && (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={complete} loading={busy}>
            <CheckCircle2 className="size-3.5" /> {t('completeCta')}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function WithdrawalsSection({ wallet, onChange }: { wallet: ConsultantMe['wallet']; onChange: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.withdrawals');
  const [items, setItems] = useState<ConsultantWithdrawal[] | null>(null);
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await consultantService.withdrawals()).items); }
    catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function request() {
    setBusy(true); setError(null);
    try {
      await consultantService.requestWithdrawal({ amount: Number(amount), accountDetails: account.trim() });
      setAmount(''); setAccount('');
      await load();
      await onChange();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : t('errorGeneric')); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4" /> {t('heading')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="cp-amt" className="text-xs">{t('amountLabel')}</Label>
            <Input id="cp-amt" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="5000" dir="ltr" disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-acct" className="text-xs">{t('accountLabel')}</Label>
            <Input id="cp-acct" value={account} onChange={(e) => setAccount(e.target.value)}
              placeholder={t('accountPlaceholder')} disabled={busy} />
          </div>
          <Button onClick={request} loading={busy} disabled={!amount || account.trim().length < 5}>{t('request')}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('availableNote', { amount: fmtDZD(wallet.availableBalance) })}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}

        {items && items.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            {items.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-sm">
                <span className="tabular-nums">{fmtDZD(w.amount)}</span>
                <span className="text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleDateString()}</span>
                <Badge variant={w.status === 'APPROVED' ? 'success' : w.status === 'REJECTED' ? 'danger' : 'warning'}>
                  {t(`status${w.status[0]}${w.status.slice(1).toLowerCase()}`)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
