import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Logo } from './logo';
import { footerNavGroups } from '@/config/navigation';
import { isPathVisible, type LandingVisibility } from '@/config/landing-sections';
import { siteConfig } from '@/config/site';

interface FooterProps {
  /** Admin-toggled landing sections (server-resolved). {} = all visible. */
  landingVisibility?: LandingVisibility;
}

export function Footer({ landingVisibility = {} }: FooterProps) {
  const t = useTranslations();
  const year = new Date().getFullYear();
  // Hide links to hidden sections; drop a group when all its links are hidden.
  const groups = footerNavGroups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => isPathVisible(link.href, landingVisibility)),
    }))
    .filter((group) => group.links.length > 0);

  return (
    <footer className="mt-24 border-t border-border bg-muted/30">
      <Container>
        <div className="grid gap-10 py-12 md:grid-cols-12 sm:py-16">
          {/* Brand */}
          <div className="md:col-span-5">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {t('footer.tagline')}
            </p>
            <div className="mt-6 space-y-1 text-sm text-muted-foreground">
              <p>{siteConfig.contact.email}</p>
              <p>{siteConfig.contact.phone}</p>
              <p>{siteConfig.contact.address}</p>
            </div>
          </div>

          {/* Link groups */}
          <div className="grid grid-cols-2 gap-8 md:col-span-7 md:grid-cols-3">
            {groups.map((group) => (
              <div key={group.titleKey}>
                <h3 className="text-sm font-semibold text-foreground">{t(group.titleKey)}</h3>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        {...('external' in link && link.external
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t(link.labelKey)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border py-6 text-xs text-muted-foreground sm:flex-row">
          <p>{t('footer.copyright', { year })}</p>
          <p>{t('footer.madeIn')} 🇩🇿</p>
        </div>
      </Container>
    </footer>
  );
}
