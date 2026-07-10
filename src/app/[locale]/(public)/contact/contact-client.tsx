'use client';

import { useState } from 'react';
import { Mail, Phone, MapPin, Send, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';

/* ─────────────────────────── Page (client body) ───────────────────────────
 * Rendered by the thin server wrapper in ./page.tsx, which owns the
 * landing-visibility notFound() gate (server-only — can't live here). */

export function ContactClient() {
  const t = useTranslations('pages.contact');

  return (
    <>
      {/* Header */}
      <section className="border-b border-border/60 bg-muted/20 py-14 sm:py-20">
        <Container size="sm">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-3 text-base text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
        </Container>
      </section>

      {/* Body */}
      <section className="py-14 sm:py-20">
        <Container size="sm">
          <div className="grid gap-8 lg:grid-cols-5">
            {/* Contact info — narrower column */}
            <div className="space-y-4 lg:col-span-2">
              <InfoItem
                icon={Phone}
                label={t('phone')}
                value={siteConfig.contact.phone}
                href={`tel:${siteConfig.contact.phone}`}
              />
              <InfoItem
                icon={Mail}
                label={t('email')}
                value={siteConfig.contact.email}
                href={`mailto:${siteConfig.contact.email}`}
              />
              <InfoItem
                icon={MapPin}
                label={t('address')}
                value={siteConfig.contact.address}
              />
              <WhatsAppButton
                label={t('whatsapp')}
                prefill={t('whatsappMessage')}
              />
            </div>

            {/* Form — wider column */}
            <div className="lg:col-span-3">
              <ContactForm />
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

/* ─────────────────────────── Info item ─────────────────────────── */

function InfoItem({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {href ? (
            <a
              href={href}
              className="mt-0.5 break-words text-sm font-medium text-foreground hover:text-primary-600 hover:underline"
            >
              {value}
            </a>
          ) : (
            <p className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── WhatsApp ───────────────────────────
 * External link (raw <a> is correct for off-site URLs). Reuses the shared
 * Button via asChild; standard WhatsApp brand green (#25D366) is intentional
 * for this recognized third-party mark. In RTL the flex row mirrors so the
 * glyph leads on the correct (right) side automatically. */

function WhatsAppButton({ label, prefill }: { label: string; prefill: string }) {
  const href = `https://wa.me/213670109105?text=${encodeURIComponent(prefill)}`;
  return (
    <Button
      asChild
      className="w-full bg-[#25D366] text-white shadow-sm hover:bg-[#1EBE57] active:bg-[#1AAB4E]"
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon />
        {label}
      </a>
    </Button>
  );
}

function WhatsAppIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.876 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/* ─────────────────────────── Form ─────────────────────────── */

type FormState = 'idle' | 'submitting' | 'success' | 'error';

interface FieldError {
  name?: string;
  email?: string;
  message?: string;
}

function ContactForm() {
  const t = useTranslations('pages.contact');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setServerError(null);
    setState('submitting');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });

      if (res.status === 422) {
        const data = await res.json() as { error?: { details?: { fieldErrors?: FieldError } } };
        setFieldErrors(data.error?.details?.fieldErrors ?? {});
        setState('idle');
        return;
      }

      if (!res.ok) {
        setServerError(t('serverError'));
        setState('error');
        return;
      }

      setState('success');
    } catch {
      setServerError(t('networkError'));
      setState('error');
    }
  }

  if (state === 'success') {
    return (
      <Card className="border-border/60">
        <CardContent className="flex flex-col items-center py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="size-7 text-emerald-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{t('successTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('successDesc')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-6"
            onClick={() => {
              setName('');
              setEmail('');
              setMessage('');
              setState('idle');
            }}
          >
            {t('sendAnother')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardContent className="p-6">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">{t('fieldName')}</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              autoComplete="name"
              disabled={state === 'submitting'}
              error={!!fieldErrors.name}
            />
            {fieldErrors.name && (
              <p className="text-xs text-destructive">{t('errorName')}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">{t('fieldEmail')}</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('fieldEmailPlaceholder')}
              autoComplete="email"
              disabled={state === 'submitting'}
              error={!!fieldErrors.email}
            />
            {fieldErrors.email && (
              <p className="text-xs text-destructive">{t('errorEmail')}</p>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-message">{t('fieldMessage')}</Label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder={t('fieldMessagePlaceholder')}
              disabled={state === 'submitting'}
              className={cn(
                'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
                'placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'disabled:cursor-not-allowed disabled:opacity-50',
                fieldErrors.message && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            {fieldErrors.message && (
              <p className="text-xs text-destructive">{t('errorMessage')}</p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" loading={state === 'submitting'}>
            <Send className="size-4" />
            {state === 'submitting' ? t('submitting') : t('sendMessage')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
