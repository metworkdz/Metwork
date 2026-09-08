# Contract + e-signature playbook

How the contract system on Metwork is built, and why each piece is shaped the
way it is — written so it can be rebuilt in a different project without
repeating the four defects that cost us the most time here.

Two documents come out of this stack:

| | Consultant partnership contract | Space-rental contract |
|---|---|---|
| Parties | EURL Metwork ↔ one consultant | Metwork (or an incubator) ↔ a client |
| Signed | In-app, drawn signature + one-time code | Printed and signed by hand |
| Stored | Cloudinary, `authenticated`, SHA-256 pinned | Not stored — generated on download |
| Template | One, in Platform Settings | One per space category |

They share a layout module and nothing else. **If you only want generated PDFs,
you can stop after §5 and skip the whole e-signature half.**

---

## 1. The shape of it

```
Admin writes a template  ──► {{token}} engine ──► frozen contentSnapshot
                                                        │
                                       ┌────────────────┴─────────────────┐
                                       ▼                                  ▼
                            DRAFT PDF (watermarked)            consultant draws signature
                            read before signing                        │
                                                            one-time code to the frozen phone
                                                                       │
                                                          ONE atomic write: status + signature
                                                          + stamp + pdf id + hash + audit entry
                                                                       │
                                                     Cloudinary (authenticated raw) + SHA-256
```

Every value on the right-hand side is read from the **frozen record**, never
from the live profile. Re-rendering a contract years later produces the same
document even if the consultant has since changed their phone, address or bank
account. That property is the whole point; everything below protects it.

---

## 2. Data model

One record, one collection. Nothing about a contract lives anywhere else except
the OTP code itself (§7.3).

```ts
type ConsultantContractStatus = 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED' | 'VOIDED';

interface ConsultantContractRecord {
  id: string;
  consultantId: string;          // the signing party
  status: ConsultantContractStatus;
  templateVersion: number;       // bumped on each DRAFT revision

  // ── Frozen at send-time. Never re-read from the live profile. ──
  contentSnapshot: string;       // the rendered body. THIS is the document.
  commissionRate: number;        // 0–1, resolved once, never hardcoded
  payoutMethod: 'BANK_TRANSFER' | 'CCP' | 'CHEQUE';
  payoutDetails: string | null;  // masked account description
  signerPhoneSnapshot: string;   // where the signing code goes

  signature: { imagePng: string; signedAt: string } | null;
  adminStamp: { imageUrl: string; appliedAt: string } | null;

  finalPdfPublicId: string | null;  // source of truth for the stored file
  finalPdfUrl: string | null;       // expiring link — a cache, not the truth
  finalPdfHash: string | null;      // SHA-256 of the exact uploaded bytes

  otp: ConsultantContractOtpState | null;
  auditTrail: ConsultantContractAuditEntry[];
  createdAt: string; sentAt: string | null; signedAt: string | null; voidedAt: string | null;
}
```

Three modelling decisions worth copying:

**`contentSnapshot` is the document, not a reference to one.** The admin's
template can change tomorrow; what somebody signed cannot. Storing the rendered
text — rather than a template id plus a version — means no future migration can
alter an executed contract.

**`finalPdfUrl` is explicitly a cache.** Signed asset links expire. Treating the
URL as the source of truth is how you end up with a contract nobody can open
six months later; the `publicId` is what's durable, and links are minted on
demand from it.

**The audit trail is a plain array of `{event, actorId, timestamp}`** where
`actorId` is a bare string. Admins and consultants were two disjoint id spaces
in our schema, and a discriminated union bought nothing but ceremony.

---

## 3. Lifecycle, and the two invariants that matter

```
        createDraftContract          sendContract              signContract
  ─────────────────────────►  DRAFT ──────────────►  PENDING_SIGNATURE ──────────►  SIGNED
                                │                            │
                                └────────── voidContract ────┴──────────►  VOIDED
```

