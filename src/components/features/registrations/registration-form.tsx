'use client';

/**
 * RegistrationForm — the public registration flow for a program or event.
 *
 * ONE QUESTION PER SCREEN. The previous version rendered every field in a
 * single column; with the default eleven-question application that is a wall of
 * inputs on a phone, which is where nearly all of this traffic arrives (the
 * link gets shared on WhatsApp). Each step now asks one thing, validates it
 * before moving on, and shows how far along you are.
 *
 * PAID LISTINGS TAKE MONEY. A paid program used to be registered for free
 * here — the row was written, the seat was taken, a "registration confirmed"
 * email went out, and nobody ever paid. A paid listing now ends on a payment
 * step that creates a card intent (`POST /api/bookings/card`) carrying the
 * answers; the seat and the registration row are created at settlement. A free
 * listing behaves exactly as it always did.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { resolveListingPricing } from '@/lib/listing-price';
import { questionLabel, questionOptions } from '@/lib/registration-question';
import { computeClientDeposit } from '@/lib/deposit';
import { safeUUID } from '@/lib/safe-uuid';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { CashDepositType, PaymentMethod, RegistrationFormField } from '@/types/domain';

interface RegistrationFormProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  entityTitle: string;
  formFields: RegistrationFormField[];
  /** Pre-fill from logged-in user session. */
  prefill?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  /** Is someone signed in? Decides whether a paid listing is reachable here. */
  isAuthed?: boolean;
  /**
   * Whether a guest may pay for THIS kind of listing without an account.
   * Guest checkout is programs-only (`guestCheckoutAllowedFor`); a paid EVENT
   * needs a Metwork account, so we say so BEFORE the questions rather than
   * walking someone through the whole form and refusing at the payment step.
   */
  guestCheckoutAllowed?: boolean;
  /** Path to return to after signing in. */
  signInNext?: string;
  /** Pricing + payment config. Absent/zero ⇒ the free flow, unchanged. */
  pricing?: {
    price: number;
    onlinePrice?: number | null;
    cashPrice?: number | null;
    acceptedPaymentMethods?: PaymentMethod[] | null;
    cashDepositType?: CashDepositType | null;
    cashDepositValue?: number | null;
  };
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  answers: Record<string, string | string[]>;
}

type SubmitResult =
  | { type: 'confirmed' }
  | { type: 'waitlisted' }
  | { type: 'alreadyRegistered' }
  | { type: 'error'; message: string };

type Step =
  | { kind: 'identity' }
  | { kind: 'question'; field: RegistrationFormField }
  | { kind: 'payment' };

