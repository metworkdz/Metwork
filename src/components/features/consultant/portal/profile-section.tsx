'use client';

/**
 * Profile editor — bio, expertise topics, the live per-hour rate, the
 * free-intro toggle, and the instant-book meeting defaults. The hourly rate
 * writes the canonical `consultationFee` (same field the admin form writes and
 * the charge engine reads). Saves via PATCH /api/consultant/profile.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileText, ImageUp, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantMentor } from '@/services/consultant.service';
import { cn } from '@/lib/utils';
import {
  BrandButton, CP_GREEN, ErrorBanner, Field, GhostButton, SectionCard, SectionHeading, cpInputClass,
  uploadConsultantFile,
} from './shared';

export function ProfileSection({ mentor, onSaved }: { mentor: ConsultantMentor; onSaved: (m: ConsultantMentor) => void }) {
  const t = useTranslations('consultantPortal.profile');

  const [phone, setPhone] = useState(mentor.phone ?? '');
  const [city, setCity] = useState(mentor.city ?? '');
  const [bio, setBio] = useState(mentor.bio ?? '');
  const [topics, setTopics] = useState<string[]>(mentor.topics ?? []);
  const [topicDraft, setTopicDraft] = useState('');
  const [fee, setFee] = useState(
    mentor.consultationFee && mentor.consultationFee > 0 ? String(mentor.consultationFee) : '',
  );
  const [freeIntro, setFreeIntro] = useState(Boolean(mentor.freeIntroEnabled));
  const [mode, setMode] = useState<'ONLINE' | 'OFFLINE'>(mentor.defaultMeetingMode ?? 'ONLINE');
  const [link, setLink] = useState(mentor.defaultMeetingLink ?? '');
  const [address, setAddress] = useState(mentor.defaultMeetingAddress ?? '');
  const [mapsLink, setMapsLink] = useState(mentor.defaultMeetingMapsLink ?? '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Avatar / CV self-upload (non-blocking: a failed upload only shows an
     error — the profile fields and record are never touched). */
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(mentor.imageUrl ?? '');
  const [cvUrl, setCvUrl] = useState(mentor.cvUrl ?? '');
  const [uploading, setUploading] = useState<'avatar' | 'cv' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload(kind: 'avatar' | 'cv', file: File | undefined) {
    if (!file) return;
    setUploading(kind); setUploadError(null);
    try {
      const url = await uploadConsultantFile(file, kind);
      if (kind === 'avatar') setAvatarUrl(url);
      else setCvUrl(url);
      onSaved({ ...mentor, ...(kind === 'avatar' ? { imageUrl: url } : { cvUrl: url }) });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setUploading(null);
      // Allow re-selecting the same file after a failure.
      if (kind === 'avatar' && avatarInputRef.current) avatarInputRef.current.value = '';
      if (kind === 'cv' && cvInputRef.current) cvInputRef.current.value = '';
    }
  }

  function addTopic() {
    const v = topicDraft.trim();
    if (!v) return;
    if (!topics.some((x) => x.toLowerCase() === v.toLowerCase()) && topics.length < 20) {
      setTopics((prev) => [...prev, v]);
    }
    setTopicDraft('');
  }

  async function save() {
    // Phone is mandatory for the consultant — it's the WhatsApp recipient.
    if (!phone.trim()) { setError(t('phoneRequired')); return; }
    setSaving(true); setSaved(false); setError(null);
    try {
      const { mentor: updated } = await consultantService.updateProfile({
        phone: phone.trim(),
        city: city.trim() || null,
        bio: bio.trim() || null,
        topics,
        consultationFee: fee === '' ? 0 : Math.max(0, Math.round(Number(fee))),
        freeIntroEnabled: freeIntro,
        defaultMeetingMode: mode,
        defaultMeetingLink: mode === 'ONLINE' ? (link.trim() || null) : null,
        defaultMeetingAddress: mode === 'OFFLINE' ? (address.trim() || null) : null,
        defaultMeetingMapsLink: mode === 'OFFLINE' ? (mapsLink.trim() || null) : null,
      });
      onSaved(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiClientError ? (e.message || t('errorGeneric')) : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <SectionHeading title={t('aboutHeading')} />
      <SectionCard className="space-y-5">
        {/* Avatar + CV self-upload */}
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- portal avatar preview, arbitrary remote/dev-upload source */}
          <img
            src={avatarUrl || '/assets/profilelogogreen.png'}
            alt={mentor.fullName}
            className="size-16 shrink-0 rounded-2xl border border-white/10 object-cover"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <input
              ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              onChange={(e) => void handleUpload('avatar', e.target.files?.[0])}
              className="hidden" aria-hidden
            />
            <input
              ref={cvInputRef} type="file" accept="application/pdf"
              onChange={(e) => void handleUpload('cv', e.target.files?.[0])}
              className="hidden" aria-hidden
            />
            <div className="flex flex-wrap gap-2">
              <GhostButton
                type="button" disabled={uploading !== null}
                onClick={() => avatarInputRef.current?.click()}
              >
                {uploading === 'avatar'
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <ImageUp className="size-3.5" />} {t('uploadPhoto')}
              </GhostButton>
              <GhostButton
                type="button" disabled={uploading !== null}
                onClick={() => cvInputRef.current?.click()}
              >
                {uploading === 'cv'
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <FileText className="size-3.5" />} {cvUrl ? t('replaceCv') : t('uploadCv')}
              </GhostButton>
            </div>
            <p className="text-[11px] text-white/40">
              {cvUrl ? t('cvOnFile') : t('uploadHint')}
            </p>
          </div>
        </div>
        {uploadError && <ErrorBanner message={uploadError} />}

        {/* Contact — phone is mandatory (WhatsApp recipient) + public city */}
        <Field label={t('phoneLabel')} hint={t('phoneHint')} htmlFor="cp-phone">
          <input
            id="cp-phone" type="tel" inputMode="tel" value={phone} dir="ltr"
            onChange={(e) => setPhone(e.target.value)} placeholder={t('phonePlaceholder')} disabled={saving}
            className={cpInputClass}
          />
        </Field>
        <Field label={t('cityLabel')} hint={t('cityHint')} htmlFor="cp-city">
          <input
            id="cp-city" type="text" value={city} maxLength={120}
            onChange={(e) => setCity(e.target.value)} placeholder={t('cityPlaceholder')} disabled={saving}
            className={cpInputClass}
          />
        </Field>

        {/* Bio */}
        <Field label={t('bioLabel')} hint={t('bioHint')} htmlFor="cp-bio">
          <textarea
            id="cp-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)}
            placeholder={t('bioPlaceholder')} disabled={saving}
            className={`${cpInputClass} h-auto resize-none py-2`}
          />
        </Field>

        {/* Topics */}
        <Field label={t('topicsLabel')} hint={t('topicsHint')}>
          <div className="flex flex-wrap gap-1.5">
            {topics.length === 0 && <span className="text-xs text-white/35">{t('topicsEmpty')}</span>}
            {topics.map((tp) => (
              <span key={tp} className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-xs text-white/85">
                {tp}
                <button type="button" onClick={() => setTopics((prev) => prev.filter((x) => x !== tp))}
                  className="text-white/40 hover:text-white" aria-label="remove">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
              placeholder={t('topicsPlaceholder')} disabled={saving} className={`${cpInputClass} h-9`}
            />
            <button type="button" onClick={addTopic} disabled={saving}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 text-white/70 hover:text-white">
              <Plus className="size-4" />
            </button>
          </div>
        </Field>

        {/* Hourly rate — the live fee clients are charged (pro-rated by duration) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/45">{t('ratesHeading')}</p>
          <p className="text-[11px] text-white/40">{t('ratesHint')}</p>
          <Field label={t('hourlyRateLabel')} htmlFor="cp-fee">
            <input id="cp-fee" type="number" inputMode="numeric" min={0} value={fee} dir="ltr"
              onChange={(e) => setFee(e.target.value)} disabled={saving} className={cpInputClass} placeholder="0" />
          </Field>
        </div>

        {/* Free intro */}
        <button
          type="button" onClick={() => setFreeIntro((v) => !v)} disabled={saving}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-start"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="size-4" style={{ color: CP_GREEN }} />
            <span>
              <span className="block text-sm font-medium text-white">{t('freeIntroLabel')}</span>
              <span className="block text-[11px] text-white/45">{t('freeIntroHint')}</span>
            </span>
          </span>
          <span className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            freeIntro ? '' : 'bg-white/15')}
            style={freeIntro ? { backgroundColor: CP_GREEN } : undefined}>
            <span className={cn('inline-block size-5 transform rounded-full bg-white transition-transform',
              freeIntro ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
          </span>
        </button>

        {/* Meeting defaults */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/45">{t('meetingHeading')}</p>
          <p className="text-[11px] text-white/40">{t('hint')}</p>
          <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(['ONLINE', 'OFFLINE'] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => setMode(m)} disabled={saving}
                className={cn('min-h-9 rounded-lg px-4 text-xs font-medium transition-colors',
                  mode === m ? 'text-[#04130b]' : 'text-white/60 hover:text-white')}
                style={mode === m ? { backgroundColor: CP_GREEN } : undefined}
              >
                {m === 'ONLINE' ? t('modeOnline') : t('modeOffline')}
              </button>
            ))}
          </div>
          {mode === 'ONLINE' ? (
            <Field label={t('linkLabel')} htmlFor="cp-def-link">
              <input id="cp-def-link" type="url" value={link} dir="ltr"
                onChange={(e) => setLink(e.target.value)} placeholder={t('linkPlaceholder')} disabled={saving}
                className={cpInputClass} />
            </Field>
          ) : (
            <>
              <Field label={t('addressLabel')} hint={t('addressHint')} htmlFor="cp-def-address">
                <input id="cp-def-address" type="text" value={address} maxLength={500}
                  onChange={(e) => setAddress(e.target.value)} placeholder={t('addressPlaceholder')} disabled={saving}
                  className={cpInputClass} />
              </Field>
              <Field label={t('mapsLabel')} htmlFor="cp-def-maps">
                <input id="cp-def-maps" type="url" value={mapsLink} dir="ltr"
                  onChange={(e) => setMapsLink(e.target.value)} placeholder={t('mapsPlaceholder')} disabled={saving}
                  className={cpInputClass} />
              </Field>
            </>
          )}
        </div>

        {error && <ErrorBanner message={error} />}
        <div className="flex items-center gap-3">
          <BrandButton onClick={save} loading={saving} className="px-5">{t('saveProfile')}</BrandButton>
          {saved && (
            <span className="flex items-center gap-1 text-xs" style={{ color: CP_GREEN }}>
              <CheckCircle2 className="size-3.5" /> {t('savedProfile')}
            </span>
          )}
        </div>
      </SectionCard>
    </section>
  );
}
