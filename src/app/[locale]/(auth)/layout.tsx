import { Container } from '@/components/ui/container';
import { Logo } from '@/components/layout/logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b border-border/60 bg-background">
        <Container>
          <div className="flex h-16 items-center justify-between">
            <Logo />
            <LocaleSwitcher />
          </div>
        </Container>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
