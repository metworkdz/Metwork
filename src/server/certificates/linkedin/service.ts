/**
 * Publishing a certificate on LinkedIn — what the share page shows and what
 * the OAuth callback publishes, from one resolver.
 *
 * Flow: certificate email → share page (the image and the ready-made text) →
 * « Publier sur LinkedIn » → LinkedIn's consent screen → callback, which
 * uploads the image and publishes the post as the participant, then lands
 * them back on the share page with a link to their post.
 *
 * One post per certificate, claimed before LinkedIn is called: a double
 * click, or the back button after publishing, never posts twice.
 */
import { db, type CertificateRecord } from '@/server/db/store';
import { normalizeEmailLang } from '@/server/notifications/email';

import { certificateVerifyUrl } from '../issue';
import { loadCertificateSetup, type CertificateSetup } from '../service';
import {
  createImagePost,
  fetchMember,
  postUrl,
  uploadImage,
  exchangeCode,
} from './api';
import { linkedInConfig, linkedInRedirectUri, parseCertificateShareToken } from './config';
import { renderCertificateShareImage } from './image';
import {
  buildPostSegments,
  LINKEDIN_COMMENTARY_MAX,
  toLittle,
  type PostLang,
  type PostSegment,
} from './post-text';

/** A claim older than this belongs to a request that died. */
const CLAIM_TTL_MS = 3 * 60_000;

export type ShareTarget =
  | {
      ok: true;
      certificate: CertificateRecord;
      setup: CertificateSetup;
      /** The participant's language — the post is written in it. */
      lang: PostLang;
      segments: PostSegment[];
      /** Already published: where the post is. */
      postUrl: string | null;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'REVOKED' | 'DISABLED' };

export async function resolveShareTarget(shareToken: string): Promise<ShareTarget> {
  const config = linkedInConfig();
  if (!config) return { ok: false, reason: 'DISABLED' };
  const certId = parseCertificateShareToken(shareToken);
  if (!certId) return { ok: false, reason: 'NOT_FOUND' };

  const d = await db.read();
  const cert = (d.certificates ?? []).find((c) => c.id === certId);
  if (!cert) return { ok: false, reason: 'NOT_FOUND' };
  // Valid exactly when the verification page says so — a certificate revoked
  // after it was emailed must not be published either.
  const reg = (d.registrations ?? []).find((r) => r.id === cert.registrationId);
  if (cert.revokedAt || reg?.status !== 'CONFIRMED' || reg.absent) return { ok: false, reason: 'REVOKED' };

  const owner = cert.mentorId
    ? { kind: 'MENTOR' as const, mentorId: cert.mentorId }
    : { kind: 'INCUBATOR' as const, incubatorId: cert.incubatorId ?? '' };
  const setup = await loadCertificateSetup(cert.programId, owner);
  if (!setup) return { ok: false, reason: 'NOT_FOUND' };

  const lang = normalizeEmailLang(reg.locale) as PostLang;
  const segments = buildPostSegments({
    lang,
    programTitle: cert.programTitle,
    organizer: cert.organizer,
    trainerName: setup.settings.trainerName ?? null,
    endDate: cert.endDate,
    verifyUrl: certificateVerifyUrl(cert.verifyToken),
    metwork: { name: config.organizationName, organizationId: config.organizationId },
  });

  return {
    ok: true,
    certificate: cert,
    setup,
    lang,
    segments,
    postUrl: cert.linkedinPostUrn ? postUrl(cert.linkedinPostUrn) : null,
  };
}

/** The image a share page previews — what LinkedIn will receive. */
export async function shareImage(shareToken: string): Promise<Buffer | null> {
  const target = await resolveShareTarget(shareToken);
  if (!target.ok) return null;
  return renderCertificateShareImage(target.setup, recipientOf(target.certificate));
}

function recipientOf(cert: CertificateRecord) {
  return {
    fullName: cert.fullName,
    civility: cert.civility ?? null,
    number: cert.number,
    verifyUrl: certificateVerifyUrl(cert.verifyToken),
  };
}

export type PublishResult =
  | { ok: true; postUrl: string; already: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'REVOKED' | 'DISABLED' | 'BUSY' | 'LINKEDIN_ERROR' };

/**
 * Called by the OAuth callback with LinkedIn's one-time code. The access
 * token lives only inside this call.
 */
export async function publishCertificateOnLinkedIn(shareToken: string, code: string): Promise<PublishResult> {
  const config = linkedInConfig();
  if (!config) return { ok: false, reason: 'DISABLED' };
  const target = await resolveShareTarget(shareToken);
  if (!target.ok) return target;
  if (target.postUrl) return { ok: true, postUrl: target.postUrl, already: true };

  const certId = target.certificate.id;
  const claim = await db.update<'CLAIMED' | 'BUSY' | 'DONE' | 'GONE'>((d) => {
    const c = (d.certificates ?? []).find((x) => x.id === certId);
    if (!c) return 'GONE';
    if (c.linkedinPostUrn) return 'DONE';
    if (c.linkedinClaimedAt && Date.now() - Date.parse(c.linkedinClaimedAt) < CLAIM_TTL_MS) return 'BUSY';
    c.linkedinClaimedAt = new Date().toISOString();
    return 'CLAIMED';
  });
  if (claim === 'GONE') return { ok: false, reason: 'NOT_FOUND' };
  if (claim === 'BUSY') return { ok: false, reason: 'BUSY' };
  if (claim === 'DONE') {
    const again = await resolveShareTarget(shareToken);
    return again.ok && again.postUrl ? { ok: true, postUrl: again.postUrl, already: true } : { ok: false, reason: 'BUSY' };
  }

  let postUrn: string | null = null;
  try {
    const commentary = toLittle(target.segments, config.organizationId);
    if (commentary.length > LINKEDIN_COMMENTARY_MAX) throw new Error('commentary too long');
    const token = await exchangeCode(config, code, linkedInRedirectUri());
    const member = await fetchMember(token);
    const authorUrn = `urn:li:person:${member.id}`;
    const png = await renderCertificateShareImage(target.setup, recipientOf(target.certificate));
    const imageUrn = await uploadImage(config, token, authorUrn, png);
    postUrn = await createImagePost(config, token, {
      authorUrn,
      commentary,
      imageUrn,
      altText: `${target.certificate.programTitle} — ${target.certificate.fullName}`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[linkedin] publish failed', certId, err instanceof Error ? err.message : err);
  }

  const now = new Date().toISOString();
  await db.update((d) => {
    const c = (d.certificates ?? []).find((x) => x.id === certId);
    if (!c) return;
    c.linkedinClaimedAt = null;
    if (postUrn) { c.linkedinPostUrn = postUrn; c.linkedinSharedAt = now; }
  });

  return postUrn ? { ok: true, postUrl: postUrl(postUrn), already: false } : { ok: false, reason: 'LINKEDIN_ERROR' };
}
