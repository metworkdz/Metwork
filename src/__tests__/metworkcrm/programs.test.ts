/**
 * METWORK OS CRM — Programs & Events service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  addParticipant,
  addTrainer,
  createProgram,
  deleteProgram,
  getProgramDetail,
  listPrograms,
  updateParticipant,
  updateProgram,
  updateTrainer,
} from '@/server/metworkcrm/services/programs';
import { createPayment } from '@/server/metworkcrm/services/payments';
import { createExpert } from '@/server/metworkcrm/services/experts';
import { createContact } from '@/server/metworkcrm/services/contacts';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { CrmServiceError, CrmNotFoundError } from '@/server/metworkcrm/services/errors';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ACTOR = 'test-actor';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ACTOR}, 'Test Actor', 'actor@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_payments`);
  await db.run(sql`DELETE FROM crm_program_participants`);
  await db.run(sql`DELETE FROM crm_program_trainers`);
  await db.run(sql`DELETE FROM crm_program_partners`);
  await db.run(sql`DELETE FROM crm_programs`);
  await db.run(sql`DELETE FROM crm_experts`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Programs — CRUD', () => {
  it('creates a program with no link required', async () => {
    const program = await createProgram({ title: 'Bootcamp Growth', type: 'BOOTCAMP', stage: 'IDEE' }, ACTOR);
    expect(program.title).toBe('Bootcamp Growth');
  });

  it('bumps stageChangedAt only when stage actually changes', async () => {
    const program = await createProgram({ title: 'X', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const same = await updateProgram(program.id, { city: 'Alger' });
    expect(same.stageChangedAt).toBe(program.stageChangedAt);

    const changed = await updateProgram(program.id, { stage: 'PLANIFICATION' });
    expect(changed.stageChangedAt).not.toBe(program.stageChangedAt);
  });

  it('throws CrmNotFoundError updating a missing program', async () => {
    await expect(updateProgram('nope', { title: 'x' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by type/stage and searches by title', async () => {
    await createProgram({ title: 'Alpha Bootcamp', type: 'BOOTCAMP', stage: 'IDEE' }, ACTOR);
    await createProgram({ title: 'Beta Webinar', type: 'WEBINAIRE', stage: 'PROMOTION' }, ACTOR);

    const byType = await listPrograms({ type: 'WEBINAIRE', limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byType.rows.map((r) => r.title)).toEqual(['Beta Webinar']);

    const byQuery = await listPrograms({ q: 'alpha', limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byQuery.rows.map((r) => r.title)).toEqual(['Alpha Bootcamp']);
  });
});

describe('Programs — money redaction (dev rules R-19)', () => {
  it('ADMIN sees the price; TEAM_MEMBER does not', async () => {
    const program = await createProgram({ title: 'Priced', type: 'FORMATION', stage: 'IDEE', price: 15000 }, ACTOR);

    const asAdmin = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(asAdmin.program.price).toBe(15000);

    const asMember = await getProgramDetail(program.id, { role: 'TEAM_MEMBER' });
    expect(asMember.program.price).toBeNull();
  });

  it('redacts payment amounts for TEAM_MEMBER too', async () => {
    const program = await createProgram({ title: 'Paid', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    await createPayment({ label: 'Acompte', amount: 20000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', programId: program.id }, ACTOR);

    const asMember = await getProgramDetail(program.id, { role: 'TEAM_MEMBER' });
    expect(asMember.payments[0]!.amount).toBeNull();
    const asAdmin = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(asAdmin.payments[0]!.amount).toBe(20000);
  });
});

describe('Programs — participants, trainers (Trainer Confirmed stage data)', () => {
  it('registers a walk-in participant with no contact, and a real contact', async () => {
    const program = await createProgram({ title: 'Roster', type: 'FORMATION', stage: 'INSCRIPTIONS' }, ACTOR);
    const contact = (await createContact({ firstName: 'Yacine', lastName: 'B', status: 'ACTIF' }, ACTOR)).contact;

    await addParticipant(program.id, { fullName: 'Walk-in Sam', status: 'INSCRIT', attended: false }, ACTOR);
    await addParticipant(program.id, { contactId: contact.id, status: 'INSCRIT', attended: false }, ACTOR);

    const detail = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(detail.participants).toHaveLength(2);
    expect(detail.participants.map((p) => p.displayName).sort()).toEqual(['Walk-in Sam', 'Yacine B'].sort());
  });

  it('rejects updating a participant to have neither a contact nor a name', async () => {
    const program = await createProgram({ title: 'Roster2', type: 'FORMATION', stage: 'INSCRIPTIONS' }, ACTOR);
    await addParticipant(program.id, { fullName: 'Walk-in', status: 'INSCRIT', attended: false }, ACTOR);
    const detail = await getProgramDetail(program.id, { role: 'ADMIN' });
    const participantId = detail.participants[0]!.id;

    await expect(updateParticipant(participantId, { fullName: '' })).rejects.toBeInstanceOf(CrmServiceError);
  });

  it('confirms a trainer — the "Trainer Confirmed" stage data — and blocks double-linking', async () => {
    const program = await createProgram({ title: 'Trainers', type: 'FORMATION', stage: 'PLANIFICATION' }, ACTOR);
    const expert = await createExpert({ name: 'Coach', pipelineStage: 'ACTIF' }, ACTOR);

    await addTrainer(program.id, expert.id, { confirmed: false });
    await expect(addTrainer(program.id, expert.id, { confirmed: false })).rejects.toBeInstanceOf(CrmServiceError);

    let detail = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(detail.trainers[0]!.confirmed).toBe(false);

    await updateTrainer(detail.trainers[0]!.id, { confirmed: true, fee: 40000 });
    detail = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(detail.trainers[0]!.confirmed).toBe(true);
    expect(detail.trainers[0]!.fee).toBe(40000);
    expect(detail.trainers[0]!.expertName).toBe('Coach');
  });
});

describe('Programs — delete guard', () => {
  it('blocks deleting a program that is the sole link on a task', async () => {
    const program = await createProgram({ title: 'Blocked', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', programId: program.id } as never, ACTOR);

    let error: unknown;
    try {
      await deleteProgram(program.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting a program with no dependents', async () => {
    const program = await createProgram({ title: 'Free', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    await deleteProgram(program.id);
    await expect(getProgramDetail(program.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('blocks deleting a program that is the sole link on a payment, with the specific message not the generic 409', async () => {
    // Regression: crm_payments carries its own anti-orphan CHECK, the same
    // failure mode as crm_tasks/crm_interactions — a program deletion that
    // only checked those two would pass the pre-check, then have the raw DB
    // delete throw, surfacing the unhelpful generic catch-all message.
    const program = await createProgram({ title: 'Payment-blocked', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    await createPayment({ label: 'Acompte', amount: 5000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', programId: program.id }, ACTOR);

    let error: unknown;
    try {
      await deleteProgram(program.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    const err = error as CrmServiceError;
    expect(err.status).toBe(409);
    expect(err.message).toContain('paiements sans autre lien');
    expect(err.message).not.toContain('des éléments y sont encore rattachés');

    // Nothing was deleted — the program and its payment both survive.
    const detail = await getProgramDetail(program.id, { role: 'ADMIN' });
    expect(detail.program.id).toBe(program.id);
    expect(detail.payments).toHaveLength(1);
  });

  it('allows deleting a program once its sole-link payment is given another link', async () => {
    const org = (await createOrganization({ name: 'Payer Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR));
    const program = await createProgram({ title: 'Payment-unblocked', type: 'FORMATION', stage: 'IDEE' }, ACTOR);
    const payment = await createPayment({ label: 'Acompte', amount: 5000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', programId: program.id }, ACTOR);
    await db.run(sql`UPDATE crm_payments SET organization_id = ${org.id} WHERE id = ${payment.id}`);

    await deleteProgram(program.id); // must not throw
    const rows = await db.all<{ program_id: string | null; organization_id: string | null }>(
      sql`SELECT program_id, organization_id FROM crm_payments WHERE id = ${payment.id}`,
    );
    expect(rows[0]?.program_id).toBeNull();
    expect(rows[0]?.organization_id).toBe(org.id);
  });
});
