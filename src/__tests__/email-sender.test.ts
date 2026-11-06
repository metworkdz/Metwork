import { describe, it, expect } from 'vitest';
import { senderAddress } from '@/server/notifications/email';

describe('senderAddress — inboxes show « Metwork », not « noreply »', () => {
  it('names a bare address', () => {
    expect(senderAddress('noreply@metwork.dz')).toBe('Metwork <noreply@metwork.dz>');
  });
  it('falls back to the default mailbox, named', () => {
    expect(senderAddress(undefined)).toBe('Metwork <noreply@metwork.dz>');
    expect(senderAddress('  ')).toBe('Metwork <noreply@metwork.dz>');
  });
  it('keeps an address that already carries a name', () => {
    expect(senderAddress('Metwork Academy <academy@metwork.dz>')).toBe('Metwork Academy <academy@metwork.dz>');
  });
});
