# Registration file uploads ("File upload" question)

A host can add a **File upload** question to the registration form of any
program or event (incubator dashboard and consultant portal). An applicant
attaches one **PDF or JPG, up to 10 MB** while registering — typically a pitch
deck. Only the owner of the listing can open it.

## How it works

| Step | Where |
|---|---|
| Host adds the question (type `FILE`) | `form-builder.tsx` |
| Visitor picks a file; type/size checked in the browser | `registration-file-field.tsx`, `lib/registration-file-upload.ts` |
| Browser asks for a signature for **this event + this question** | `POST /api/registrations/file-signature` (public, rate limited) |
| Browser uploads straight to Cloudinary as a **private** (`authenticated`) raw asset | — |
| On submit the server verifies every file, then stores what *it* measured | `server/registrations/files.ts` → `resolveFileAnswers` |
| Owner views / downloads | `GET /api/{incubator,consultant}/registrations/:id/files/:fieldId[?download=1]` |

Free (`/api/registrations`), paid (`/api/bookings/card`) and desk
(`add-participant`) registrations all go through the same verification. A file
is never a public URL.

## Data (no migration — additive, optional fields)

- `RegistrationFieldType` gains `'FILE'`.
- A registration answer for a file question is `{ fieldId, value: <public_id>, file: { name, bytes, contentType } }`.
  `file` is written **only** by `resolveFileAnswers`; request bodies cannot set it.
- Public id: `metwork/registration-files/{PROGRAM|EVENT}/{entityId}/{fieldId}/{uuid}` (extensionless).

## Rules the server enforces

- The signature is only issued for a `FILE` question of an **active** listing, for
  that question's own path (the signature covers the `public_id` and
  `type=authenticated`).
- At submit: the id must have been minted for this exact question; the file must
  exist, be ≤ 10 MB and **be a PDF or JPG by its first bytes** (the browser's MIME
  type is never trusted). A file that fails is deleted — except when storage
  simply could not be read, which is reported as unavailable and leaves it alone.
- Download: owner-only (`ownedBy`); anyone else gets the same 404 as a missing
  file. Served with the measured `Content-Type`, `nosniff`, `private, no-store`.
  The first bytes **and the size** are re-checked on every open.
- File names are display-only: path parts, quotes, control characters and
  invisible bidi/zero-width characters are stripped.
- The public registration response is a summary (`id`, `status`, …) — never the
  stored record, which for a repeated email belongs to someone else.
- Desk-added participants cannot carry a file; a required file question does not
  block seating them.

## Lifecycle / cleanup

Files are deleted with their question (builder save or delete), their cancelled
registration (permanent delete) or their listing — unless another record still
points at the same file. `GET /api/cron/sweep-registration-files` (daily, 02:45,
`CRON_SECRET`) removes anything older than 24 h that nothing references. An
**unpaid card checkout** counts as a reference for 8 days (pay links live 7).

**Builder saves keep question ids.** Each row sent with its `id` keeps it (and the
answers collected under it). Previously every save minted new ids, which detached
all existing answers — for file questions that would have hidden every file.

## Environment

`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (as for
pitch decks) and `CRON_SECRET`. The CSP already allows `api.cloudinary.com`.
Without Cloudinary: development uses a git-ignored `.local-uploads/` folder
(never `public/`); **production refuses uploads** rather than writing to disk.

## Known limits

- The per-event signature budget (300/hour) and per-IP budget (40/10 min) bound
  abuse of the public signature route, and can also be used to lock others out of
  a busy event for up to an hour. Tune in `file-signature/route.ts`.
- Each submit makes one Cloudinary Admin API call (size) plus one ranged read
  (type). Cloudinary's Admin API is rate limited; a very large burst of
  registrations in an hour can see `STORAGE_UNAVAILABLE`.
- Cloudinary does not enforce size/type at upload time through our signature, so a
  visitor can upload an unsubmitted file of any kind to their own signed path; it
  is rejected at submit or removed by the sweep.
- Replaced / removed uploads stay in storage until the daily sweep.

## Verify on a preview deployment (needs real Cloudinary credentials)

These were developed against a mocked Cloudinary and the local-disk fallback:

1. Add a File upload question to an event; register as a guest with a PDF > 4.5 MB
   (proves the direct upload, the private `type` signature and the extensionless
   filename). A wrong signature shows as a *"could not be uploaded"* message.
2. As the incubator, open **View answers → View** (inline PDF in a tab) and
   **Download**. Confirm a 10 MB file streams fully (Vercel response limits).
3. Confirm a signed-out request to the file URL gets 401, and another incubator 404.
4. Run the sweep once: `curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/sweep-registration-files`.
