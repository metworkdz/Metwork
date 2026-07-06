'use client';

/**
 * 6-digit OTP input rendered as six large boxes (login, signup and phone
 * verification all share it). One digit per box, auto-advance, backspace
 * moves back, pasting a full code fills every box. Always LTR — digits read
 * left-to-right even in the Arabic portal.
 *
 * The value is plain controlled state (a 0–6 char digit string), so the
 * parent keeps the exact same submit logic as the old single-field input.
 */
import { useRef } from 'react';

const LENGTH = 6;

export function OtpCodeInput({
  value,
  onChange,
  disabled,
  label,
  idPrefix = 'otp',
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Accessible name announced for the group and each box. */
  label: string;
  idPrefix?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function setDigit(index: number, digit: string) {
    const chars = value.split('');
    while (chars.length < index) chars.push('');
    chars[index] = digit;
    onChange(chars.join('').replace(/\D/g, '').slice(0, LENGTH));
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) { setDigit(index, ''); return; }
    if (digits.length > 1) {
      // Multi-char input (paste or fast typing) — fill from this box onward.
      const next = (value.slice(0, index) + digits).replace(/\D/g, '').slice(0, LENGTH);
      onChange(next);
      refs.current[Math.min(next.length, LENGTH - 1)]?.focus();
      return;
    }
    setDigit(index, digits);
    if (index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
      const chars = value.split('');
      chars[index - 1] = '';
      onChange(chars.join(''));
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!digits) return;
    e.preventDefault();
    onChange(digits);
    refs.current[Math.min(digits.length, LENGTH - 1)]?.focus();
  }

  return (
    <div role="group" aria-label={label} dir="ltr" className="flex justify-center gap-2">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          id={`${idPrefix}-${i}`}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={LENGTH /* allow paste of the full code into any box */}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          aria-label={`${label} ${i + 1}/${LENGTH}`}
          className="h-14 w-11 rounded-2xl border border-white/15 bg-white/[0.045] text-center text-2xl font-semibold text-white transition-colors focus-visible:border-[#30a735]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30a735]/30 disabled:opacity-50"
        />
      ))}
    </div>
  );
}
