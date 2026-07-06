'use client';

/**
 * Consultant self-service portal (PROMPT 4 — premium redesign).
 *
 * A near-black, brand-green Revolut/Airbnb-style "app": magic-link OR
 * durable-token+PIN sign-in, then a mobile-first dashboard (account hero,
 * availability editor, booked consultations with client PII, profile, earnings,
 * wallet) navigated by a bottom tab bar. All data flows through the flag-gated,
 * requireConsultant-guarded /api/consultant/* endpoints. No client storage.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight, CalendarClock, CalendarDays, Check, ChevronRight, Copy, Link2, Loader2, LogOut,
  MessageSquareText, ShieldOff, TrendingUp, User, Wallet,
} from 'lucide-react';
import { consultantService, type ConsultantMe, type ConsultantMentor } from '@/services/consultant.service';
import { cn } from '@/lib/utils';
import { PinUnlock } from './portal/pin-unlock';
import { AvailabilityEditor } from './portal/availability-editor';
import { BookingsSection } from './portal/bookings-section';
import { ProfileSection } from './portal/profile-section';
import { EarningsSection } from './portal/earnings-section';
import { WalletSection } from './portal/wallet-section';
import { LanguageSwitcher } from './portal/language-switcher';
import { AppLogo, Avatar, CP_GLOW, CP_GREEN, fmtDZD } from './portal/shared';

type Tab = 'consultations' | 'availability' | 'profile' | 'earnings' | 'wallet';

export function ConsultantPortal() {
  const [phase, setPhase] = useState<'loading' | 'signedOut' | 'signedIn'>('loading');
  const [me, setMe] = useState<ConsultantMe | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await consultantService.me());
      setPhase('signedIn');
    } catch {
      setPhase('signedOut');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div dir="auto" className="dark min-h-[100dvh] bg-[#0D0D0D] text-white antialiased">
      {phase === 'loading' ? (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 text-white/40">
          <AppLogo height={30} />
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : phase === 'signedOut' ? (
        <div className="mx-auto max-w-xl px-4">
          <div className="flex justify-end pt-3">
            <LanguageSwitcher />
          </div>
          <PinUnlock onUnlocked={() => { setPhase('loading'); void load(); }} />
        </div>
      ) : (
        <Dashboard
          me={me!}
          onMentor={(m) => setMe((prev) => (prev ? { ...prev, mentor: m } : prev))}
          reload={load}
          onSignedOut={() => { setMe(null); setPhase('signedOut'); }}
        />
      )}
    </div>
  );
}

function Dashboard({
  me, onMentor, reload, onSignedOut,
}: {
  me: ConsultantMe;
  onMentor: (m: ConsultantMentor) => void;
  reload: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const t = useTranslations('consultantPortal');
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('consultations');
  const [menuOpen, setMenuOpen] = useState(false);

  /* Public profile link — the page clients book from. slug is stable; pre-slug
     records fall back to the id (the public route resolves both). */
  const profilePath = `/${locale}/mentors/${me.mentor.slug ?? me.mentor.id}`;
  const [linkCopied, setLinkCopied] = useState(false);
  async function copyProfileLink() {
    const url = `${window.location.origin}${profilePath}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (http / older WebView) — legacy fallback.
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function signOut(forgetDevice: boolean) {
    setMenuOpen(false);
    try { await consultantService.logout(forgetDevice); } catch { /* ignore */ }
    onSignedOut();
  }

  const tabs: Array<{ key: Tab; label: string; icon: typeof Wallet }> = [
    { key: 'consultations', label: t('nav.consultations'), icon: CalendarDays },
    { key: 'availability', label: t('nav.availability'), icon: CalendarClock },
    { key: 'profile', label: t('nav.profile'), icon: User },
    { key: 'earnings', label: t('nav.earnings'), icon: TrendingUp },
    { key: 'wallet', label: t('nav.wallet'), icon: Wallet },
  ];

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col">
      {/* App bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0D0D0D]/85 px-4 py-3 backdrop-blur-md">
        <AppLogo height={26} />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label={t('nav.signOut')}
              aria-expanded={menuOpen}
              className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white">
              <LogOut className="size-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#161616] p-1 shadow-xl shadow-black/40">
                  <button type="button" onClick={() => void signOut(false)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-white/80 transition-colors hover:bg-white/[0.06]">
                    <LogOut className="size-4 text-white/50" /> {t('nav.signOut')}
                  </button>
                  <button type="button" onClick={() => void signOut(true)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-white/80 transition-colors hover:bg-white/[0.06]">
                    <ShieldOff className="size-4 text-white/50" /> {t('nav.forgetDevice')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        {/* Approval-status notice — self-signups awaiting / refused review.
            Legacy mentors have no approvalStatus and never see this. */}
        {me.mentor.approvalStatus === 'PENDING' && (
          <div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] px-4 py-3">
            <p className="text-sm font-semibold text-amber-300">{t('approval.pendingTitle')}</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-200/70">{t('approval.pendingBody')}</p>
          </div>
        )}
        {me.mentor.approvalStatus === 'REJECTED' && (
          <div className="mb-4 rounded-2xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3">
            <p className="text-sm font-semibold text-red-300">{t('approval.rejectedTitle')}</p>
            <p className="mt-1 text-xs leading-relaxed text-red-200/70">
              {me.mentor.approvalRejectionReason?.trim() || t('approval.rejectedBody')}
            </p>
          </div>
        )}

        {/* Phone not verified — tap-through to the SMS OTP page. Shown for any
            consultant with a phone on file that hasn't been SMS-verified. */}
        {Boolean(me.mentor.phone) && me.mentor.phoneVerified !== true && (
          <a
            href="/mentordashboard/verify-phone"
            className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] px-4 py-3 transition-colors hover:bg-amber-400/[0.14]"
          >
            <MessageSquareText className="size-4 shrink-0 text-amber-300" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-amber-300">{t('phoneVerify.bannerTitle')}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-amber-200/70">{t('phoneVerify.bannerBody')}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-amber-300/70 rtl:rotate-180" />
          </a>
        )}

        {/* Account hero */}
        <div className="relative mb-6 overflow-hidden rounded-3xl border border-white/[0.08] p-5" style={{ backgroundImage: CP_GLOW }}>
          <div className="flex items-center gap-3">
            <Avatar name={me.mentor.fullName} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{me.mentor.fullName}</p>
              <p className="truncate text-xs text-white/45">{me.mentor.position}</p>
            </div>
          </div>

          {/* Public profile link — clients book from this page. */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void copyProfileLink()}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-start transition-colors hover:bg-white/[0.08]"
            >
              <Link2 className="size-3.5 shrink-0" style={{ color: CP_GREEN }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-white/40">
                  {t('publicLink.label')}
                </span>
                <span className="block truncate text-xs text-white/75" dir="ltr">
                  {profilePath}
                </span>
              </span>
              {linkCopied ? (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: CP_GREEN }}>
                  <Check className="size-3.5" /> {t('publicLink.copied')}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-white/50">
                  <Copy className="size-3.5" /> {t('publicLink.copy')}
                </span>
              )}
            </button>
            {me.mentor.approvalStatus === 'PENDING' && (
              <p className="mt-1.5 text-[11px] text-amber-300/80">{t('publicLink.pendingHint')}</p>
            )}
          </div>

          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-wider text-white/45">{t('withdrawals.availableLabel')}</p>
            <p className="mt-1 text-[34px] font-bold leading-none tracking-tight tabular-nums text-white">
              {fmtDZD(me.wallet.availableBalance)}
            </p>
            <p className="mt-2 text-xs text-white/45">
              {t('withdrawals.pendingLabel')}: <span className="tabular-nums text-white/70">{fmtDZD(me.wallet.pendingBalance)}</span>
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <QuickAction icon={<ArrowUpRight className="size-3.5" />} label={t('hero.withdraw')} onClick={() => setTab('wallet')} />
            <QuickAction icon={<CalendarClock className="size-3.5" />} label={t('hero.editHours')} onClick={() => setTab('availability')} />
          </div>
        </div>

        {/* Active section */}
        {tab === 'consultations' && <BookingsSection mentorId={me.mentor.id} />}
        {tab === 'availability' && <AvailabilityEditor mentor={me.mentor} onSaved={onMentor} />}
        {tab === 'profile' && <ProfileSection mentor={me.mentor} onSaved={onMentor} />}
        {tab === 'earnings' && <EarningsSection />}
        {tab === 'wallet' && <WalletSection wallet={me.wallet} onChange={reload} />}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t border-white/[0.07] bg-[#0D0D0D]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="grid grid-cols-5">
          {tabs.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key} type="button" onClick={() => setTab(key)} aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-1 py-2.5"
              >
                <span className={cn('grid h-8 w-12 place-items-center rounded-full transition-colors',
                  active ? 'bg-[#30a735]/15' : '')}>
                  <Icon className={cn('size-5 transition-colors', active ? '' : 'text-white/40')}
                    style={active ? { color: CP_GREEN } : undefined} />
                </span>
                <span className={cn('text-[10px] font-medium transition-colors', active ? 'text-white' : 'text-white/40')}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/[0.1] active:scale-[0.98]"
    >
      <span style={{ color: CP_GREEN }}>{icon}</span>
      {label}
    </button>
  );
}
