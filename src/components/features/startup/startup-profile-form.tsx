'use client';

/**
 * Startup-profile editor for entrepreneurs.
 * Creates or updates the founder's startup listing via the real API.
 *
 *   No existing listing → POST /api/startups   (creates, returns id)
 *   Existing listing    → PATCH /api/startups/:id
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  MAX_PITCH_DECK_BYTES,
  MAX_PITCH_DECK_MB,
  PITCH_DECK_MIME,
} from '@/lib/upload-limits';
import type { StartupMaturityStage } from '@/types/startup';

const INDUSTRIES = [
  'AI / ML',
  'HealthTech',
  'FinTech',
  'Logistics',
  'E-commerce',
  'EdTech',
  'AgriTech',
  'CleanTech',
  'SaaS',
  'Media',
  'Other',
];

const MATURITY_STAGES: StartupMaturityStage[] = [
  'IDEA',
  'PROTOTYPE_MVP',
  'PRE_SEED',
  'SEED',
  'SERIES_A',
  'GROWTH',
];

/** Cloudinary's response to a direct (browser → Cloudinary) upload. */
interface CloudinaryUploadResult {
  secure_url?: string;
  error?:      { message?: string };
}

interface SignatureResponse {
  mode:       'direct' | 'proxy';
  uploadUrl?: string;
  apiKey?:    string;
  timestamp?: number;
  publicId?:  string;
  signature?: string;
}

export interface StartupProfileFormState {
  /** DB id — null when the startup doesn't exist yet. */
  id:            string | null;
  name:          string;
  description:   string;
  industry:      string;
  fundingGoal:   string; // string in form, parsed on submit
  equityOffered: string; // string in form, parsed on submit
  valuation:     string; // optional, empty string = null
  /** Null until the founder actively picks one — no default is pre-selected. */
  maturityStage: StartupMaturityStage | null;
  pitchDeckUrl:  string | null;
  websiteUrl:    string; // optional, empty string = null
  status:        'DRAFT' | 'ACTIVE' | 'CLOSED';
}