export function RegistrationForm({
  entityType,
  entityId,
  entityTitle,
  formFields,
  prefill,
  pricing,
  isAuthed = false,
  guestCheckoutAllowed = true,
  signInNext,
}: RegistrationFormProps) {
  const t = useTranslations('registration');
  // Seeded questions carry a `defaultQuestions` key, so they render in the
  // VISITOR's language. Host-written ones are text and stay exactly as typed.
  const tq = useTranslations('defaultQuestions');
  const locale = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLDivElement>(null);
  /** Idempotency key for the card intent — stable across retries. */
  const payRef = useRef<string>('');

  const [form, setForm] = useState<FormState>({
    fullName: prefill?.fullName ?? '',
    email: prefill?.email ?? '',
    phone: prefill?.phone ?? '',
    answers: {},
  });

  /* ── Pricing ───────────────────────────────────────────────────────────── */

  const resolved = useMemo(
    () => resolveListingPricing(pricing?.price ?? 0, pricing),
    [pricing],
  );
  const methods = pricing?.acceptedPaymentMethods?.length
    ? pricing.acceptedPaymentMethods
    : (['ONLINE'] as PaymentMethod[]);
  const hasDeposit = pricing?.cashDepositType != null && pricing?.cashDepositValue != null;
  const isPaid = resolved.online > 0 || resolved.cash > 0;
  const takesCash = isPaid && methods.includes('CASH');
  // Cash WITH a deposit goes through the card checkout (there is something to
  // charge). Cash with NO deposit is a reservation: the host collects the whole
  // amount on site, which plenty of them want and which used to be impossible
  // to even configure. Both are "cash" to the visitor; only the mechanics differ.
  const cashOffered = takesCash && hasDeposit;
  const cashOnSiteOffered = takesCash && !hasDeposit;
  const onlineOffered = isPaid && methods.includes('ONLINE');
  const showMethodPicker = onlineOffered && (cashOffered || cashOnSiteOffered);
  // A paid listing this visitor cannot pay for as a guest. Nothing they type
  // could succeed, so the form is replaced by a sign-in prompt rather than
  // ending in a 401 after eleven questions.
  const needsAccount = isPaid && !isAuthed && !guestCheckoutAllowed;

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    methods.includes('ONLINE') ? 'ONLINE' : 'CASH',
  );
  const method: PaymentMethod = showMethodPicker
    ? paymentMethod
    : onlineOffered
      ? 'ONLINE'
      : 'CASH';
  const isCash = method === 'CASH';
  // A promo priced against the other surface must not linger. The input is
  // remounted (key={method}) so its own "applied" chip clears with it.
  const [promo, setPromo] = useState<PromoResult | null>(null);
  useEffect(() => {
    setPromo(null);
  }, [method]);

  /** Cash with nothing to charge online — a reservation, settled on site. */
  const isCashOnSite = isCash && cashOnSiteOffered;
  const total = isCash ? resolved.cash : resolved.online;
  const deposit = isCash
    ? computeClientDeposit(total, pricing?.cashDepositType, pricing?.cashDepositValue)
    : null;
  // Nothing is charged now for a pay-on-site reservation; the whole amount is
  // due at the door, so the summary must not claim a payment is happening.
  /** After any promo. The server re-applies it; this is the preview. */
  const payable = promo?.finalAmount ?? total;
  const discount = promo?.discountAmount ?? 0;
  const promoDeposit = isCash
    ? computeClientDeposit(payable, pricing?.cashDepositType, pricing?.cashDepositValue)
    : null;
  const dueNow = isCashOnSite ? 0 : (promoDeposit ?? payable);
  const dueOnSite = isCashOnSite
    ? payable
    : promoDeposit != null
      ? Math.max(0, payable - promoDeposit)
      : 0;
  void deposit;

  // A new method or promo means a new intent — don't replay the previous key.
  useEffect(() => {
    payRef.current = '';
  }, [method, promo?.code]);

  /* ── Steps ─────────────────────────────────────────────────────────────── */

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: 'identity' }];
    for (const field of formFields) list.push({ kind: 'question', field });
    if (isPaid && (onlineOffered || cashOffered || cashOnSiteOffered)) list.push({ kind: 'payment' });
    return list;
  }, [formFields, isPaid, onlineOffered, cashOffered, cashOnSiteOffered]);

  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const isLast = stepIndex >= steps.length - 1;

  /* ── State helpers ─────────────────────────────────────────────────────── */

  function setField(key: keyof Omit<FormState, 'answers'>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function setAnswer(fieldId: string, value: string | string[]) {
    setForm((prev) => ({ ...prev, answers: { ...prev.answers, [fieldId]: value } }));
    setFieldErrors((prev) => ({ ...prev, [fieldId]: '' }));
  }

  function toggleCheckbox(fieldId: string, option: string) {
    const current = (form.answers[fieldId] as string[]) ?? [];
    setAnswer(
      fieldId,
      current.includes(option) ? current.filter((v) => v !== option) : [...current, option],
    );
  }

  /** Validate only the step on screen — errors stay next to what caused them. */
  const validateStep = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (step.kind === 'identity') {
      if (!form.fullName.trim()) errors.fullName = t('errorRequired');
      if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        errors.email = t('errorInvalidEmail');
      if (!form.phone.trim() || form.phone.trim().length < 6)
        errors.phone = t('errorInvalidPhone');
    } else if (step.kind === 'question' && step.field.required) {
      const val = form.answers[step.field.id];
      const missing = !val || (Array.isArray(val) ? val.length === 0 : !String(val).trim());
      if (missing) errors[step.field.id] = t('errorRequired');
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [step, form, t]);

  function goBack() {
    setFieldErrors({});
    setResult(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  // Move the heading into view and announce the new step. Without this a phone
  // keyboard can leave the next question scrolled off the top of the screen.
  useEffect(() => {
    headingRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stepIndex]);

  /* ── Submission ────────────────────────────────────────────────────────── */

  function collectAnswers() {
    return formFields.map((f) => ({
      fieldId: f.id,
      value:
        form.answers[f.id] ??
        (['CHECKBOX', 'MULTIPLE_CHOICE'].includes(f.type) ? [] : ''),
    }));
  }

  /** Free listing — the original no-payment path, untouched. */
  function submitFree() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/registrations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            entityId,
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            phone: form.phone.trim(),
            answers: collectAnswers(),
            locale,
            ...(isCashOnSite ? { paymentMethod: 'CASH' as const } : {}),
          }),
        });

        const data = (await res.json()) as {
          registration?: { status: string };
          alreadyRegistered?: boolean;
          error?: { code?: string; message?: string };
          code?: string;
          message?: string;
        };
        // The API wraps failures as { error: { code, message } }; older paths
        // returned them flat. Read both so a real message never gets swallowed.
        const message = data.error?.message ?? data.message;

        if (!res.ok) {
          if (res.status === 429) setResult({ type: 'error', message: t('errorRateLimited') });
          else if (res.status === 409)
            setResult({ type: 'error', message: message ?? t('errorDeadlinePassed') });
          else setResult({ type: 'error', message: message ?? t('errorGeneric') });
          return;
        }

        if (data.alreadyRegistered) {
          setResult({ type: 'alreadyRegistered' });
          return;
        }
        setResult({
          type: data.registration?.status === 'WAITLISTED' ? 'waitlisted' : 'confirmed',
        });
      } catch {
        setResult({ type: 'error', message: t('errorNetwork') });
      }
    });
  }

  /** Paid listing — create the card intent and hand off to hosted checkout. */
  function submitPaid() {
    if (!payRef.current) payRef.current = safeUUID();
    startTransition(async () => {
      try {
        const res = await bookingService.createCardBooking({
          target:
            entityType === 'PROGRAM'
              ? { itemKind: 'PROGRAM', programId: entityId }
              : { itemKind: 'EVENT', eventId: entityId },
          paymentMode: isCash ? 'CASH_DEPOSIT' : 'ONLINE_FULL',
          customer: {
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            phone: form.phone.trim(),
          },
          clientReference: payRef.current,
          registrationAnswers: collectAnswers(),
          promoCode: promo?.code,
          locale,
        });
        // Leave the SPA for the hosted-checkout pay page.
        window.location.assign(res.payPath);
      } catch (err) {
        setResult({ type: 'error', message: mapPayError(err) });
      }
    });
  }

  function mapPayError(err: unknown): string {
    if (err instanceof ApiClientError) {
      if (err.code === 'CAPACITY_EXCEEDED') return t('errorFull');
      if (err.code === 'DEADLINE_PASSED') return t('errorDeadlinePassed');
      if (err.code === 'EVENT_PASSED') return t('errorDeadlinePassed');
      if (err.code === 'ALREADY_BOOKED') return t('alreadyBody');
      if (err.code === 'RATE_LIMITED') return t('errorRateLimited');
      if (err.code === 'LOGIN_REQUIRED') return t('errorLoginRequired');
      return err.message || t('errorPaymentFailed');
    }
    return t('errorPaymentFailed');
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!validateStep()) return;
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }
    // A pay-on-site reservation charges nothing, so it takes the registration
    // route (which records the amount owed) rather than the card checkout.
    if (step.kind === 'payment' && !isCashOnSite) submitPaid();
    else submitFree();
  }

  /* ── Terminal states ───────────────────────────────────────────────────── */

  if (needsAccount) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
        <LogIn className="mx-auto mb-3 size-8 text-muted-foreground/60" />
        <h3 className="text-base font-semibold">{t('accountRequiredTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('accountRequiredBody')}</p>
        <Button asChild className="mt-4 w-full" size="lg">
          <Link href={signInNext ? `/login?next=${encodeURIComponent(signInNext)}` : '/login'}>
            {t('signIn')}
          </Link>
        </Button>
      </div>
    );
  }

  if (result?.type === 'confirmed') {
    return (
      <Outcome
        tone="success"
        icon={<CheckCircle2 className="mx-auto size-10 text-emerald-600" />}
        title={t('successTitle')}
        body={t('successBody', { title: entityTitle })}
        note={t('successEmail', { email: form.email })}
      />
    );
  }

  if (result?.type === 'waitlisted') {
    return (
      <Outcome
        tone="warning"
        icon={<Clock className="mx-auto size-10 text-amber-600" />}
        title={t('waitlistTitle')}
        body={t('waitlistBody')}
      />
    );
  }

  if (result?.type === 'alreadyRegistered') {
    return (
      <Outcome
        tone="info"
        icon={<CheckCircle2 className="mx-auto size-10 text-blue-600" />}
        title={t('alreadyTitle')}
        body={t('alreadyBody')}
      />
    );
  }

  /* ── The flow ──────────────────────────────────────────────────────────── */

  const progress = ((stepIndex + 1) / steps.length) * 100;

  return (
    <form onSubmit={handleNext} className="flex flex-col gap-5" noValidate>
      {/* Progress — how much is left is the single best predictor of finishing */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('stepCounter', { current: stepIndex + 1, total: steps.length })}</span>
          {step.kind === 'question' && !step.field.required && (
            <span className="rounded-full bg-muted px-2 py-0.5">{t('optionalLabel')}</span>
          )}
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div ref={headingRef} className="scroll-mt-24">
        {step.kind === 'identity' && (
          <IdentityStep
            form={form}
            errors={fieldErrors}
            onChange={setField}
            title={t('stepIdentityTitle')}
            hint={t('stepIdentityHint')}
            labels={{
              fullName: t('fieldFullName'),
              email: t('fieldEmail'),
              phone: t('fieldPhone'),
              phFullName: t('placeholderFullName'),
              phEmail: t('placeholderEmail'),
              phPhone: t('placeholderPhone'),
            }}
          />
        )}

        {step.kind === 'question' && (
          <QuestionStep
            key={step.field.id}
            field={step.field}
            label={questionLabel(step.field, tq)}
            options={questionOptions(step.field, tq)}
            value={form.answers[step.field.id]}
            error={fieldErrors[step.field.id]}
            onChange={(v) => setAnswer(step.field.id, v)}
            onToggle={(opt) => toggleCheckbox(step.field.id, opt)}
            selectPlaceholder={t('selectPlaceholder')}
            multiHint={t('multiHint')}
          />
        )}

        {step.kind === 'payment' && (
          <PaymentStep
            title={t('paymentTitle')}
            showPicker={showMethodPicker}
            method={method}
            onMethod={setPaymentMethod}
            locale={locale}
            total={total}
            dueNow={dueNow}
            dueOnSite={dueOnSite}
            discount={discount}
            isCashOnSite={isCashOnSite}
            promoSlot={
              <PromoCodeInput
                key={method}
                originalAmount={total}
                onApplied={setPromo}
                disabled={isPending}
              />
            }
            labels={{
              card: t('payByCard'),
              cardDesc: t('payByCardDesc'),
              cash: t('payInCash'),
              cashDesc: cashOnSiteOffered ? t('payInCashOnSiteDesc') : t('payInCashDesc'),
              total: t('summaryTotal'),
              dueNow: t('summaryDueNow'),
              dueOnSite: t('summaryDueOnSite'),
              discount: t('promoDiscount'),
              feeNote: t('cardFeeNote'),
              onSiteNote: t('onSiteNote'),
              secure: t('secureNote'),
            }}
          />
        )}
      </div>

      {result?.type === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {result.message}
        </div>
      )}

      {/* Actions — padded for the iOS home indicator so the CTA is never
          half-hidden behind it on a phone. */}
      <div className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)]">
        <Button type="submit" className="w-full" size="lg" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t('submitting')}
            </>
          ) : !isLast ? (
            t('next')
          ) : step.kind === 'payment' ? (
            isCashOnSite
              ? t('reserveCta')
              : t('payCta', { amount: formatCurrency(dueNow, locale) })
          ) : (
            t('submit')
          )}
        </Button>

        {stepIndex > 0 && (
          <button
            type="button"
            onClick={goBack}
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t('back')}
          </button>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">{t('privacyNote')}</p>
    </form>
  );
}

