import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Short-link target for the consultant "new booking" WhatsApp button
 * (`https://metwork.dz/c/<bookingRef>` — see `sendWhatsAppNewBookingTemplate`).
 *
 * A route handler (not a page) so it issues a real HTTP 307 BEFORE any layout
 * streams — deterministic for crawlers / in-app browsers, unlike a Server
 * Component `redirect()` which can degrade to a client-only redirect once the
 * `[locale]` layout has started rendering.
 *
 * The booking ref isn't resolved here: the consultant portal is session-scoped
 * (durable token + PIN), not URL-scoped, so we land the consultant on the portal
 * in French (its default language) where they sign in and see the booking. The
 * i18n middleware locale-prefixes `metwork.dz/c/<ref>` → `/<locale>/c/<ref>`,
 * which routes here; we then redirect to the canonical portal path.
 */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/fr/consultant', req.url), 307);
}