**Invariant 1 — frozen snapshots.** `contentSnapshot`, `commissionRate`,
`payoutMethod`, `payoutDetails` and `signerPhoneSnapshot` are captured at
`sendContract` and never written again.

**Invariant 2 — immutability after signing.** Once `status === 'SIGNED'` the
only legal write is an append to `auditTrail` (plus re-minting
`finalPdfUrl`). A `VOIDED` contract is fully terminal — only the trail moves.

Enforce invariant 2 in **one place**:

```ts
const SIGNED_MUTABLE_FIELDS = new Set(['auditTrail', 'finalPdfUrl']);
const VOIDED_MUTABLE_FIELDS = new Set(['auditTrail']);

// Every write to the collection goes through this, and no route may call the
// database directly. A test asserts that — grep the routes for direct writes
// and fail the build if any exist.
export async function updateContract<T>(id, mutate): Promise<UpdateContractResult<T>>
```

The guard is worth more than the rule: a rule you have to remember is a rule
somebody will forget, and the failure mode is silently editing evidence.

---

## 4. The `{{token}}` engine

A whitelist and a string replace. No template language, no `eval`, no
expressions.

```ts
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(body: string, values: Partial<Record<string, string>>): string {
  return body.replace(TOKEN_RE, (_m, token) =>
    KNOWN_TOKENS.has(token) ? values[token] ?? '' : '');
}
```

Two properties fall out of that, and both are deliberate:

- **An unknown token renders empty.** A malformed template produces a slightly
  blank contract, never a crashed render. For a document a person is waiting
  on, degrading beats throwing.
- **The catalogue is data**, so the same list drives the resolver, the
  variable-reference panel in the editor, and the live preview. One list means
  the editor cannot advertise a token the renderer doesn't understand.

### The signature-position marker

`{{signature_block}}` is **not** a token — tokens substitute text, this
positions images. It is explicitly preserved by the replacer (unknown tokens are
stripped, which would otherwise eat it), and the renderer splits the body on it:

```ts
const [before, after] = splitAtSignatureMarker(body);
// no marker  ⇒  everything is "before", block appends at the end
// only the FIRST occurrence positions the block; further ones are stripped
```

It lives in the **variables** module, not the PDF module, because the on-screen
previews are client components that cannot import a pdfkit renderer — and all
three surfaces have to agree on one definition.

---

## 5. The PDF stack

`pdfkit`. One module owns page geometry and document lifecycle
(`makeDoc`, `collectBuffer`, A4 constants, palette) and every generated document
in the app builds on it — receipts, invoices, contracts. Don't start a second
one.

### 5.1 Fonts — and why not the built-ins

**Never use pdfkit's built-in Helvetica or Times for real French text.** They
encode CP1252 only, and French contract text pasted out of Word is full of
characters outside it: narrow and thin no-break spaces (U+202F, U+2009) before
`« : ; ! ? »` and inside numbers (`18 000`), plus `→ № ●`. pdfkit renders those
as garbage — `18 /000`, `paiement /:` — and it looks exactly like a corrupted
document, because it is one.

Embed full Unicode TrueType faces instead. Three choices we'd repeat:

| Face | Used for | Why this one |
|---|---|---|
| **DejaVu Serif** | receipts | Permissive licence, full Latin + typographic range |
| **Tinos** | contracts | Metric-compatible with Times New Roman and SIL OFL. The Monotype original is licensed per-machine and **cannot be bundled into a repo or shipped to a server** |
| **Amiri** | any Arabic | Naskh, shapes Arabic correctly, and also covers Latin |

**Landmine — Noto Naskh Arabic crashes fontkit.** Its GPOS mark-anchor tables
trigger a null-anchor exception when positioning diacritics (tashkeel). Amiri
shapes the same text cleanly. Related: do **not** pass explicit OpenType
`features` to `doc.text()` for Arabic — forcing them engages the same GPOS
lookups and throws on some font/fontkit combinations. Fontkit applies contextual
shaping automatically for embedded fonts; leave it alone.