/* ─────────────────────────── Steps ─────────────────────────── */

function StepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold leading-snug tracking-tight text-balance">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function IdentityStep({
  form,
  errors,
  onChange,
  title,
  hint,
  labels,
}: {
  form: FormState;
  errors: Record<string, string>;
  onChange: (key: 'fullName' | 'email' | 'phone', value: string) => void;
  title: string;
  hint: string;
  labels: Record<string, string>;
}) {
  return (
    <div>
      <StepHeading title={title} hint={hint} />
      <div className="flex flex-col gap-4">
        <Labelled label={labels.fullName!} error={errors.fullName} htmlFor="reg-name" required>
          <Input
            id="reg-name"
            value={form.fullName}
            onChange={(e) => onChange('fullName', e.target.value)}
            placeholder={labels.phFullName}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            error={!!errors.fullName}
          />
        </Labelled>
        <Labelled label={labels.email!} error={errors.email} htmlFor="reg-email" required>
          <Input
            id="reg-email"
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => onChange('email', e.target.value)}
            placeholder={labels.phEmail}
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            error={!!errors.email}
          />
        </Labelled>
        <Labelled label={labels.phone!} error={errors.phone} htmlFor="reg-phone" required>
          <Input
            id="reg-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => onChange('phone', e.target.value)}
            placeholder={labels.phPhone}
            autoComplete="tel"
            enterKeyHint="done"
            error={!!errors.phone}
          />
        </Labelled>
      </div>
    </div>
  );
}

