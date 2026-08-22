'use client';

/**
 * Admin consultant-contracts manager.
 *
 * A table rather than a card grid: this is a compliance queue, and the questions
 * an admin brings to it — who has signed, who hasn't, what happened when — are
 * answered by scanning rows and reading timestamps.
 *
 * The rules this screen renders are NOT enforced here. Editing is refused by
 * the server once a contract leaves DRAFT, voiding requires a confirmation flag
 * in the request body, and the resend throttle is the same one the consultant
 * hits. The disabled buttons below are a courtesy so an admin does not click
 * into a refusal — they are not the control.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Download, FileSignature, FileText,
  Loader2, MoreVertical, Pencil, Plus, Send, ShieldAlert, XCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { ApiClientError } from '@/lib/api-client';
import {
  contractsService,
  type AdminContract,
  type ContractAuditEntry,
  type ContractConsultantOption,
} from '@/services/contracts.service';

/* ─────────────────── Presentation helpers ─────────────────── */

const STATUS_VARIANT: Record<AdminContract['status'], 'default' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'default',
  PENDING_SIGNATURE: 'warning',
  SIGNED: 'success',
  VOIDED: 'danger',
};

const STATUS_LABEL: Record<AdminContract['status'], string> = {
  DRAFT: 'Draft',
  PENDING_SIGNATURE: 'Awaiting signature',
  SIGNED: 'Signed',
  VOIDED: 'Voided',
};

