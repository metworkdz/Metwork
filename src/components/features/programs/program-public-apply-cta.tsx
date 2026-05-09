'use client';

import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { ProgramDetailSheet } from './program-detail-sheet';
import type { Program } from '@/types/domain';

interface Props {
  program: Program;
  locale?: string;
}

export function ProgramPublicApplyCTA({ program }: Props) {
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);

  const redirect = `/programs/${program.id}`;

  if (!user) {
    return (
      <div className="space-y-2">
        <Link href={`/login?redirect=${encodeURIComponent(redirect)}`}>
          <Button className="w-full" variant="default">
            <LogIn className="size-4" />
            Sign in to apply
          </Button>
        </Link>
        <Link href={`/signup?redirect=${encodeURIComponent(redirect)}`}>
          <Button className="w-full" variant="outline">
            <UserPlus className="size-4" />
            Create account &amp; apply
          </Button>
        </Link>
      </div>
    );
  }

  if (user.role !== 'ENTREPRENEUR') {
    return (
      <p className="text-sm text-muted-foreground text-center">
        Program applications are available for entrepreneur accounts.
      </p>
    );
  }

  return (
    <>
      <Button className="w-full" onClick={() => setSheetOpen(true)}>
        Apply now
      </Button>
      <ProgramDetailSheet
        program={program}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