function QuestionStep({
  field,
  label,
  options,
  value,
  error,
  onChange,
  onToggle,
  selectPlaceholder,
  multiHint,
}: {
  field: RegistrationFormField;
  /** Already resolved for this visitor — see `@/lib/registration-question`. */
  label: string;
  options: string[] | null;
  value: string | string[] | undefined;
  error?: string;
  onChange: (v: string | string[]) => void;
  onToggle: (opt: string) => void;
  selectPlaceholder: string;
  multiHint: string;
}) {
  const stringValue = typeof value === 'string' ? value : '';
  const arrayValue = Array.isArray(value) ? value : [];
  const inputId = `q-${field.id}`;

  return (
    <div>
      <StepHeading
        title={label}
        hint={field.type === 'CHECKBOX' ? multiHint : undefined}
      />

      {(field.type === 'SHORT_TEXT' || field.type === 'PHONE' || field.type === 'EMAIL') && (
        <Input
          id={inputId}
          autoFocus
          type={field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : 'text'}
          inputMode={field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : undefined}
          autoCapitalize={field.type === 'EMAIL' ? 'off' : undefined}
          autoCorrect={field.type === 'EMAIL' ? 'off' : undefined}
          enterKeyHint="next"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          error={!!error}
        />
      )}

      {field.type === 'URL' && (
        <Input
          id={inputId}
          autoFocus
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="https://…"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          error={!!error}
        />
      )}

      {field.type === 'LONG_TEXT' && (
        <Textarea
          id={inputId}
          autoFocus
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="min-h-32"
        />
      )}

      {field.type === 'DROPDOWN' && options && (
        <select
          id={inputId}
          autoFocus
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:text-sm"
        >
          <option value="">{selectPlaceholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {field.type === 'MULTIPLE_CHOICE' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <ChoiceRow
              key={opt}
              selected={stringValue === opt}
              onSelect={() => onChange(opt)}
              type="radio"
              name={field.id}
              label={opt}
            />
          ))}
        </div>
      )}

      {field.type === 'CHECKBOX' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <ChoiceRow
              key={opt}
              selected={arrayValue.includes(opt)}
              onSelect={() => onToggle(opt)}
              type="checkbox"
              name={field.id}
              label={opt}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A choice as a full-width pressable row. The old markup put a 16px native
 * control inside a bare label — a target well under the 44px minimum, and the
 * hardest thing on the form to hit while walking.
 */
function ChoiceRow({
  selected,
  onSelect,
  type,
  name,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  type: 'radio' | 'checkbox';
  name: string;
  label: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors',
        selected
          ? 'border-primary bg-primary/5 font-medium text-foreground'
          : 'border-border hover:border-primary/40',
      )}
    >
      <input
        type={type}
        name={name}
        value={label}
        checked={selected}
        onChange={onSelect}
        className="size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  );
}

function PaymentStep({
  title,
  showPicker,
  method,
  onMethod,
  locale,
  total,
  dueNow,
  dueOnSite,
  discount,
  isCashOnSite,
  promoSlot,
  labels,
}: {
  title: string;
  showPicker: boolean;
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  locale: Locale;
  total: number;
  dueNow: number;
  dueOnSite: number;
  discount: number;
  /** Nothing is charged now — the whole amount is settled on site. */
  isCashOnSite: boolean;
  promoSlot: React.ReactNode;
  labels: Record<string, string>;
}) {
  return (
    <div>
      <StepHeading title={title} />

      {showPicker && (
        <div className="mb-4 grid gap-2">
          <MethodCard
            selected={method === 'ONLINE'}
            onSelect={() => onMethod('ONLINE')}
            icon={<CreditCard className="size-4 shrink-0" />}
            title={labels.card!}
            description={labels.cardDesc!}
          />
          <MethodCard
            selected={method === 'CASH'}
            onSelect={() => onMethod('CASH')}
            icon={<Banknote className="size-4 shrink-0" />}
            title={labels.cash!}
            description={labels.cashDesc!}
          />
        </div>
      )}

      {/* Promo code — above the summary so applying one visibly moves it. */}
      <div className="mb-3">{promoSlot}</div>

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{labels.total}</span>
          <span className="tabular-nums">{formatCurrency(total, locale)}</span>
        </div>
        {discount > 0 && (
          <div className="mt-1 flex items-center justify-between text-emerald-700">
            <span>{labels.discount}</span>
            <span className="tabular-nums">−{formatCurrency(discount, locale)}</span>
          </div>
        )}
        {!isCashOnSite && (
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>{labels.dueNow}</span>
            <span className="tabular-nums">{formatCurrency(dueNow, locale)}</span>
          </div>
        )}
        {dueOnSite > 0 && (
          <div
            className={cn(
              'flex items-center justify-between',
              isCashOnSite
                ? 'mt-2 border-t border-border/60 pt-2 text-base font-semibold'
                : 'mt-1 text-muted-foreground',
            )}
          >
            <span>{labels.dueOnSite}</span>
            <span className="tabular-nums">{formatCurrency(dueOnSite, locale)}</span>
          </div>
        )}
        {/* No card is charged for a pay-on-site reservation, so no card fee. */}
        <p className="mt-2 text-xs text-muted-foreground">
          {isCashOnSite ? labels.onSiteNote : labels.feeNote}
        </p>
      </div>

      {!isCashOnSite && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          {labels.secure}
        </p>
      )}
    </div>
  );
}

function MethodCard({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-lg border px-3.5 py-2.5 text-start transition-colors',
        selected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border text-muted-foreground hover:border-primary/40',
      )}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/* ─────────────────────────── Small pieces ─────────────────────────── */

function Labelled({
  label,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Outcome({
  tone,
  icon,
  title,
  body,
  note,
}: {
  tone: 'success' | 'warning' | 'info';
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string;
}) {
  const skin = {
    success: 'bg-green-50 border-green-200 text-green-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  }[tone];

  return (
    <div className={cn('rounded-xl border p-6 text-center', skin)}>
      <div className="mb-3">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm opacity-90">{body}</p>
      {note && <p className="mt-2 text-xs opacity-75">{note}</p>}
    </div>
  );
}
