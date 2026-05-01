import { Container } from '@/components/ui/container';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, icon, action }: EmptyStateProps) {
  return (
    <Container>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          {icon ?? <Inbox className="size-6 text-muted-foreground" />}
        </div>
        <p className="mt-5 max-w-md text-base text-muted-foreground">{message}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </Container>
  );
}
