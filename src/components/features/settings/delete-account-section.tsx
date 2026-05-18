'use client';

/**
 * Self-service account deletion section.
 *
 * Renders a red-bordered "Danger Zone" card with a Delete My Account button.
 * Clicking the button opens a confirmation dialog that requires the user to
 * type the literal phrase "DELETE MY ACCOUNT" AND enter their current password.
 *
 * On success: redirects the user to the home page and clears local auth state.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const CONFIRM_PHRASE = 'DELETE MY ACCOUNT';

export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit =
    phrase.trim() === CONFIRM_PHRASE && password.length > 0 && !submitting;

  function reset() {
    setPhrase('');
    setPassword('');
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }

  async function handleDelete() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(
          data.error?.message ?? 'Failed to delete account. Please try again.',
        );
      }
      setSuccess('Your account has been deleted. Redirecting…');
      // Clear local auth state and redirect to home.
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion failed.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="size-4" />
            Delete account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Permanently delete your Metwork account and all associated data
            (wallet balance, saved items, profile). This action{' '}
            <span className="font-semibold text-foreground">cannot be undone</span>.
            Booking history will be anonymized for accounting purposes.
          </p>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          // Don't allow closing the dialog mid-submit
          if (submitting) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Confirm account deletion
            </DialogTitle>
            <DialogDescription>
              This will permanently delete your account. To proceed, type the
              phrase below and enter your current password.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="confirm-phrase">
                Type{' '}
                <span className="font-mono font-semibold">
                  {CONFIRM_PHRASE}
                </span>{' '}
                to confirm
              </Label>
              <Input
                id="confirm-phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                autoComplete="off"
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="confirm-password">Current password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your current password"
                autoComplete="current-password"
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-emerald-600" role="status">
                {success}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={!canSubmit}
              loading={submitting}
            >
              Delete account permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
