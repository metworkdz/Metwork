import { Card, CardContent } from '@/components/ui/card';
import type { ReactNode } from 'react';

interface DashboardWelcomeProps {
  greeting: string;
  subtitle: string;
  action?: ReactNode;
}

export function DashboardWelcome({ greeting, subtitle, action }: DashboardWelcomeProps) {
  return (
    <Card className="border-primary-100 bg-gradient-to-br from-primary-50 to-background">
      <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
