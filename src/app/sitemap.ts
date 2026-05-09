import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

const locales = ['en', 'fr', 'ar'] as const;

/** Static public pages with their SEO priority and change frequency. */
const publicRoutes: {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
}[] = [
  { path: '',            priority: 1.0,  changeFrequency: 'weekly'  },
  { path: '/programs',  priority: 0.9,  changeFrequency: 'daily'   },
  { path: '/events',    priority: 0.9,  changeFrequency: 'daily'   },
  { path: '/spaces',    priority: 0.85, changeFrequency: 'weekly'  },
  { path: '/mentors',   priority: 0.85, changeFrequency: 'weekly'  },
  { path: '/investors', priority: 0.8,  changeFrequency: 'weekly'  },
  { path: '/startups',  priority: 0.8,  changeFrequency: 'weekly'  },
  { path: '/pricing',   priority: 0.75, changeFrequency: 'monthly' },
  { path: '/contact',   priority: 0.5,  changeFrequency: 'monthly' },
  { path: '/privacy-policy', priority: 0.3, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [];

  for (const route of publicRoutes) {
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${route.path}`,
        lastModified: now,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [l, `${base}/${l}${route.path}`]),
          ),
        },
      });
    }
  }

  return entries;
}
