'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Where the shared invoicing UI (documents, clients, convert dialog) sends its
 * requests and links. The components were written for incubators and default
 * to their routes; the freelancer dashboard (Metwork 2.0) wraps them in a
 * provider instead of forking them, so one UI serves every issuer.
 */
export interface InvoicingPaths {
  /** API root holding `/invoices` and `/clients`. */
  api: string;
  /** Dashboard root holding `/invoices` (list, new, edit). */
  dashboard: string;
  /** Where the issuer completes their legal details. */
  settings: string;
}

const INCUBATOR_PATHS: InvoicingPaths = {
  api: '/api/incubator',
  dashboard: '/dashboard/incubator',
  settings: '/dashboard/incubator/settings',
};

const InvoicingPathsContext = createContext<InvoicingPaths>(INCUBATOR_PATHS);

export function InvoicingPathsProvider({ paths, children }: { paths: InvoicingPaths; children: ReactNode }) {
  return <InvoicingPathsContext.Provider value={paths}>{children}</InvoicingPathsContext.Provider>;
}

export function useInvoicingPaths(): InvoicingPaths {
  return useContext(InvoicingPathsContext);
}
