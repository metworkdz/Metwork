'use client';

/**
 * Consultant self-service portal.
 *
 * One light, Calendly-style surface across the whole auth state machine:
 *  - Signed out (loading / PIN-unlock) — light brand-system surface.
 *  - Signed in — the redesigned dashboard: a desktop sidebar (lg+) and a
 *    mobile bottom tab bar (below lg), sharing one set of section components
 *    (BookingsSection, AvailabilityEditor, ProfileSection, EarningsSection,
 *    WalletSection) styled responsively.
 *
 * All data flows through the flag-gated, requireConsultant-guarded
 * /api/consultant/* endpoints. No client storage.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight, BadgeCheck, Building2, CalendarClock, CalendarDays, Check, ChevronRight, Copy, FileSignature, GraduationCap, Link2, Loader2, LogOut,
  MessageSquareText, Share2, ShieldOff, TrendingUp, User, Wallet,
} from 'lucide-react';
import { consultantService, type ConsultantContract, type ConsultantMe, type ConsultantMentor } from '@/services/consultant.service';
import { cn } from '@/lib/utils';
import { PinUnlock } from './portal/pin-unlock';
import { AvailabilityEditor } from './portal/availability-editor';
import { BookingsSection } from './portal/bookings-section';
import { ProfileSection } from './portal/profile-section';
import { EarningsSection } from './portal/earnings-section';
import { WalletSection } from './portal/wallet-section';
import { SpacesSection } from './portal/spaces-section';
import { ProgramsSection } from './portal/programs-section';
import { ContractSection } from './portal/contract-section';
import { LanguageSwitcher } from './portal/language-switcher';
import { AppLogo, Avatar, CP_GREEN, CP_GREEN_TEXT, CP_LIGHT_BORDER, CP_LIGHT_MUTED, fmtDZD } from './portal/shared';

type Tab = 'consultations' | 'programs' | 'spaces' | 'availability' | 'profile' | 'earnings' | 'wallet' | 'contract';

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

  if (phase === 'signedIn' && me) {
    return (
      <div dir="auto" className="min-h-[100dvh] bg-[#FAFAFA] text-[#0D0D0D] antialiased">
        <Dashboard
          me={me}
          onMentor={(m) => setMe((prev) => (prev ? { ...prev, mentor: m } : prev))}
          reload={load}
          onSignedOut={() => { setMe(null); setPhase('signedOut'); }}
        />
      </div>
    );
  }

  return (
    <div dir="auto" className="relative min-h-[100dvh] overflow-hidden bg-[#FAFAFA] text-[#0D0D0D] antialiased">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-dot-grid opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] hero-glow" />
      {phase === 'loading' ? (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4" style={{ color: '#8A918E' }}>
          <AppLogo tone="light" height={30} />
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="flex justify-end px-4 pt-4 sm:px-6">
            <LanguageSwitcher tone="light" />
          </div>
          <PinUnlock onUnlocked={() => { setPhase('loading'); void load(); }} />
        </>
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

  /* Commission contracts. Fetched once here rather than inside the section so
     the banner and the tab always agree about whether one is outstanding. A
     failure is silent: a contract the consultant cannot fetch must not break
     the rest of their dashboard. */
  const [contracts, setContracts] = useState<ConsultantContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const loadContracts = useCallback(async () => {
    try {
      setContracts((await consultantService.contracts()).contracts);
    } catch {
      setContracts([]);
    } finally {
      setContractsLoading(false);
    }
  }, []);
  useEffect(() => { void loadContracts(); }, [loadContracts]);
  const pendingContract = contracts.find((c) => c.status === 'PENDING_SIGNATURE') ?? null;

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
    { key: 'programs', label: t('nav.programs'), icon: GraduationCap },
    { key: 'spaces', label: t('nav.spaces'), icon: Building2 },
    { key: 'availability', label: t('nav.availability'), icon: CalendarClock },
    { key: 'profile', label: t('nav.profile'), icon: User },
    { key: 'earnings', label: t('nav.earnings'), icon: TrendingUp },
    { key: 'wallet', label: t('nav.wallet'), icon: Wallet },
  ];
  // The tab appears only once a contract exists. A consultant who has never
  // been sent one has nothing to look at, and an always-present empty tab
  // would just add a dead end to the nav.
  if (contracts.length > 0) {
    tabs.push({ key: 'contract', label: t('nav.contract'), icon: FileSignature });
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1360px] lg:items-start">
      {/* Desktop sidebar (lg+) */}
      <aside
        className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-9 border-e px-4 py-6 lg:flex"
        style={{ borderColor: CP_LIGHT_BORDER }}
      >
        <div className="flex items-center gap-2 px-2">
          <AppLogo tone="light" height={24} />
        </div>

        <nav className="flex flex-col gap-1">
          {tabs.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key} type="button" onClick={() => setTab(key)} aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-start text-sm font-medium transition-colors',
                  active ? 'font-semibold' : 'text-[#5A615E] hover:bg-[#F7F8F9]',
                )}
                style={active ? { background: '#E6F5EA', color: CP_GREEN_TEXT } : undefined}
              >
                <Icon className="size-[18px]" />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 border-t pt-4" style={{ borderColor: CP_LIGHT_BORDER }}>
          <Avatar name={me.mentor.fullName} size={34} variant="solid" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#0D0D0D]">{me.mentor.fullName}</p>
            <p className="truncate text-xs" style={{ color: CP_LIGHT_MUTED }}>{me.mentor.position || t('nav.profile')}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* App bar */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-[#FAFAFA]/90 px-4 py-3 backdrop-blur-md lg:px-10"
          style={{ borderColor: CP_LIGHT_BORDER }}
        >
          <div className="lg:hidden">
            <AppLogo tone="light" height={24} />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher tone="light" />
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label={t('nav.signOut')}
                aria-expanded={menuOpen}
                className="grid size-9 place-items-center rounded-full border text-[#5A615E] transition-colors hover:bg-[#F7F8F9] hover:text-[#0D0D0D]"
                style={{ borderColor: CP_LIGHT_BORDER }}>
                <LogOut className="size-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border bg-white p-1 shadow-xl shadow-black/10"
                    style={{ borderColor: CP_LIGHT_BORDER }}>
                    <button type="button" onClick={() => void signOut(false)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-[#0D0D0D] transition-colors hover:bg-[#F7F8F9]">
                      <LogOut className="size-4 text-[#8A918E]" /> {t('nav.signOut')}
                    </button>
                    <button type="button" onClick={() => void signOut(true)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-[#0D0D0D] transition-colors hover:bg-[#F7F8F9]">
                      <ShieldOff className="size-4 text-[#8A918E]" /> {t('nav.forgetDevice')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-4 lg:mx-auto lg:w-full lg:max-w-4xl lg:px-10 lg:py-10 lg:pb-10">
          {/* Approval-status notice — self-signups awaiting / refused review.
              Legacy mentors have no approvalStatus and never see this. */}
          {me.mentor.approvalStatus === 'PENDING' && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">{t('approval.pendingTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-700/80">{t('approval.pendingBody')}</p>
            </div>
          )}
          {me.mentor.approvalStatus === 'REJECTED' && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">{t('approval.rejectedTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-red-700/70">
                {me.mentor.approvalRejectionReason?.trim() || t('approval.rejectedBody')}
              </p>
            </div>
          )}

          {/* Approved confirmation — self-signups only (a permanent green banner
              would be noise for legacy admin-added mentors). */}
          {me.mentor.source === 'SELF' && me.mentor.approvalStatus === 'APPROVED' && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <BadgeCheck className="size-5 shrink-0" style={{ color: CP_GREEN_TEXT }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: CP_GREEN_TEXT }}>{t('approval.approvedTitle')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#5A615E]">{t('approval.approvedBody')}</p>
              </div>
            </div>
          )}

          {/* Phone not verified — tap-through to the SMS OTP page. Shown for any
              consultant with a phone on file that hasn't been SMS-verified. */}
          {Boolean(me.mentor.phone) && me.mentor.phoneVerified !== true && (
            <a
              href="/mentordashboard/verify-phone"
              className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100/60"
            >
              <MessageSquareText className="size-4 shrink-0 text-amber-700" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-amber-800">{t('phoneVerify.bannerTitle')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-amber-700/80">{t('phoneVerify.bannerBody')}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-amber-700/70 rtl:rotate-180" />
            </a>
          )}

          {/* Contract awaiting signature. Sits above the hero because it is the
              one thing on this screen that blocks getting paid — and it links
              into the tab rather than opening a modal, so the consultant can
              read the whole document before committing to anything. */}
          {pendingContract && tab !== 'contract' && (
            <button
              type="button"
              onClick={() => setTab('contract')}
              className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-start transition-colors hover:bg-amber-100/60"
            >
              <FileSignature className="size-4 shrink-0 text-amber-700" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-amber-800">{t('contract.bannerTitle')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-amber-700/80">{t('contract.bannerBody')}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-amber-700/70 rtl:rotate-180" />
            </button>
          )}

          {/* Account hero */}
          <div className="mb-6 overflow-hidden rounded-3xl border bg-white p-5 lg:p-6" style={{ borderColor: CP_LIGHT_BORDER }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={me.mentor.fullName} size={44} variant="solid" />
                <div className="min-w-0">
                  <p className="truncate text-base font-bold tracking-tight text-[#0D0D0D]">{me.mentor.fullName}</p>
                  <p className="truncate text-sm" style={{ color: CP_LIGHT_MUTED }}>{me.mentor.position}</p>
                </div>
              </div>

              {/* Public profile link — clients book from this page. */}
              <div className="lg:w-[340px] lg:shrink-0">
                <button
                  type="button"
                  onClick={() => void copyProfileLink()}
                  className="flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors hover:bg-[#F7F8F9]"
                  style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}
                >
                  <Link2 className="size-3.5 shrink-0" style={{ color: CP_GREEN }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-wider" style={{ color: CP_LIGHT_MUTED }}>
                      {t('publicLink.label')}
                    </span>
                    <span className="block truncate text-xs text-[#0D0D0D]" dir="ltr">
                      {profilePath}
                    </span>
                  </span>
                  {linkCopied ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: CP_GREEN_TEXT }}>
                      <Check className="size-3.5" /> {t('publicLink.copied')}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ background: CP_GREEN }}>
                      <Copy className="size-3.5" /> {t('publicLink.copy')}
                    </span>
                  )}
                </button>
                {/* Share on WhatsApp — the channel every consultant already uses. */}
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${t('publicLink.shareMessage')} ${typeof window !== 'undefined' ? window.location.origin : ''}${profilePath}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-[#F7F8F9]"
                  style={{ borderColor: CP_LIGHT_BORDER, color: CP_GREEN_TEXT }}
                >
                  <Share2 className="size-4" /> {t('publicLink.shareWhatsApp')}
                </a>
                {me.mentor.approvalStatus === 'PENDING' && (
                  <p className="mt-1.5 text-[11px] text-amber-700">{t('publicLink.pendingHint')}</p>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 border-t pt-5 lg:max-w-sm" style={{ borderColor: CP_LIGHT_BORDER }}>
              <div>
                <p className="text-[11px] uppercase tracking-wider" style={{ color: CP_LIGHT_MUTED }}>{t('withdrawals.availableLabel')}</p>
                <p className="mt-1 text-[26px] font-bold leading-none tracking-tight tabular-nums" style={{ color: CP_GREEN_TEXT }}>
                  {fmtDZD(me.wallet.availableBalance)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider" style={{ color: CP_LIGHT_MUTED }}>{t('withdrawals.pendingLabel')}</p>
                <p className="mt-1 text-[26px] font-bold leading-none tracking-tight tabular-nums text-[#0D0D0D]">
                  {fmtDZD(me.wallet.pendingBalance)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <QuickAction icon={<ArrowUpRight className="size-3.5" />} label={t('hero.withdraw')} onClick={() => setTab('wallet')} />
              <QuickAction icon={<CalendarClock className="size-3.5" />} label={t('hero.editHours')} onClick={() => setTab('availability')} />
            </div>
          </div>

          {/* Active section */}
          {tab === 'consultations' && <BookingsSection mentorId={me.mentor.id} />}
          {tab === 'programs' && <ProgramsSection />}
          {tab === 'spaces' && <SpacesSection />}
          {tab === 'availability' && <AvailabilityEditor mentor={me.mentor} onSaved={onMentor} />}
          {tab === 'profile' && <ProfileSection mentor={me.mentor} onSaved={onMentor} />}
          {tab === 'earnings' && <EarningsSection />}
          {tab === 'wallet' && <WalletSection wallet={me.wallet} onChange={reload} />}
          {tab === 'contract' && (
            <ContractSection contracts={contracts} loading={contractsLoading} onChanged={loadContracts} />
          )}
        </main>

        {/* Bottom tab bar (mobile only, below lg) */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
          style={{ borderColor: CP_LIGHT_BORDER }}
        >
          {/* Column count is derived from the tab list, not hardcoded: a fixed
              `grid-cols-N` silently wraps to a second row the moment a tab is
              added, which is exactly what happened when Spaces landed. */}
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key} type="button" onClick={() => setTab(key)} aria-current={active ? 'page' : undefined}
                  className="flex min-w-0 flex-col items-center gap-1 px-0.5 py-2.5"
                >
                  <span className={cn('grid h-8 w-11 place-items-center rounded-full transition-colors',
                    active ? '' : '')} style={active ? { background: '#E6F5EA' } : undefined}>
                    <Icon className="size-5 transition-colors" style={{ color: active ? CP_GREEN_TEXT : '#8A918E' }} />
                  </span>
                  <span
                    className="w-full truncate text-center text-[9px] font-medium leading-tight transition-colors"
                    style={{ color: active ? '#0D0D0D' : '#8A918E' }}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium text-[#0D0D0D] transition-colors hover:bg-[#F7F8F9] active:scale-[0.98]"
      style={{ borderColor: CP_LIGHT_BORDER }}
    >
      <span style={{ color: CP_GREEN }}>{icon}</span>
      {label}
    </button>
  );
}
