import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url;

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/*/dashboard/',
          '/*/dashboard',
          '/api/',
          '/*/login',
          '/*/signup',
          '/*/verify-otp',
          '/*/forgot-password',
          '/*/reset-password',
          '/*/payment/',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
