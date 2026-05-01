import { z } from 'zod';

const s = (max: number) => z.string().min(1).max(max);

const statItemSchema = z.object({
  value: s(20),
  label: s(60),
});

const featureItemSchema = z.object({
  key: z.enum(['programs', 'spaces', 'fundraising', 'community']),
  title: s(100),
  description: s(300),
});

const roleItemSchema = z.object({
  key: z.enum(['entrepreneur', 'investor', 'incubator']),
  title: s(100),
  description: s(300),
});

export const landingContentSchema = z.object({
  hero: z.object({
    badge:        s(80),
    title:        s(120),
    subtitle:     s(400),
    ctaPrimary:   s(60),
    ctaSecondary: s(60),
  }),
  stats: z.object({
    founders:  statItemSchema,
    investors: statItemSchema,
    incubators:statItemSchema,
    cities:    statItemSchema,
  }),
  features: z.object({
    title:    s(120),
    subtitle: s(200),
    items:    z.array(featureItemSchema).length(4),
  }),
  roles: z.object({
    title: s(120),
    items: z.array(roleItemSchema).length(3),
  }),
  cta: z.object({
    title:    s(160),
    subtitle: s(300),
    button:   s(60),
  }),
});

export type LandingContentInput = z.infer<typeof landingContentSchema>;
