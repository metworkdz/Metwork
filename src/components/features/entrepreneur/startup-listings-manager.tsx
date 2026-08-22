'use client';

/**
 * Entrepreneur marketplace — list, create, edit, and publish/close
 * the current user's startup listings.
 *
 * The investor-facing marketplace (`StartupMarketplace`) shows all ACTIVE
 * listings from every founder; this component shows only the logged-in
 * founder's own listings (DRAFT + ACTIVE + CLOSED) and gives them controls
 * to manage the lifecycle.
 */

import { useEffect, useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
import {
  Plus,
  Pencil,
  Eye,
  EyeOff,
  Archive,
  Rocket,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StartupLogo } from '@/components/shared/startup-logo';
import type { Locale } from '@/i18n/config';
import type { StartupListing } from '@/types/startup';

// ────────────────────────────────────────────────────────────────────────
// Status badge
// ────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StartupListing['status'] }) {
  const map: Record<StartupListing['status'], { label: string; className: string }> = {
    DRAFT: {
      label: 'Draft',
      className: 'bg-muted text-muted-foreground border-border',
    },
    ACTIVE: {
      label: 'Active',
      className: 'bg-primary-50 text-primary-700 border-primary-200',
    },
    CLOSED: {
      label: 'Closed',
      className: 'bg-orange-50 text-orange-700 border-orange-200',
    },
  };
  const s = map[status];
  return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
}

// ────────────────────────────────────────────────────────────────────────
// Listing form (shared between create + edit dialogs)
// ────────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  industry: string;
  fundingGoal: string;
  equityOffered: string;
  valuation: string;
}

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    industry: '',
    fundingGoal: '',
    equityOffered: '',
    valuation: '',
  };
}

function listingToForm(l: StartupListing): FormState {
  return {
    name: l.name,
    description: l.description,
    industry: l.industry,
    fundingGoal: String(l.fundingGoal),
    equityOffered: String(l.equityOffered),
    valuation: l.valuation === null ? '' : String(l.valuation),
  };
}

interface ListingFormProps {
  state: FormState;
  setState: (s: FormState) => void;
  error: string | null;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (e: React.FormEvent) => void;
}

