import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.5rem',
        lg: '2rem',
        xl: '2.5rem',
      },
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          50: 'hsl(142, 76%, 96%)',
          100: 'hsl(142, 70%, 90%)',
          200: 'hsl(142, 65%, 80%)',
          300: 'hsl(142, 60%, 65%)',
          400: 'hsl(142, 55%, 50%)',
          500: 'hsl(142, 60%, 38%)',
          600: 'hsl(142, 65%, 30%)',
          700: 'hsl(142, 70%, 23%)',
          800: 'hsl(142, 75%, 17%)',
          900: 'hsl(142, 80%, 12%)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: 'hsl(142, 70%, 38%)',
        warning: 'hsl(38, 92%, 50%)',
        info: 'hsl(217, 91%, 60%)',

        /* ── Membership tier palettes ── */
        gold: {
          50:  '#FAF6F0',
          100: '#F5EDD9',
          200: '#EFE0B5',
          300: '#E8D9B5',
          400: '#DEC87A',
          600: '#D4AF37',
          700: '#AA8C2E',
          800: '#7A6222',
          900: '#6B5218',
        },
        platinum: {
          50:  '#FAFAF9',
          100: '#F5F4F2',
          200: '#EEEDEB',
          300: '#E5E4E2',
          400: '#C8C7C5',
          600: '#9D9B99',
          700: '#7A7876',
          800: '#5A5856',
          900: '#4A4845',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-cairo)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-lg': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-md': ['2.5rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.82' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.4s ease-out',
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
    },
  },
  /**
   * Safelist — guarantees gold/platinum tier classes survive production purge.
   *
   * These classes are composed dynamically (array.join, object maps) inside
   * membership-tier-badge.tsx, tier-utils.ts, and partner-stats-card.tsx.
   * The JIT scanner can miss them when they appear inside .join() calls or
   * multi-value string literals, so we pin them explicitly.
   */
  safelist: [
    // Gold (Builder tier) — base + dark variants
    'border-gold-600',
    'border-gold-600/40',
    'border-gold-600/50',
    'border-gold-600/60',
    'bg-gold-50',
    'bg-gold-900/20',
    'text-gold-400',
    'text-gold-600',
    'text-gold-700',
    'from-gold-400',
    'from-gold-600',
    'to-gold-400',
    'hover:bg-gold-50',
    'dark:border-gold-600/40',
    'dark:border-gold-600/60',
    'dark:bg-gold-900/20',
    'dark:text-gold-400',
    'dark:hover:bg-gold-900/20',
    // Platinum (Founder tier) — base + dark variants
    'border-platinum-300',
    'border-platinum-300/80',
    'border-platinum-600/60',
    'bg-platinum-50',
    'bg-platinum-900/20',
    'text-platinum-400',
    'text-platinum-600',
    'text-platinum-700',
    'from-platinum-300',
    'from-platinum-600',
    'to-platinum-300',
    'hover:bg-platinum-50',
    'dark:border-platinum-600/60',
    'dark:bg-platinum-900/20',
    'dark:text-platinum-400',
    'dark:hover:bg-platinum-900/20',
  ],
  plugins: [animate],
};

export default config;
