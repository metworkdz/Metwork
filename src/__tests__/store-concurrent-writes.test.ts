/**
 * Two serverless instances, one document.
 *
 * Each instance caches the store for a few seconds. A plain upsert let an
 * instance with an older copy overwrite the document and erase what another
 * instance had just written — a program's feedback invites disappeared this
 * way and every emailed link opened « Lien introuvable ». Writes are now
 * conditional on the revision they were computed from.
 */
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/server/db/store';
import { writeMockBlobAsAnotherInstance } from './setup';

const invite = (id: string) => ({ id }) as never;

describe('store writes across instances', () => {
  it('a write from a stale copy keeps what another instance wrote in between', async () => {
    await db.update((d) => { d.feedbackInvites = []; });
    await db.read(); // this instance now holds a cached copy

    writeMockBlobAsAnotherInstance((blob) => {
      (blob.feedbackInvites as unknown[]).push({ id: 'from-instance-b' });
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.update((d) => { d.feedbackInvites!.push(invite('from-instance-a')); });
    warn.mockRestore();

    const ids = (await db.read()).feedbackInvites!.map((i) => i.id);
    expect(ids).toEqual(['from-instance-b', 'from-instance-a']);
  });

  it('the mutator re-runs on fresh data, so its result reflects what it finally wrote', async () => {
    await db.update((d) => { d.feedbackInvites = []; });
    await db.read();
    writeMockBlobAsAnotherInstance((blob) => {
      (blob.feedbackInvites as unknown[]).push({ id: 'b' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = await db.update((d) => d.feedbackInvites!.length);
    warn.mockRestore();
    expect(seen).toBe(1);
  });

  it('bumps the revision on every write', async () => {
    await db.update((d) => { d.feedbackInvites = []; });
    const r1 = (await db.read())._rev!;
    await db.update((d) => { d.feedbackInvites!.push(invite('x')); });
    expect((await db.read())._rev).toBe(r1 + 1);
  });

  it('a mutator that throws leaves nothing half-applied in the cache', async () => {
    await db.update((d) => { d.feedbackInvites = []; });
    await expect(db.update((d) => {
      d.feedbackInvites!.push(invite('half'));
      throw new Error('validation failed');
    })).rejects.toThrow('validation failed');
    expect((await db.read()).feedbackInvites).toEqual([]);
  });
});