function ListingForm({ state, setState, error, submitting, submitLabel, onSubmit }: ListingFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 py-2">
      <div>
        <Label htmlFor="sl-name">Startup name *</Label>
        <Input
          id="sl-name"
          className="mt-1"
          value={state.name}
          onChange={(e) => setState({ ...state, name: e.target.value })}
          required
          minLength={2}
          maxLength={100}
          placeholder="e.g. AlgerTech"
        />
      </div>

      <div>
        <Label htmlFor="sl-industry">Industry *</Label>
        <Input
          id="sl-industry"
          className="mt-1"
          value={state.industry}
          onChange={(e) => setState({ ...state, industry: e.target.value })}
          required
          minLength={2}
          maxLength={100}
          placeholder="e.g. FinTech, EdTech, AgriTech"
        />
      </div>

      <div>
        <Label htmlFor="sl-desc">
          Description *{' '}
          <span className="text-xs text-muted-foreground">({state.description.length}/2000)</span>
        </Label>
        <textarea
          id="sl-desc"
          value={state.description}
          onChange={(e) => setState({ ...state, description: e.target.value })}
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="What does your startup do, who's it for, and what stage are you at?"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="sl-funding">Funding goal (DZD) *</Label>
          <Input
            id="sl-funding"
            type="number"
            min={100_000}
            step={10_000}
            className="mt-1"
            value={state.fundingGoal}
            onChange={(e) => setState({ ...state, fundingGoal: e.target.value })}
            required
            placeholder="500000"
          />
          <p className="mt-1 text-xs text-muted-foreground">Minimum 100,000 DZD</p>
        </div>
        <div>
          <Label htmlFor="sl-equity">Equity offered (%) *</Label>
          <Input
            id="sl-equity"
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            className="mt-1"
            value={state.equityOffered}
            onChange={(e) => setState({ ...state, equityOffered: e.target.value })}
            required
            placeholder="15"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="sl-valuation">Pre-money valuation (DZD)</Label>
        <Input
          id="sl-valuation"
          type="number"
          min={1}
          step={10_000}
          className="mt-1"
          value={state.valuation}
          onChange={(e) => setState({ ...state, valuation: e.target.value })}
          placeholder="Optional"
        />
        <p className="mt-1 text-xs text-muted-foreground">Leave empty if you prefer not to disclose</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <DialogFooter>
        <Button type="submit" loading={submitting}>{submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Create dialog
// ────────────────────────────────────────────────────────────────────────

function CreateListingDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<FormState>(emptyForm);

  function reset() {
    setState(emptyForm());
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/startups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: state.name.trim(),
          description: state.description.trim(),
          industry: state.industry.trim(),
          fundingGoal: Number(state.fundingGoal),
          equityOffered: Number(state.equityOffered),
          valuation: state.valuation.trim() === '' ? null : Number(state.valuation),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        // Special-case the membership requirement so the user knows how to fix it.
        if (res.status === 403) {
          setError(body.error?.message ?? 'You need an active startup membership to list a startup.');
        } else {
          setError(body.error?.message ?? 'Failed to create listing. Please try again.');
        }
        return;
      }
      onCreated();
      setOpen(false);
      reset();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          New listing
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create startup listing</DialogTitle>
          <DialogDescription>
            New listings start as <strong>Draft</strong>. Publish when you&apos;re ready for investors to see it.
          </DialogDescription>
        </DialogHeader>
        <ListingForm
          state={state}
          setState={setState}
          error={error}
          submitting={submitting}
          submitLabel="Create listing"
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Edit dialog
// ────────────────────────────────────────────────────────────────────────

function EditListingDialog({
  listing,
  open,
  onOpenChange,
  onSaved,
}: {
  listing: StartupListing | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form whenever a new listing is opened for edit.
  useEffect(() => {
    if (listing && open) {
      setState(listingToForm(listing));
      setError(null);
    }
  }, [listing, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!listing) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/startups/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: state.name.trim(),
          description: state.description.trim(),
          industry: state.industry.trim(),
          fundingGoal: Number(state.fundingGoal),
          equityOffered: Number(state.equityOffered),
          valuation: state.valuation.trim() === '' ? null : Number(state.valuation),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(body.error?.message ?? 'Failed to save changes.');
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit startup listing</DialogTitle>
          <DialogDescription>
            Update the details investors see on the marketplace.
          </DialogDescription>
        </DialogHeader>
        <ListingForm
          state={state}
          setState={setState}
          error={error}
          submitting={submitting}
          submitLabel="Save changes"
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main manager
// ────────────────────────────────────────────────────────────────────────

export function StartupListingsManager() {
  const locale = useLocale() as Locale;
  const [listings, setListings] = useState<StartupListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StartupListing | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/startups?mine=true', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load listings');
      const body = (await res.json()) as { items: StartupListing[] };
      setListings(body.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function setStatus(id: string, status: StartupListing['status']) {
    startTransition(async () => {
      // Optimistic update so the UI stays responsive on slow connections.
      setListings((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status } : l)),
      );
      try {
        const res = await fetch(`/api/startups/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          // Roll back optimistic update on failure.
          await refresh();
        }
      } catch {
        await refresh();
      }
    });
  }

  function openEdit(l: StartupListing) {
    setEditing(l);
    setEditOpen(true);
  }

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading your listings…
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t load your listings</p>
              <p className="mt-1 text-muted-foreground">{fetchError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void refresh()}
              >
                Try again
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────
  if (listings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary-100 text-primary-600">
            <Rocket className="size-6" />
          </div>
          <div>
            <h3 className="font-semibold">Showcase your startup to investors</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create a listing so investors browsing the marketplace can discover your startup and reach out.
            </p>
          </div>
          <CreateListingDialog onCreated={() => void refresh()} />
        </CardContent>
      </Card>
    );
  }

  // ── List state ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {listings.length} listing{listings.length === 1 ? '' : 's'}
        </p>
        <CreateListingDialog onCreated={() => void refresh()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {listings.map((l) => (
          <Card
            key={l.id}
            className={cn(
              'flex flex-col transition-all',
              l.status === 'ACTIVE'  && 'border-primary-200',
              l.status === 'CLOSED'  && 'opacity-75',
            )}
          >
            <CardContent className="flex flex-1 flex-col p-6">
              <div className="flex items-start justify-between gap-2">
                <Badge variant="default" className="text-xs">{l.industry}</Badge>
                <StatusBadge status={l.status} />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <StartupLogo logoUrl={l.logoUrl} name={l.name} size={36} />
                <h3 className="line-clamp-1 text-base font-semibold">{l.name}</h3>
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {l.description}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Funding goal</p>
                  <p className="mt-0.5 font-semibold tabular-nums">
                    {formatCurrency(l.fundingGoal, locale)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Equity</p>
                  <p className="mt-0.5 font-semibold">{l.equityOffered}%</p>
                </div>
                {l.valuation !== null && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Pre-money valuation</p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      {formatCurrency(l.valuation, locale)}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openEdit(l)}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>

                {/* Status transitions: DRAFT → ACTIVE → CLOSED is the natural path;
                    we also allow ACTIVE ↔ DRAFT in case the founder wants to hide
                    the listing temporarily without closing the round. */}
                {l.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void setStatus(l.id, 'ACTIVE')}
                  >
                    <Eye className="size-3.5" />
                    Publish
                  </Button>
                )}
                {l.status === 'ACTIVE' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void setStatus(l.id, 'DRAFT')}
                    >
                      <EyeOff className="size-3.5" />
                      Unpublish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-orange-600"
                      onClick={() => {
                        if (confirm(`Close the funding round for "${l.name}"? You can reopen it later if needed.`)) {
                          void setStatus(l.id, 'CLOSED');
                        }
                      }}
                    >
                      <Archive className="size-3.5" />
                      Close round
                    </Button>
                  </>
                )}
                {l.status === 'CLOSED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void setStatus(l.id, 'ACTIVE')}
                  >
                    <CheckCircle2 className="size-3.5" />
                    Reopen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <EditListingDialog
        listing={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
