/**
 * Freelancer workspace — THE service for the project board and gigs.
 * Every read and write is scoped to its owner; a record belonging to someone
 * else is "not found", never "forbidden", so ids can't be probed.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type FreelancerProjectRecord,
  type FreelancerProjectStatus,
  type GigRecord,
} from '@/server/db/store';
import { entitlementsForUser, withinLimit } from '@/lib/entitlements';

export interface ProjectInput {
  title: string;
  clientName: string | null;
  clientId: string | null;
  status: FreelancerProjectStatus;
  dueDate: string | null;
  amount: number | null;
  notes: string | null;
}

export function listProjects(data: { freelancerProjects?: FreelancerProjectRecord[] }, freelancerId: string): FreelancerProjectRecord[] {
  return (data.freelancerProjects ?? [])
    .filter((p) => p.freelancerId === freelancerId)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt));
}

export async function createProject(freelancerId: string, input: ProjectInput): Promise<FreelancerProjectRecord> {
  const now = new Date().toISOString();
  return db.update((d) => {
    if (!Array.isArray(d.freelancerProjects)) d.freelancerProjects = [];
    // A client id must be one of the freelancer's own clients, or it is dropped.
    const ownClient = input.clientId && (d.clients ?? []).some((c) => c.id === input.clientId && c.freelancerId === freelancerId);
    const project: FreelancerProjectRecord = {
      id: randomUUID(),
      freelancerId,
      ...input,
      clientId: ownClient ? input.clientId : null,
      createdAt: now,
      updatedAt: now,
    };
    d.freelancerProjects.push(project);
    return project;
  });
}

export async function updateProject(
  freelancerId: string,
  id: string,
  patch: Partial<ProjectInput>,
): Promise<FreelancerProjectRecord | null> {
  return db.update((d) => {
    const p = (d.freelancerProjects ?? []).find((x) => x.id === id && x.freelancerId === freelancerId);
    if (!p) return null;
    if (patch.clientId !== undefined && patch.clientId !== null) {
      const ownClient = (d.clients ?? []).some((c) => c.id === patch.clientId && c.freelancerId === freelancerId);
      if (!ownClient) patch = { ...patch, clientId: null };
    }
    Object.assign(p, patch, { updatedAt: new Date().toISOString() });
    return { ...p };
  });
}

export async function deleteProject(freelancerId: string, id: string): Promise<boolean> {
  return db.update((d) => {
    const before = (d.freelancerProjects ?? []).length;
    d.freelancerProjects = (d.freelancerProjects ?? []).filter((x) => !(x.id === id && x.freelancerId === freelancerId));
    return d.freelancerProjects.length < before;
  });
}

// ── Gigs ──────────────────────────────────────────────────────────────────

export interface GigInput {
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  isActive: boolean;
}

export function listGigs(data: { gigs?: GigRecord[] }, freelancerId: string): GigRecord[] {
  return (data.gigs ?? []).filter((g) => g.freelancerId === freelancerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type SaveGigResult = { ok: true; gig: GigRecord } | { ok: false; reason: 'NOT_FOUND' | 'PLAN_LIMIT_REACHED'; limit?: number };

/**
 * Create (no id) or update a gig. The Free-plan limit counts ACTIVE gigs, so
 * a freelancer can keep drafts and switch which ones are live.
 */
export async function saveGig(freelancerId: string, input: GigInput, id?: string): Promise<SaveGigResult> {
  const now = new Date().toISOString();
  return db.update((d) => {
    if (!Array.isArray(d.gigs)) d.gigs = [];
    const user = d.users.find((u) => u.id === freelancerId);
    const ent = user ? entitlementsForUser(user) : null;
    const limit = ent?.audience === 'FREELANCER' ? ent.gigs : 0;
    const existing = id ? d.gigs.find((g) => g.id === id && g.freelancerId === freelancerId) : undefined;
    if (id && !existing) return { ok: false, reason: 'NOT_FOUND' } as const;
    const becomingActive = input.isActive && !existing?.isActive;
    const active = d.gigs.filter((g) => g.freelancerId === freelancerId && g.isActive).length;
    if (becomingActive && !withinLimit(limit, active)) {
      return { ok: false, reason: 'PLAN_LIMIT_REACHED', limit: limit ?? undefined } as const;
    }
    if (existing) {
      Object.assign(existing, input, { updatedAt: now });
      return { ok: true, gig: { ...existing } } as const;
    }
    const gig: GigRecord = { id: randomUUID(), freelancerId, ...input, createdAt: now, updatedAt: now };
    d.gigs.push(gig);
    return { ok: true, gig } as const;
  });
}

export async function deleteGig(freelancerId: string, id: string): Promise<boolean> {
  return db.update((d) => {
    const before = (d.gigs ?? []).length;
    d.gigs = (d.gigs ?? []).filter((g) => !(g.id === id && g.freelancerId === freelancerId));
    return d.gigs.length < before;
  });
}
