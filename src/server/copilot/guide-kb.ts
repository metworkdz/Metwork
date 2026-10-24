/**
 * The business-creation guides as copilot passages: one passage per guide
 * (its steps, documents, fees and official links) plus one on choosing a
 * legal form. Built once from the French guide text — the same text the
 * guides UI shows — so the chat and the checklist never disagree.
 */
import fr from '@/i18n/messages/fr.json';
import { buildSearchIndex, type KbChunk, type KbDocument, type SearchIndex } from '@/server/copilot/kb';
import { GUIDE_IDS, stepsOf } from '@/lib/creation-guides';

const G = fr.guides;
const BUILT_AT = '2026-10-24T00:00:00.000Z';

function doc(id: string, title: string): KbDocument {
  return { id, path: '', title, category: 'OTHER', year: 2026, pages: 1, chunks: 1, origin: 'ADMIN', addedAt: BUILT_AT, sha256: '' };
}

function guideText(id: (typeof GUIDE_IDS)[number]): string {
  const kind = G.kinds[id];
  const steps = stepsOf(id).map((s, i) => {
    const t = G.steps[s.id] as { title: string; body: string; duration?: string };
    const extra = [
      t.duration ? `Délai : ${t.duration}.` : '',
      s.links.length ? `Site officiel : ${s.links.map((l) => l.href).join(', ')}.` : '',
      s.download ? `Le formulaire ${s.download.label} se télécharge depuis le copilote Metwork.` : '',
    ].filter(Boolean).join(' ');
    return `Étape ${i + 1} — ${t.title} : ${t.body}${extra ? ` ${extra}` : ''}`;
  });
  return [`Créer une ${kind.name}. ${kind.summary}`, `${steps.length} étapes :`, ...steps].join('\n');
}

const CHOOSER_TEXT = [
  'Choisir entre personne physique et personne morale, SARL, EURL ou carte auto-entrepreneur : conseils Metwork.',
  `Personne physique : ${G.kinds.PP.summary}`,
  `Personne morale — SARL : ${G.kinds.SARL.summary}`,
  `Personne morale — EURL : ${G.kinds.EURL.summary}`,
  `Carte auto-entrepreneur : ${G.kinds.AE.summary}`,
  `Avec un associé : SARL. ${G.why.partners}`,
  `Seul avec un capital important (plus de 2 M DA) : EURL. ${G.why.bigAlone}`,
  `Seul, prestation de service ou freelance : carte auto-entrepreneur. ${G.why.services}`,
  `Seul, petit commerce ou boutique e-commerce : personne physique. ${G.why.products}`,
  'Si la personne ne sait pas, lui demander ce qu’elle propose (produits ou services), si elle lance seule ou avec un associé, et son capital ou budget de départ. Le copilote Metwork propose aussi le guide « Quel statut pour moi ? ».',
].join('\n');

let cached: SearchIndex | null = null;

/** The guides' search index (built on first use). */
export function guideIndex(): SearchIndex {
  if (cached) return cached;
  const documents: KbDocument[] = [];
  const chunks: KbChunk[] = [];
  // SARL and EURL share their steps: one passage for both, so a SARL user is never cited "EURL".
  for (const id of GUIDE_IDS.filter((g) => g !== 'EURL')) {
    const title = id === 'SARL' ? 'Guide Metwork — société (SARL ou EURL)' : `Guide Metwork — ${G.kinds[id].name}`;
    const text = id === 'SARL' ? `${guideText('SARL')}\nLes mêmes étapes valent pour une EURL. ${G.kinds.EURL.summary}` : guideText(id);
    const d = doc(`metwork-guide-${id.toLowerCase()}`, title);
    documents.push(d);
    chunks.push({ id: `${d.id}#1`, docId: d.id, page: 1, article: null, text });
  }
  const c = doc('metwork-guide-choisir', 'Guide Metwork — choisir son statut');
  documents.push(c);
  chunks.push({ id: `${c.id}#1`, docId: c.id, page: 1, article: null, text: CHOOSER_TEXT });
  cached = buildSearchIndex({ version: 1, builtAt: BUILT_AT, documents, chunks });
  return cached;
}
