/**
 * GET /api/programs/:id/status
 *
 * Public read of attendance + the caller's own application status (when
 * they're authenticated). Used by the detail sheet to show "X/Y enrolled"
 * and the "You've applied" pill in the same paint.
 */
import { findProgramById } from '@/server/bookings/program-catalog';
import { getProgramAttendance } from '@/server/bookings/service';
import { readSession } from '@/server/auth/session';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const program = await findProgramById(id);
  if (!program) return jsonError(404, 'PROGRAM_NOT_FOUND', 'Program not found');

  const session = await readSession();
  const att = await getProgramAttendance(id, session?.user.id);

  return json({
    programId: id,
    capacity: program.seatsTotal,
    taken: att.taken,
    deadline: program.deadline,
    deadlinePassed: Date.parse(program.deadline) <= Date.now(),
    mine: att.mine
      ? { bookingId: att.mine.id, status: att.mine.status, createdAt: att.mine.createdAt }
      : null,
  });
}
