/**
 * Local re-exports of the store types this feature touches.
 *
 * Keeps the module's imports in one place so a store refactor surfaces here
 * rather than in six files, and gives `party.ts` a structural `DbLike` it can
 * accept from inside a `db.update` mutator without importing the store's
 * private `DbShape`.
 */
export type {
  ConsultantContractAuditEvent,
  ConsultantContractOtpState,
  ConsultantContractPayoutMethod,
  ConsultantContractRecord,
  ConsultantContractStatus,
  IncubatorRecord,
  MentorRecord,
  UserRecord,
} from '@/server/db/store';

import type { IncubatorRecord, UserRecord } from '@/server/db/store';

/** The slice of the store document this feature reads. */
export interface DbLike {
  users?: UserRecord[];
  incubators?: IncubatorRecord[];
}
