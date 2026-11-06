'use client';

/**
 * The learner's road to the certificate, in the player sidebar: lessons
 * watched and quizzes passed, then the claim button, then the download.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Award, Download, Loader2, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';

interface Progress { lessonsTotal: number; lessonsDone: number; quizzesTotal: number; quizzesPassed: number; eligible: boolean }
interface Cert { id: string; number: string; issuedAt: string; verifyPath: string }

export function CertificateCard({ courseId }: { courseId: string }) {
  const t = useTranslations('academy.learning.certificate');
  const [data, setData] = useState<{ progress: Progress | null; certificate: Cert | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await apiClient.get(`/academy/learn/${courseId}/certificate`)); } catch { setData(null); }
  }, [courseId]);
  useEffect(() => { void load(); }, [load]);

  if (!data || (!data.progress && !data.certificate)) return null;
  const p = data.progress;

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ certificate: Cert }>(`/academy/learn/${courseId}/certificate`);
      setData((d) => (d ? { ...d, certificate: res.certificate } : d));
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['NAME_MISSING', 'NOT_ELIGIBLE', 'RATE_LIMITED'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border p-4">
      <p className="flex items-center gap-2 font-display font-extrabold"><Award className="size-5 text-primary" aria-hidden />{t('title')}</p>
      {data.certificate ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-muted-foreground">{t('issued', { number: data.certificate.number })}</p>
          <Button asChild size="sm" className="w-full">
            <a href={`/api/academy/certificates/${data.certificate.id}/pdf`}><Download className="me-1.5 size-4" aria-hidden />{t('download')}</a>
          </Button>
          <Link href={data.certificate.verifyPath} className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            <ShieldCheck className="size-3.5" aria-hidden />{t('verify')}
          </Link>
        </div>
      ) : p && (
        <div className="mt-3 space-y-2.5 text-sm">
          <Bar label={t('lessons', { done: p.lessonsDone, total: p.lessonsTotal })} done={p.lessonsDone} total={p.lessonsTotal} />
          {p.quizzesTotal > 0 && <Bar label={t('quizzes', { done: p.quizzesPassed, total: p.quizzesTotal })} done={p.quizzesPassed} total={p.quizzesTotal} />}
          {p.eligible ? (
            <Button size="sm" className="w-full" disabled={busy} onClick={claim}>{busy && <Loader2 className="me-1 size-4 animate-spin" />}{t('claim')}</Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('rule')}</p>
          )}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