const PAYOUT_LABEL: Record<AdminContract['payoutMethod'], string> = {
  BANK_TRANSFER: 'Bank transfer',
  CCP: 'CCP (Algérie Poste)',
  CHEQUE: 'Cheque',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** Turn an ApiClientError into something an admin can act on. */
function describeError(e: unknown): string {
  if (!(e instanceof ApiClientError)) return 'Something went wrong. Please try again.';
  const details = e.details as { missing?: string[]; retryAfterSeconds?: number } | undefined;
  switch (e.code) {
    case 'NO_VERIFIED_PHONE':
      return 'This consultant has no verified phone number. They must verify it in their portal before a contract can be sent — the signing code is what ties the signature to them.';
    case 'METWORK_LEGAL_INCOMPLETE':
      return `Metwork's legal identifiers are incomplete (${(details?.missing ?? []).join(', ')}). Fill them in under Settings before issuing contracts.`;
    case 'NOT_DRAFT':
      return 'This contract has already been sent and can no longer be edited. Void it and create a new one.';
    case 'NOT_PENDING':
      return 'Only a contract awaiting signature can be voided.';
    case 'OTP_THROTTLED':
    case 'OTP_LOCKED':
      return `Resend limit reached. Try again in about ${Math.ceil((details?.retryAfterSeconds ?? 60) / 60)} minute(s).`;
    default:
      return e.message || 'Something went wrong. Please try again.';
  }
}

/* ─────────────────── Root ─────────────────── */

export function ContractsManager() {
  const [contracts, setContracts] = useState<AdminContract[]>([]);
  const [consultants, setConsultants] = useState<ContractConsultantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AdminContract | null>(null);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<AdminContract | null>(null);
  const [viewing, setViewing] = useState<AdminContract | null>(null);

  const load = useCallback(async () => {
    try {
      const { contracts: rows, consultants: options } = await contractsService.list();
      setContracts(rows);
      setConsultants(options);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => { setError(null); setCreating(true); }}>
          <Plus className="size-4" /> New contract
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {contracts.length === 0 ? (
            <InlineEmptyState
              icon={<FileSignature className="size-8 opacity-30" />}
              title="No contracts yet"
              description="Create a commission contract for a consultant, then send it for signature."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Consultant</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Commission</th>
                    <th className="px-4 py-3">Payout</th>
                    <th className="px-4 py-3">Sent</th>
                    <th className="px-4 py-3">Signed</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewing(c)}
                          className="text-start font-medium hover:underline"
                        >
                          {c.consultantName}
                        </button>
                        <div className="text-xs text-muted-foreground">{c.consultantEmail ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                        {c.locked && (
                          <span className="ms-2 text-xs text-destructive" title="Signing is locked after too many failed codes">
                            locked
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {c.status === 'DRAFT' ? (
                          <span className="text-xs text-muted-foreground" title="The rate is resolved and frozen when the contract is sent">
                            set on send
                          </span>
                        ) : pct(c.commissionRate)}
                      </td>
                      <td className="px-4 py-3 text-xs">{PAYOUT_LABEL[c.payoutMethod]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtDateTime(c.sentAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtDateTime(c.signedAt)}</td>
                      <td className="px-4 py-3 text-end">
                        <RowActions
                          contract={c}
                          onEdit={() => { setError(null); setEditing(c); }}
                          onView={() => setViewing(c)}
                          onVoid={() => { setError(null); setVoiding(c); }}
                          onChanged={load}
                          onError={setError}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ContractFormDialog
          open
          contract={editing}
          consultants={consultants}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await load(); }}
          onError={setError}
        />
      )}

      {voiding && (
        <VoidDialog
          contract={voiding}
          onClose={() => setVoiding(null)}
          onVoided={async () => { setVoiding(null); await load(); }}
          onError={setError}
        />
      )}

      {viewing && <DetailDialog contract={viewing} onClose={() => setViewing(null)} onError={setError} />}
    </div>
  );
}

/* ─────────────────── Row actions ─────────────────── */

function RowActions({
  contract, onEdit, onView, onVoid, onChanged, onError,
}: {
  contract: AdminContract;
  onEdit: () => void;
  onView: () => void;
  onVoid: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      onError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const isDraft = contract.status === 'DRAFT';
  const isPending = contract.status === 'PENDING_SIGNATURE';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={busy} aria-label={`Actions for ${contract.consultantName}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>
          <FileText className="size-4" /> View &amp; audit trail
        </DropdownMenuItem>

        {/* Editing is refused server-side once sent; hiding it here just avoids
            walking the admin into a 409. */}
        {isDraft && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
        )}
        {isDraft && (
          <DropdownMenuItem onClick={() => void run(() => contractsService.send(contract.id))}>
            <Send className="size-4" /> Send for signature
          </DropdownMenuItem>
        )}

        {isPending && (
          <DropdownMenuItem onClick={() => void run(() => contractsService.resendOtp(contract.id))}>
            <Clock className="size-4" /> Resend signing code
          </DropdownMenuItem>
        )}
        {isPending && (
          <DropdownMenuItem onClick={onVoid} className="text-destructive focus:text-destructive">
            <XCircle className="size-4" /> Void
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────── Create / edit ─────────────────── */

function ContractFormDialog({
  open, contract, consultants, onClose, onSaved, onError,
}: {
  open: boolean;
  contract: AdminContract | null;
  consultants: ContractConsultantOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const isEdit = contract !== null;
  const [consultantId, setConsultantId] = useState(contract?.consultantId ?? '');
  const [body, setBody] = useState(contract?.contentSnapshot ?? '');
  const [payoutMethod, setPayoutMethod] = useState<AdminContract['payoutMethod']>(contract?.payoutMethod ?? 'BANK_TRANSFER');
  const [payoutDetails, setPayoutDetails] = useState(contract?.payoutDetails ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    onError(null);
    try {
      if (isEdit) {
        await contractsService.update(contract.id, {
          contentSnapshot: body,
          payoutMethod,
          payoutDetails: payoutDetails.trim() || null,
        });
      } else {
        await contractsService.create({
          consultantId,
          contentSnapshot: body,
          payoutMethod,
          payoutDetails: payoutDetails.trim() || null,
        });
      }
      await onSaved();
    } catch (e) {
      onError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit draft contract' : 'New commission contract'}</DialogTitle>
          <DialogDescription>
            The contract body is French — it is the legal instrument itself and is not translated.
            The commission rate is not set here: it is resolved from the active commission rule and
            frozen when the contract is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contract-consultant">Consultant</Label>
            <select
              id="contract-consultant"
              value={consultantId}
              onChange={(e) => setConsultantId(e.target.value)}
              // The consultant is frozen at creation: re-pointing a contract at
              // a different person would silently change who is bound by it.
              disabled={isEdit}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">Select a consultant…</option>
              {consultants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}{m.phoneVerified ? '' : ' — phone not verified'}
                </option>
              ))}
            </select>
            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                A contract can only be sent to a consultant with a verified phone: the signing code
                is what ties the signature to them.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-body">Contract body (French)</Label>
            <Textarea
              id="contract-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              dir="ltr"
              lang="fr"
              placeholder="ENTRE LES SOUSSIGNÉS : …"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contract-payout">Payout method</Label>
              <select
                id="contract-payout"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value as AdminContract['payoutMethod'])}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(PAYOUT_LABEL) as AdminContract['payoutMethod'][]).map((k) => (
                  <option key={k} value={k}>{PAYOUT_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract-payout-details">Payout details (optional)</Label>
              <Input
                id="contract-payout-details"
                value={payoutDetails}
                onChange={(e) => setPayoutDetails(e.target.value)}
                placeholder="Filled from their payout account on send"
              />
              <p className="text-xs text-muted-foreground">
                Left blank, this is filled from the consultant&apos;s own payout account when the
                contract is sent, with the account number masked.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !body.trim() || (!isEdit && !consultantId)}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Save draft' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── Void confirmation ─────────────────── */

function VoidDialog({
  contract, onClose, onVoided, onError,
}: {
  contract: AdminContract;
  onClose: () => void;
  onVoided: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    onError(null);
    try {
      await contractsService.void(contract.id);
      await onVoided();
    } catch (e) {
      onError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void this contract?</DialogTitle>
          <DialogDescription>
            {contract.consultantName}&apos;s contract will be permanently voided and can no longer
            be signed. Any signing code already sent stops working. This cannot be undone — issuing
            revised terms means creating a new contract.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Void contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── Detail + audit trail ─────────────────── */

const EVENT_LABEL: Record<ContractAuditEntry['event'], string> = {
  CREATED: 'Draft created',
  SENT: 'Sent for signature',
  VIEWED: 'Opened by consultant',
  OTP_SENT: 'Signing code sent',
  RESEND_OTP: 'Signing code resent',
  OTP_FAILED: 'Incorrect code entered',
  OTP_VERIFIED: 'Code verified',
  SIGNED: 'Signed',
  VOIDED: 'Voided',
};

function DetailDialog({
  contract, onClose, onError,
}: {
  contract: AdminContract;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  /**
   * Fetch the link at click time. The one in the list response was minted when
   * the page loaded and will usually have expired by now.
   */
  async function openPdf() {
    setBusy(true);
    onError(null);
    try {
      const { url } = await contractsService.pdfUrl(contract.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      onError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contract.consultantName}</DialogTitle>
          <DialogDescription>
            {STATUS_LABEL[contract.status]} · created {fmtDateTime(contract.createdAt)} · version {contract.templateVersion}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <Row label="Commission" value={contract.status === 'DRAFT' ? 'Set when sent' : pct(contract.commissionRate)} />
            <Row label="Consultant share" value={contract.status === 'DRAFT' ? '—' : pct(1 - contract.commissionRate)} />
            <Row label="Payout method" value={PAYOUT_LABEL[contract.payoutMethod]} />
            <Row label="Payout details" value={contract.payoutDetails ?? '—'} />
            <Row label="Signer phone" value={contract.signerPhoneSnapshot || '—'} />
            <Row label="Signed" value={fmtDateTime(contract.signedAt)} />
          </dl>

          {contract.status === 'SIGNED' && (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-emerald-600" /> Signed document
                </div>
                <Button variant="outline" size="sm" onClick={() => void openPdf()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Open PDF
                </Button>
              </div>
              {/* The hash is shown so an admin can verify a downloaded copy is
                  byte-identical to what was signed. */}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">SHA-256</span>{' '}
                <code className="break-all font-mono">{contract.finalPdfHash ?? '—'}</code>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="size-4 text-muted-foreground" /> Audit trail
            </h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.auditTrail.map((e, i) => (
                    <tr key={`${e.event}-${e.timestamp}-${i}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{EVENT_LABEL[e.event] ?? e.event}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                        {fmtDateTime(e.timestamp)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{e.actorId.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Contract body</h3>
            <div
              dir="ltr"
              lang="fr"
              className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border p-3 text-xs leading-relaxed"
            >
              {contract.contentSnapshot}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