export function StartupProfileForm({ initial }: { initial: StartupProfileFormState }) {
  const t = useTranslations('startup.profileForm');
  const [values, setValues] = useState<StartupProfileFormState>(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [deckBusy, setDeckBusy] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

  function update<K extends keyof StartupProfileFormState>(key: K, val: StartupProfileFormState[K]) {
    setFeedback(null);
    setValues((v) => ({ ...v, [key]: val }));
  }

  /**
   * Reads our API's `{ error: { message } }` envelope. Falls back to a generic
   * message rather than surfacing a raw status code.
   */
  async function readApiError(res: Response, fallback: string): Promise<string> {
    const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return d.error?.message ?? fallback;
  }

  /**
   * Pitch decks upload straight to Cloudinary with a signature minted by our
   * API, instead of streaming through the API route. Vercel Functions reject
   * request bodies over 4.5 MB and drop the connection mid-upload, which the
   * browser reports as a bare "Failed to fetch" — a deck of any realistic size
   * could never have made it through. Only the resulting file reference comes
   * back to us. See src/app/api/startups/[id]/pitch-deck/signature/route.ts.
   */
  function onPitchDeckSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !values.id) return;

    const startupId = values.id;
    setDeckError(null);

    if (file.type !== PITCH_DECK_MIME) {
      setDeckError(t('errorPitchDeckType'));
      return;
    }
    if (file.size > MAX_PITCH_DECK_BYTES) {
      setDeckError(t('errorPitchDeckSize', { max: MAX_PITCH_DECK_MB }));
      return;
    }

    setDeckBusy(true);

    (async () => {
      try {
        // 1. Ask our API to authorise this upload.
        const signRes = await fetch(`/api/startups/${startupId}/pitch-deck/signature`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: file.size, mimeType: file.type }),
        });
        if (!signRes.ok) throw new Error(await readApiError(signRes, t('errorPitchDeckUpload')));
        const signed = await signRes.json() as SignatureResponse;

        let confirmBody: BodyInit;
        let confirmHeaders: HeadersInit | undefined;

        if (signed.mode === 'direct') {
          // 2. Send the bytes to Cloudinary directly — never through our function.
          const fd = new FormData();
          // The filename is deliberately extensionless: for a raw upload
          // Cloudinary appends the filename's extension to our public_id, and
          // an asset ending in `.pdf` is blocked (401) on delivery while the
          // account's "Allow delivery of PDF and ZIP files" setting is off.
          // See src/server/startups/pitch-deck.ts.
          fd.append('file', file, 'pitch-deck');
          fd.append('api_key', signed.apiKey!);
          fd.append('timestamp', String(signed.timestamp));
          fd.append('public_id', signed.publicId!);
          fd.append('signature', signed.signature!);

          let cloudRes: Response;
          try {
            cloudRes = await fetch(signed.uploadUrl!, { method: 'POST', body: fd });
          } catch {
            // Genuine network-level failure (offline, connection dropped).
            throw new Error(t('errorPitchDeckNetwork'));
          }
          const cloudBody = await cloudRes.json().catch(() => ({})) as CloudinaryUploadResult;
          if (!cloudRes.ok || !cloudBody.secure_url) {
            console.error('[pitch-deck] Cloudinary upload rejected:', cloudRes.status, cloudBody.error?.message);
            throw new Error(t('errorPitchDeckService'));
          }

          // 3. Hand the reference back so our API can verify and persist it.
          //    Both values are re-validated server-side before anything is saved.
          confirmBody = JSON.stringify({ publicId: signed.publicId, secureUrl: cloudBody.secure_url });
          confirmHeaders = { 'Content-Type': 'application/json' };
        } else {
          // Cloudinary unconfigured (local dev): post the file to our own route,
          // which writes it to public/uploads.
          const fd = new FormData();
          fd.append('file', file);
          confirmBody = fd;
        }

        const res = await fetch(`/api/startups/${startupId}/pitch-deck`, {
          method: 'POST',
          credentials: 'include',
          headers: confirmHeaders,
          body: confirmBody,
        });
        if (!res.ok) throw new Error(await readApiError(res, t('errorPitchDeckUpload')));

        const data = await res.json() as { url: string };
        setValues((v) => ({ ...v, pitchDeckUrl: data.url }));
      } catch (err) {
        // `fetch` rejects with "Failed to fetch" on network-level failures —
        // never show that raw string; it tells the founder nothing.
        const message = err instanceof Error && err.message && !/failed to fetch/i.test(err.message)
          ? err.message
          : t('errorPitchDeckNetwork');
        setDeckError(message);
      } finally {
        setDeckBusy(false);
      }
    })();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const fundingGoal   = parseInt(values.fundingGoal, 10);
    const equityOffered = parseFloat(values.equityOffered);
    const valuation     = values.valuation ? parseInt(values.valuation, 10) : null;
    const websiteUrl    = values.websiteUrl.trim() ? values.websiteUrl.trim() : null;

    if (isNaN(fundingGoal) || fundingGoal < 100_000) {
      setFeedback({ ok: false, text: t('errorFundingGoal') });
      return;
    }
    if (isNaN(equityOffered) || equityOffered < 0.1 || equityOffered > 100) {
      setFeedback({ ok: false, text: t('errorEquityOffered') });
      return;
    }
    if (!values.maturityStage) {
      setFeedback({ ok: false, text: t('errorMaturityStage') });
      return;
    }
    if (websiteUrl && !isValidUrl(websiteUrl)) {
      setFeedback({ ok: false, text: t('errorWebsiteUrl') });
      return;
    }

    const body = {
      name:          values.name.trim(),
      description:   values.description.trim(),
      industry:      values.industry,
      fundingGoal,
      equityOffered,
      valuation,
      maturityStage: values.maturityStage,
      websiteUrl,
      status:        values.status,
    };

    startTransition(async () => {
      try {
        let res: Response;
        if (values.id) {
          // Update existing listing.
          res = await fetch(`/api/startups/${values.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          });
        } else {
          // Create new listing.
          res = await fetch('/api/startups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          });
        }

        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          if (d.error?.message?.includes('membership')) {
            setFeedback({ ok: false, text: t('errorMembershipRequired') });
          } else {
            setFeedback({ ok: false, text: d.error?.message ?? t('errorSaveFailed') });
          }
          return;
        }

        const data = await res.json() as { startup?: { id: string }; id?: string };
        const newId = data.startup?.id ?? data.id;
        if (newId && !values.id) {
          setValues((v) => ({ ...v, id: newId }));
        }
        setFeedback({ ok: true, text: t('savedSuccessfully') });
      } catch {
        setFeedback({ ok: false, text: t('errorNetwork') });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('basicInfoTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('startupNameLabel')} htmlFor="su-name" required>
            <Input
              id="su-name"
              value={values.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={t('startupNamePlaceholder')}
              required
            />
          </Field>

          <Field label={t('industryLabel')} htmlFor="su-industry">
            <Select
              value={values.industry}
              onValueChange={(v) => update('industry', v)}
            >
              <SelectTrigger id="su-industry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('fundingGoalLabel')} htmlFor="su-funding">
            <Input
              id="su-funding"
              type="number"
              min={100_000}
              step={1}
              inputMode="numeric"
              value={values.fundingGoal}
              onChange={(e) => update('fundingGoal', e.target.value)}
              placeholder={t('fundingGoalPlaceholder')}
            />
          </Field>

          <Field label={t('equityOfferedLabel')} htmlFor="su-equity">
            <Input
              id="su-equity"
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              inputMode="decimal"
              value={values.equityOffered}
              onChange={(e) => update('equityOffered', e.target.value)}
              placeholder={t('equityOfferedPlaceholder')}
            />
          </Field>

          <Field label={t('valuationLabel')} htmlFor="su-val">
            <Input
              id="su-val"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.valuation}
              onChange={(e) => update('valuation', e.target.value)}
              placeholder={t('valuationPlaceholder')}
            />
          </Field>

          <Field label={t('maturityStageLabel')} htmlFor="su-stage" required>
            <Select
              value={values.maturityStage ?? undefined}
              onValueChange={(v) => update('maturityStage', v as StartupMaturityStage)}
            >
              <SelectTrigger id="su-stage">
                <SelectValue placeholder={t('maturityStagePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {MATURITY_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>{t(`stage${stage}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('websiteUrlLabel')} htmlFor="su-website">
            <Input
              id="su-website"
              type="url"
              value={values.websiteUrl}
              onChange={(e) => update('websiteUrl', e.target.value)}
              placeholder={t('websiteUrlPlaceholder')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pitchTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label={t('descriptionLabel')} htmlFor="su-desc" required>
            <textarea
              id="su-desc"
              value={values.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={6}
              className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">{values.description.length}/2000</p>
          </Field>

          <div className="mt-4">
            <Label htmlFor="su-deck">{t('pitchDeckLabel')}</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {values.pitchDeckUrl && (
                <a
                  href={values.pitchDeckUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  <FileText className="size-4" />
                  {t('pitchDeckOnFile')}
                </a>
              )}
              <Label
                htmlFor="su-deck"
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted ${!values.id || deckBusy ? 'pointer-events-none opacity-50' : ''}`}
              >
                <Upload className="size-4" />
                {deckBusy ? t('pitchDeckUploading') : values.pitchDeckUrl ? t('pitchDeckReplace') : t('pitchDeckUpload')}
              </Label>
              <input
                id="su-deck"
                type="file"
                accept="application/pdf"
                className="sr-only"
                disabled={!values.id || deckBusy}
                onChange={onPitchDeckSelected}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {values.id ? t('pitchDeckHint', { max: MAX_PITCH_DECK_MB }) : t('pitchDeckRequiresSave')}
            </p>
            {deckError && <p className="mt-1 text-xs text-destructive">{deckError}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('visibilityTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t('showInMarketplace')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('marketplaceDescription')}
            </p>
          </div>
          <Select
            value={values.status}
            onValueChange={(v) => update('status', v as 'DRAFT' | 'ACTIVE' | 'CLOSED')}
          >
            <SelectTrigger className="w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">{t('statusDraft')}</SelectItem>
              <SelectItem value="ACTIVE">{t('statusActive')}</SelectItem>
              <SelectItem value="CLOSED">{t('statusClosed')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {feedback && (
          <p className={`text-sm ${feedback.ok ? 'text-emerald-600' : 'text-destructive'}`}>
            {feedback.text}
          </p>
        )}
        {values.id && (
          <Badge variant="outline" className="text-xs">
            {t('idPrefix')}: {values.id.slice(0, 8)}…
          </Badge>
        )}
        <Button type="submit" loading={pending}>
          {values.id ? t('saveChanges') : t('createListing')}
        </Button>
      </div>
    </form>
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
