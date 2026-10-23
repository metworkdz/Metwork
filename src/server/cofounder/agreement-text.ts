/**
 * The cofounder agreement text (French), rendered from the agreed terms and
 * both identities. Frozen into the record when the agreement goes to
 * signature: what the PDF shows is exactly what both people read.
 *
 * Scope, stated in the text itself: a private agreement between founders
 * BEFORE incorporation. It does not replace the company statutes, which in
 * Algeria are drawn up before a notary. Have a lawyer review this template
 * before relying on it.
 */
import { getCityName } from '@/config/cities';
import type { CofounderAgreementIdentity, CofounderAgreementTerms } from '@/server/db/store';

const COMMITMENT_FR: Record<string, string> = {
  FULL_TIME: 'à temps plein',
  PART_TIME: 'à temps partiel',
  EVENINGS: 'en soirée et le week-end',
};

const fmtDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : ymd;
};

export interface AgreementParty {
  userId: string;
  identity: CofounderAgreementIdentity;
}

export function renderAgreementText(terms: CofounderAgreementTerms, parties: [AgreementParty, AgreementParty]): string {
  const [a, b] = parties;
  const who = (p: AgreementParty, n: number) =>
    `Fondateur ${n} : ${p.identity.legalName}, né(e) le ${fmtDate(p.identity.birthDate)}, titulaire de la pièce d'identité n° ${p.identity.idNumber}, demeurant ${p.identity.address}.`;
  const role = (p: AgreementParty) => terms.roles[p.userId]?.trim() || '—';
  const commit = (p: AgreementParty) => COMMITMENT_FR[terms.commitments[p.userId] ?? ''] ?? '—';
  const pct = (p: AgreementParty) => terms.equity[p.userId] ?? 0;
  const court = getCityName(terms.jurisdiction, 'fr');

  return [
    'ACCORD ENTRE COFONDATEURS',
    `Projet « ${terms.projectName} »`,
    '',
    'Entre les soussignés :',
    who(a, 1),
    who(b, 2),
    'ci-après ensemble « les Fondateurs ».',
    '',
    'Article 1 — Objet',
    `Les Fondateurs s'associent pour développer le projet « ${terms.projectName} » : ${terms.projectDescription.trim()}`,
    'Le présent accord fixe leurs engagements réciproques en vue de la constitution d\'une société. Il est conclu avant cette constitution et ne remplace pas les statuts, qui seront établis devant notaire conformément au Code de commerce. Les Fondateurs s\'engagent à reprendre ses stipulations dans les statuts ou dans un pacte d\'associés.',
    '',
    'Article 2 — Rôles et engagement',
    `• ${a.identity.legalName} : ${role(a)}, ${commit(a)}.`,
    `• ${b.identity.legalName} : ${role(b)}, ${commit(b)}.`,
    'Chaque Fondateur s\'engage à consacrer au projet le temps indiqué ci-dessus et à informer l\'autre sans délai de tout changement.',
    '',
    'Article 3 — Répartition du capital',
    `Le capital de la future société sera réparti comme suit : ${a.identity.legalName} ${pct(a)} %, ${b.identity.legalName} ${pct(b)} %${terms.reservePercent > 0 ? `, et ${terms.reservePercent} % réservés aux futurs membres clés de l'équipe, attribués d'un commun accord` : ''}.`,
    '',
    'Article 4 — Acquisition progressive des parts',
    `Les parts de chaque Fondateur lui sont définitivement acquises progressivement sur ${terms.vestingMonths} mois à compter de la signature du présent accord${terms.cliffMonths > 0 ? `, avec une période initiale de ${terms.cliffMonths} mois au terme de laquelle la part correspondant à cette période est acquise en une fois` : ''} ; le solde est acquis ensuite par fractions mensuelles égales.`,
    `Si un Fondateur quitte le projet avant la fin de cette période, il s'engage à céder aux autres associés, à leur valeur nominale, les parts qui ne lui sont pas encore acquises${terms.cliffMonths > 0 ? ` ; s'il part avant ${terms.cliffMonths} mois, cela concerne la totalité de ses parts` : ''}. Les parts acquises lui restent.`,
    '',
    'Article 5 — Propriété intellectuelle',
    'Tout ce que chaque Fondateur crée pour le projet (code, marques, designs, documents, contacts commerciaux) appartient au projet, puis à la société dès sa constitution. Chaque Fondateur s\'engage à signer tout acte nécessaire à ce transfert.',
    '',
    'Article 6 — Décisions',
    'Les décisions importantes (levée de fonds, entrée d\'un nouvel associé, cession d\'un actif essentiel, endettement significatif, changement d\'activité) sont prises d\'un commun accord entre les Fondateurs.',
    '',
    'Article 7 — Confidentialité',
    'Les Fondateurs gardent confidentielles les informations du projet, pendant la durée de leur collaboration et deux ans après.',
    '',
    'Article 8 — Départ d\'un Fondateur',
    'Un Fondateur qui souhaite quitter le projet en informe l\'autre par écrit avec un préavis d\'un mois et l\'aide à assurer la continuité. L\'article 4 s\'applique à ses parts.',
    '',
    'Article 9 — Droit applicable et litiges',
    `Le présent accord est soumis au droit algérien. Les Fondateurs chercheront d'abord une solution amiable ; à défaut, le litige sera porté devant les juridictions compétentes du ressort de la wilaya de ${court}.`,
    '',
    'Article 10 — Signature',
    'Le présent accord est signé électroniquement sur la plateforme Metwork. Chaque signature est authentifiée par un code à usage unique envoyé au téléphone du signataire. Le document signé est enregistré avec son empreinte SHA-256.',
    '',
    '{{signature_block}}',
  ].join('\n');
}
