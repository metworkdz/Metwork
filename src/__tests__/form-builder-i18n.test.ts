/**
 * The builder's File upload strings must exist in all three languages, and the
 * hint must carry the {max} placeholder the component fills in.
 */
import { describe, it, expect } from 'vitest';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';
import ar from '@/i18n/messages/ar.json';

type Bundle = { formBuilder: Record<string, string> };

describe.each([['en', en], ['fr', fr], ['ar', ar]] as const)('formBuilder (%s)', (_name, bundle) => {
  const fb = (bundle as unknown as Bundle).formBuilder;
  it('labels the File upload type', () => {
    expect(fb.typeFile?.trim()).toBeTruthy();
  });
  it('explains the limit and keeps the {max} placeholder', () => {
    expect(fb.fileHint).toContain('{max}');
  });
});
