'use client';

/**
 * Client-side wrapper for the public Spaces page.
 *
 * Holds the shared filter state (category + city) that is set by the hero
 * search form and read by the results explorer — keeping both in sync
 * without prop-drilling through server components.
 *
 * Architecture:
 *   SpacesPageClient (state owner)
 *   ├── SpacesHero      (reads + writes category/city)
 *   └── SpacesExplorer  (reads + writes category/city; owns query + sort)
 */
import { useRef, useState } from 'react';
import { Container } from '@/components/ui/container';
import { SpacesHero } from './spaces-hero';
import { SpacesExplorer } from './spaces-explorer';
import type { Space, SpaceCategory } from '@/types/domain';

const ALL = 'all' as const;

interface SpacesPageClientProps {
  spaces: Space[];
  cities: { code: string; name: string }[];
}

export function SpacesPageClient({ spaces, cities }: SpacesPageClientProps) {
  const [category, setCategory] = useState<SpaceCategory | 'all'>(ALL);
  const [city, setCity] = useState<string>(ALL);

  const resultsRef = useRef<HTMLElement>(null);

  function scrollToResults() {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <SpacesHero
        cities={cities}
        category={category}
        city={city}
        totalSpaces={spaces.length}
        onCategoryChange={setCategory}
        onCityChange={setCity}
        onSearch={scrollToResults}
      />

      <section
        ref={resultsRef}
        aria-label="Workspace results"
        className="scroll-mt-4 py-10 sm:py-14"
      >
        <Container>
          <SpacesExplorer
            spaces={spaces}
            cities={cities}
            category={category}
            city={city}
            onCategoryChange={setCategory}
            onCityChange={setCity}
          />
        </Container>
      </section>
    </>
  );
}
