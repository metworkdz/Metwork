'use client';

/**
 * MentorsDirectory — the public mentor grid. Discovery layer only: category
 * filtering + browsing via the shared `CategoryFilterBar`/`MentorGrid`.
 * Clicking a card leads into the unchanged profile route (`/mentors/[slug]`);
 * the Book CTA opens the unchanged `BookConsultationDialog` — this component
 * never touches the booking flow itself, only what's in front of it.
 */
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { CategoryFilterBar } from './category-filter-bar';
import { MentorGrid } from './mentor-grid';
import { BookConsultationDialog } from './book-consultation-dialog';
import type { Mentor } from '@/types/mentor';
import type { MentorCategoryRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface MentorsDirectoryProps {
  mentors: Mentor[];
  categories: MentorCategoryRecord[];
  locale: Locale;
  /**
   * Route bookings through the instant-book, pay-first flow (resolved server-side
   * from the parent RSC). Without it the dialog defaults to the legacy
   * request-then-approve path, whose endpoint is now a retired 410 tombstone —
   * so a logged-in user booking from the directory would fail. Mirror the mentor
   * profile / dashboard call-sites.
   */
  instantBookEnabled?: boolean;
}

export function MentorsDirectory({
  mentors,
  categories,
  locale,
  instantBookEnabled = false,
}: MentorsDirectoryProps) {
  const { user } = useAuth();
  const router = useRouter();

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [booking, setBooking] = useState<Mentor | null>(null);

  function hrefFor(m: Mentor): string {
    return `/mentors/${m.slug ?? m.id}`;
  }

  function handleBook(m: Mentor) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent('/mentors')}`);
      return;
    }
    setBooking(m);
  }

  return (
    <div>
      <div className="mb-6">
        <CategoryFilterBar
          categories={categories}
          selected={selectedCategoryIds}
          onChange={setSelectedCategoryIds}
          locale={locale}
        />
      </div>

      <MentorGrid
        mentors={mentors}
        categories={categories}
        selectedCategoryIds={selectedCategoryIds}
        locale={locale}
        hrefFor={hrefFor}
        onBook={handleBook}
      />

      <BookConsultationDialog
        mentor={booking}
        open={booking !== null}
        onOpenChange={(open) => { if (!open) setBooking(null); }}
        instantBookEnabled={instantBookEnabled}
      />
    </div>
  );
}
