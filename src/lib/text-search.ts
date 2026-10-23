/**
 * French-first lexical matching shared by the copilot search and the hiring
 * matcher: lowercase, accents folded, digits split from letters, stop words
 * dropped, words cut to a crude 6-letter stem. Client-safe and pure.
 */

const STOPWORDS = new Set(
  ('au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous est sont ete etre avoir a ont cette cet celui celle ceux dont lorsque si sous tout tous toute toutes plus moins entre leurs y d l s n c j m t qu').split(' '),
);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // "282sexies" (as printed in the codes) must match "282 sexies".
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2');
  for (const raw of folded.split(/[^a-z0-9\u0600-\u06ff]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) { out.push(raw); continue; }
    if (raw.length < 2) continue;
    // Prefix stemming: "declarations" / "declaration" / "declarer" → "declar".
    out.push(raw.length > 6 ? raw.slice(0, 6) : raw.replace(/s$/, ''));
  }
  return out;
}

