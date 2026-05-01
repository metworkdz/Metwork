import { XCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function PaymentCancelPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center">
          <div className="flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <XCircle className="size-7 text-muted-foreground" />
            </div>
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight">Payment cancelled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You cancelled the payment. No charge was made to your account.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/dashboard/entrepreneur/wallet">Try again</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
