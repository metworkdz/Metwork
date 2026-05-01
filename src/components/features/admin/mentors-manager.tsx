'use client';

/**
 * Admin mentors manager.
 *
 *   - Card grid (mentors are visual; a table would hide the photos)
 *   - Per-card action menu: Edit / Delete
 *   - Add button → form dialog
 *   - Mutations are local-state-driven; the API is the source of truth
 *     and we re-sync on success
 */
import { useState } from 'react';
import { MoreVertical, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { mentorsService } from '@/services/mentors.service';
import { ApiClientError } from '@/lib/api-client';
import { MentorFormDialog } from './mentor-form-dialog';
import { LandingMentorCard } from '@/components/features/mentors/landing-mentor-card';
import type { Mentor } from '@/types/mentor';

export function MentorsManager({ initial }: { initial: Mentor[] }) {
  const [mentors, setMentors] = useState<Mentor[]>(initial);
  const [editing, setEditing] = useState<Mentor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Mentor | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(m: Mentor) {
    setEditing(m);
    setFormOpen(true);
  }

  function onSaved(saved: Mentor) {
    setMentors((current) => {
      const idx = current.findIndex((m) => m.id === saved.id);
      if (idx === -1) return [...current, saved];
      const next = current.slice();
      next[idx] = saved;
      return next;
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await mentorsService.remove(deleting.id);
      setMentors((c) => c.filter((m) => m.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDeleteError(err.message || 'Delete failed');
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      }
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {mentors.length} mentor{mentors.length === 1 ? '' : 's'} in the roster
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus />
          Add mentor
        </Button>
      </div>

      {mentors.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No mentors yet"
            description="Add the first mentor to populate the landing-page carousel."
            icon={<UserPlus className="size-5 text-muted-foreground" />}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus />
                Add mentor
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {mentors.map((m) => (
            <div key={m.id} className="relative">
              <LandingMentorCard mentor={m} hoverable={false} />
              <div className="absolute end-2 top-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-8 bg-background/80 backdrop-blur-sm hover:bg-background"
                      aria-label={`Actions for ${m.fullName}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openEdit(m)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setDeleting(m)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      <MentorFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSaved={onSaved}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete mentor?</DialogTitle>
            <DialogDescription>
              {deleting ? (
                <>
                  This will remove <span className="font-medium text-foreground">{deleting.fullName}</span> from
                  the landing-page carousel. This action can&apos;t be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={deleteSubmitting} onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
