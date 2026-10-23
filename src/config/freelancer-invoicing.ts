import type { InvoicingPaths } from '@/components/features/incubator/invoicing-paths';

/** Freelancer routes for the shared invoicing UI (see InvoicingPathsProvider). */
export const FREELANCER_INVOICING_PATHS: InvoicingPaths = {
  api: '/api/freelancer',
  dashboard: '/dashboard/freelancer',
  settings: '/dashboard/freelancer/invoices/settings',
};
