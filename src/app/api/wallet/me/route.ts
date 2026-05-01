/**
 * GET /api/wallet/me
 *
 * Returns the caller's wallet, creating it on first access.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { getOrCreateWallet } from '@/server/wallet/service';
import { toWalletDto } from '@/server/wallet/serialize';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const wallet = await getOrCreateWallet(guard.user.id);
  return json(toWalletDto(wallet));
}