### 5.2 The logo that vanished in production

The wordmark is decoded from a **base64 source constant**, not read from disk:

```ts
import { METWORK_LOGO_PNG_BASE64 } from '@/server/pdf/assets/metwork-logo';

let cache: Buffer | null | undefined;
export function loadBrandLogo(): Buffer | null {
  if (cache !== undefined) return cache;
  const buf = Buffer.from(METWORK_LOGO_PNG_BASE64, 'base64');
  // Magic-number guard: a truncated constant must degrade to "no logo", not
  // make pdfkit throw and take the whole contract down.
  cache = buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC) ? buf : null;
  return cache;
}
```

**Why:** reading it from `public/assets/` failed in production and worked
perfectly in dev. `public/` is served by the CDN and is not part of the
serverless bundle; and moving the file next to the code didn't help either,
because the path was built from `process.cwd()`, which Next's file tracer cannot
statically analyse — so the PNG was never traced into the lambda. A source
constant has no filesystem dependency at all and cannot be left behind by a
bundler.

(Fonts have the same exposure. They're read from disk, so they need an explicit
`outputFileTracingIncludes` entry. Verify by grepping the built
`.next/**/*.nft.json` for the font filenames — don't assume.)

### 5.3 Type scale and headings

```ts
const SIZE = { title: 16, subtitle: 14, heading: 14, body: 12 };
```

The body is rendered **line by line**, not as one `doc.text()` call, because a
single call cannot mix sizes and weights and headings must carry their own.

Heading detection is pattern-matching against whatever a human typed, so keep it
narrow — **a false positive sets a whole paragraph at heading size, which is far
more disfiguring than a missed heading**:

```ts
export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;                          // not a heading if it's prose-length
  if (/^(article|chapitre)\s+([0-9]{1,2}|premier|[ivxl]{1,5})\b/i.test(t)) return true;
  const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(t);
  return numbered ? isAllCaps(numbered[1]) : false;               // "1. OBJET DU CONTRAT"
}
```

The capitalisation requirement is what separates a heading from the first item
of an ordinary numbered list. Sub-headings (`4.1 – Responsabilité`) are set
**bold at body size**, not at heading size — they're subdivisions, and giving
them equal weight flattens the structure the numbering exists to express.

Test these against lines copied **verbatim out of the real templates**. A rule
that only works on invented examples is worthless.

### 5.4 Bullets

Templates pasted from Word write bullets as `•⇥text`. **A TAB has no glyph in an
embedded TrueType font** — it resolves to `.notdef`, so you get a replacement box
or the text jammed against the dot. Replace tabs, and draw the mark in its own
column so wrapped text hangs under its own first word:

```ts
doc.text(mark, markX, y, { width: BULLET_INDENT, lineBreak: false });
doc.text(text, textX, y, { width: CONTENT_W - BULLET_INDENT, align });
```

Guard the page break first (`if (y + lineHeight > PAGE_H - MARGIN) doc.addPage()`).
Drawing the mark can itself trigger pagination, which strands the bullet alone
at the foot of a page while its text starts the next one.

### 5.5 ⚠ The 110-page contract

A 3-page contract rendered as **110 pages**. The cause: the draft watermark was
drawn from a `pageAdded` listener.

```
watermark's own doc.text() overflows → pdfkit adds a page → fires pageAdded
  → draws the watermark → which overflows → adds a page → …
```

**Fix: stamp overlays in ONE pass at the end, over buffered pages.** After the
body has flowed, no content can be added while the pass runs, so re-entry is
impossible:

```ts
const doc = makeDoc({ bufferPages: true });
// … draw the whole document …
if (draft) drawWatermark(doc);   // ← last
drawPageNumbers(doc);            // ← last

function drawWatermark(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const { top, bottom } = doc.page.margins;
    doc.page.margins.top = 0; doc.page.margins.bottom = 0;   // belt
    doc.save().rotate(-38, { origin: [PAGE_W / 2, PAGE_H / 2] });
    doc.text('PROJET — NON SIGNÉ', 0, PAGE_H / 2 - 26, {
      width: PAGE_W, align: 'center', lineBreak: false,      // braces
    });
    doc.restore();
    doc.page.margins.top = top; doc.page.margins.bottom = bottom;
  }
}
```

`lineBreak: false` plus zeroed margins are the belt-and-braces: the text is
placed absolutely and may never trigger pagination on its own.

### 5.6 ⚠ The blank trailing page

Same family, different symptom. `Page N / T` written into the bottom margin made
pdfkit auto-paginate, appending a **blank page** and putting the footer on it.
Zero `page.margins.bottom` for the duration of the write and set
`lineBreak: false`. `bufferPages: true` is required anyway, since the total page
count isn't known until the body has finished flowing.

### 5.7 Signature block geometry

Two columns, company on the left, signer on the right — mirroring the paper
contract the company already issues. Getting this backwards puts the wrong party
under each caption, which is exactly the kind of defect that gets a document
challenged.

Three things to copy:

- **Reserve the block's height and break the page if it doesn't fit.**
  `if (doc.y + SIGNATURE_BLOCK_H > PAGE_H - MARGIN) doc.addPage()`. Derive that
  height from the gaps the block is actually built from rather than typing a
  number, so a later change to an image box carries its own reservation.
- **Bottom-align both marks in a band as tall as the larger.** pdfkit's
  `fit: [w, h]` with `valign: 'bottom'` does it. Otherwise the shorter mark
  floats above its ruled line.
- **`fit` scales by whichever axis binds first.** Our stamp is 632 × 455 px, so
  height binds — which is why a 120 pt box is an exact 1.5× of an 80 pt one.
  For a wide image the width would bind instead and the same change would do
  nothing. Measure your image before you pick a number.
- **Draw the ruled lines whether or not an image landed.** They frame the marks
  and stand in for them when one is missing — which is always, in a draft.

**Testing drawn images:** nothing about an image's size or position appears in
the PDF's text, so assertions have to read the placement matrices back out of
the (deflated) content stream. pdfkit emits `w 0 0 -h x (bottom) cm` before each
`/Ixx Do`, in its own top-left coordinate space. Any weaker test passes either
way and proves nothing.

### 5.8 Testing text is a trap

With an embedded font, pdfkit writes text as **glyph indices, not ASCII**. You
cannot grep a rendered date or name out of the bytes. Test the *formatter*
directly instead, and assert on structure (page counts, `/Subtype /Image`,
`/BaseFont` names) for the PDF itself.

One formatter worth stealing:

```ts
new Date(iso).toLocaleString('fr-DZ', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  hour12: false,   // Node's ICU resolves fr-DZ to a 12-hour clock. "02:32 PM"
                   // on a French legal document is a defect.
});
```

---

## 6. Layout sharing

Once there are two contract documents, put the common layout in **one module**
(`src/server/pdf/contract-layout.ts` here): type scale, heading detection, body
writer, logo, page numbers. Each document keeps what it alone owns — the
signature block, watermark and provenance footer are consultant-only; the title
and contract-number line are rental-only.

The rule that keeps it honest: **share what must look identical, don't share
what one document happens to do today.** Sharing the second kind means a change
made for one document silently edits the other.

---

## 7. The e-signature

Skip this section entirely if your contracts are printed and signed by hand.

### 7.1 Capturing the signature

Canvas, Pointer Events, one code path for finger/stylus/mouse. Four details that
are easy to get wrong and all visible to the user:

- **`touch-action: none`** — without it the browser claims the gesture for
  scrolling and the stroke breaks up mid-signature.
- **`setPointerCapture`** — keeps delivering points when the finger slides off
  the canvas, so a long tail isn't clipped into two strokes.
- **Size the backing store to `devicePixelRatio`** and scale the context to
  match, or retina strokes are upscaled and blurry. Resizing a canvas clears it,
  so carry the current drawing across on a `ResizeObserver`.
- **Fill the canvas opaque white before drawing.** A transparent PNG composited
  onto a white PDF page renders black-on-black in some viewers, and a signature
  nobody can see is worse than no signature.

Expose `toDataUrl()` / `clear()` through a ref. The canvas *is* the state;
mirroring it into React on every stroke re-encodes the whole image on each
pointer move.

### 7.2 Validating it

```ts
const MIN_SIGNATURE_BYTES = 256;   // below this, the canvas was effectively blank

function decodeDataUriPng(dataUri: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri ?? '');
  if (!m) return null;
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  return buf.subarray(0, 8).equals(PNG_MAGIC) ? buf : null;   // not just "it decoded"
}
```

**Check the blank-canvas case BEFORE spending the one-time code.** Someone who
submits an empty signature should be able to retry immediately instead of
waiting out a resend throttle.

### 7.3 One-time code policy

Do **not** fork your existing OTP implementation. Generation, hashing, expiry
and the per-code attempt counter stay in the shared module; contract codes live
under their own key namespace so a signing code can never invalidate — or be
satisfied by — a login code:

```ts
const key = `contract-sign:${contractId}`;   // keyed by CONTRACT, not by signer
```

Keyed by contract id, because a signer sent a replacement contract while an old
one is still pending must not have the two codes collide.

What the shared module has no concept of, and what you add on the record, is the
**send-side** policy:

| Rule | Value | Why |
|---|---|---|
| Code lifetime | 5 min | Half the account default — they're signing in one sitting with the page open, so a shorter window costs nothing and narrows the interception surface on a document carrying bank details |
| Attempts per code | 5 | |
| Lockout after exhaustion | 30 min | |
| Sends per rolling window | 3 / hour | |
| Minimum gap before send *n* | `[0, 30s, 120s]` | Someone who genuinely missed the first message waits 30s; someone hammering resend waits progressively longer |

Keep all of that **pure** — `now` passed in, no database, no clock of its own —
so lockout and throttle rules are unit-testable without fabricating DB state.
Every refusal carries `retryAfterMs`, so the UI can say *when* rather than just
*no*.

### 7.4 The signing write

Everything lands together or not at all:

```ts
const result = await updateContract(contractId, (c) => {
  if (c.status !== 'PENDING_SIGNATURE') return 'RACED';
  c.status = 'SIGNED';
  c.signature = { imagePng, signedAt };
  c.adminStamp = stampUrl ? { imageUrl: stampUrl, appliedAt: signedAt } : null;
  c.finalPdfPublicId = stored.publicId;
  c.finalPdfUrl = stored.url;
  c.finalPdfHash = stored.hash;
  c.signedAt = signedAt;
  c.auditTrail.push({ event: 'SIGNED', actorId, timestamp: signedAt });
});
```

The status re-check **inside** the write is the concurrency guard: two submits
landing together would otherwise both read a pending contract and both sign it.

Note the ordering problem this creates and handle it explicitly: by the time the
PDF is rendered and uploaded, the code is already spent. If storage fails, log
it into the audit trail — otherwise the trail shows `OTP_VERIFIED` with no
`SIGNED` after it and nothing explains the gap.

### 7.5 Storage and integrity

```ts
const hash = sha256Hex(pdf);                        // hash FIRST, locally
const publicId = `${FOLDER}/contract-${id}-${randomUUID()}`;
const uploaded = await uploadAuthenticatedRaw(pdf, { publicId });
```

- **Hash before upload, over the bytes you produced.** Hashing a later download
  attests to what the CDN returned, not to what you signed.
- **Random suffix in the public id.** Uploads use `overwrite: false`, so a retry
  after a partial failure needs a fresh id rather than a collision with a
  half-written asset.
- **Trust the echoed id** over your own — it's what the asset is actually filed
  under, including any normalisation the provider applied.
- **No public-disk fallback.** Other upload paths in our codebase fall back to
  `public/uploads/` when the CDN is unconfigured; that's fine for an avatar and
  unacceptable here, since it would publish exactly the document the
  authenticated upload exists to protect. **Fail closed** — an unconfigured
  environment cannot sign contracts, which is the safe direction.

### 7.6 ⚠ Serving a stored PDF (four verified Cloudinary traps)

Handing the signed link to the browser **does not work** for a document a human
is meant to read. All four of these were verified against the live account, not
assumed:

1. **A URL ending in `.pdf` returns 401** while the account's "Allow delivery of
   PDF and ZIP files" setting is off.
2. So public ids are stored **extensionless** — but then the provider serves
   `Content-Type: application/octet-stream` with `Content-Disposition:
   attachment` and a filename with no extension. `window.open()` gives a blank
   tab plus a download the OS can't open by double-click.
3. **A versionless URL 404s** for raw assets — keep the version segment.
4. **The error's `http_code` is nested** one level down
   (`{ error: { http_code } }`), so a naive `err.http_code === 404` check never
   matches and you swallow the wrong errors.

The fix is to **proxy the bytes**: mint a signed link server-side, fetch it, and
serve it yourself with a real `application/pdf` content type and an inline
disposition. The asset stays authenticated; only your server can mint the link.

Guard the proxy, because a signed-link failure can still answer `200` with an
HTML or JSON error body:

```ts
return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;
```

Without that check you stream an error page to the browser labelled as a PDF.

### 7.7 Provenance

Print **how** the signature was obtained, in the document:

> Document signé électroniquement. La signature manuscrite ci-dessus a été
> apposée par le consultant puis confirmée par un code à usage unique transmis
> au +213 … . Référence du contrat : … .

That sentence is the difference between an image of a signature and an
attributable one, so it belongs in the document rather than only in the
database. The PDF's own SHA-256 is deliberately **absent** from it — the hash is
computed over these bytes, so it cannot be among them.

### 7.8 The draft copy

Render the pre-signature copy from the **same frozen snapshot** the signature
will be applied to, so what someone reads cannot drift from what they sign.
Never store it. Watermark it, give it empty signature lines, and omit the
provenance footer — a forwarded draft must be self-evidently not the executed
contract. A test asserts the draft ignores a signature and stamp *even if handed
them*.

---

## 8. Delivery

**Every send must be awaited.** On a serverless platform the lambda freezes the
moment the response is returned, and a floating promise is simply dropped — the
email or message is never sent, with no error anywhere. This was the single
largest bug class in this codebase: 21 senders across 26 call sites were
fire-and-forget.

Two things stop it coming back:

```ts
// 1. Senders return Promise<void>, never void.
export async function sendContractReadyEmail(...): Promise<void>

// 2. A static test walks the route files and fails on any un-awaited sender
//    call. Verify the guard itself by deleting one `await` and watching it
//    go red — a guard you haven't seen fail is a guard you don't have.
```

Beware `await` inside a non-`async` `.then()` callback — return the chain
instead. And when a channel fans out (email *and* WhatsApp), don't stop at the
first success: send both, and let only the *phone* channel degrade
(WhatsApp → SMS).

---

## 9. Completeness gate

A contract cannot identify a party it has no address or ID number for, and those
render blank rather than failing loudly. So:

```ts
export function missingConsultantIdentity(m): ConsultantIdentityField[]
```

**One function, used by both the refusal and the UI.** The picker shows each
candidate's gaps inline ("— no full address, no ID number" / "✓ ready") and
disables the create button; the server refuses on the same call. They physically
cannot disagree about who is eligible, and a test pins that.

Pair it with a "remind them" endpoint that emails exactly which fields are
missing — deliberately narrow (a prompt and a link, no contract, no terms, since
a mailbox isn't an authenticated channel), refusing with `409` when the profile
is already complete, `422` with no email on file, and one nudge per person per
hour because that button is easy to double-click.

---

## 10. What holds it together

| Test | What it actually proves |
|---|---|
| Immutability | No route writes the collection directly; signed records reject every field but the trail |
| Signature geometry | Placement matrices read back out of the content stream — sizes and baselines, not "a PDF came back" |
| Heading detection | Lines copied verbatim from the production templates, both true and false cases |
| Pagination | A long body stays under a page ceiling — this is the 110-page regression guard |
| Draft ≠ signed | The draft ignores a signature and stamp even when handed them |
| Awaited sends | Static scan of the route files for fire-and-forget calls |
| Formatters | 24-hour clock, legal-name normalisation — the things glyph indices hide |

Mutation-test the guards that matter: remove the fix and confirm the test goes
red. Two of ours passed with the fix removed and had to be rewritten.

---

## 11. Porting checklist

In this order:

1. **Page primitives** — A4 constants, palette, `makeDoc` / `collectBuffer`.
   (~1 file)
2. **Fonts** — embed the TTFs, register them on every document, and add the
   tracing config so they reach production. Verify in the build output.
3. **Logo** — base64 constant, magic-number guard, cached.
4. **Layout module** — type scale, heading detection, body writer, page numbers.
   §5.3–5.6.
5. **Variable engine** — whitelist, catalogue, `renderTemplate`,
   `buildSampleVariables` for the editor preview.
6. **Renderer** — letterhead, title, body. *Stop here for generate-and-print
   contracts.*
7. **Record + write gateway** — §2 and §3, including the direct-write test.
8. **Signature pad** — §7.1, §7.2.
9. **OTP policy** — §7.3, on top of whatever OTP module you already have.
10. **Sign + store** — §7.4, §7.5, and the proxy route from §7.6.
11. **Delivery** — §8, with the await guard from day one.
12. **Completeness gate** — §9.

### File inventory

| File | Role |
|---|---|
| `src/server/notifications/receipt.ts` | Page geometry, palette, `makeDoc`, `collectBuffer`, `fetchImageBuffer` |
| `src/server/pdf/fonts.ts` + `fonts/*.ttf` | Embedded faces |
| `src/server/pdf/assets/metwork-logo.ts` | Base64 wordmark |
| `src/server/pdf/contract-layout.ts` | Shared layout |
| `src/server/consultant-contracts/contract-pdf.ts` | Signed-contract renderer |
| `src/server/consultant-contracts/variables.ts` | Tokens + `{{signature_block}}` |
| `src/server/consultant-contracts/service.ts` | Lifecycle + the single write gateway |
| `src/server/consultant-contracts/otp.ts` | Send-side policy (pure) |
| `src/server/consultant-contracts/storage.ts` | Upload, hash, signed links, byte proxy |
| `src/server/consultant-contracts/party.ts` | Which record is "us" |
| `src/components/features/consultant/portal/signature-pad.tsx` | Canvas |
| `src/components/features/admin/contracts-manager.tsx` | Admin queue + completeness UI |
| `src/server/contracts/*` | Space-rental contract (templates per category) |

### What's Metwork-specific and needs replacing

The French legal wording; the payout methods (`BANK_TRANSFER` / `CCP` /
`CHEQUE` mirror Algerian RIB / Algérie Poste RIP / cheque); the commission
model; the wilaya list; and Cloudinary as the object store — swap it for
whatever you use, keeping the *properties* from §7.5 rather than the API.

---

## 12. What we deliberately did not build

- **No countersignature flow.** The company side is a stamp image applied at
  signing, not a second signing ceremony. Adding one means a third status and a
  second frozen phone, and it wasn't worth it for a two-party contract.
- **No delete path.** A signed contract is evidence. Removing test records is a
  standalone script that bypasses the service layer on purpose, dry-run by
  default, and it says so in its own header.
- **No re-issue.** A contract that needs changing is voided and replaced, so the
  audit trail shows both.
