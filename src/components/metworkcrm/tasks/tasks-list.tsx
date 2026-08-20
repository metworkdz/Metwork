'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import {
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { TaskFormDialog, type TaskRow } from './task-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

const STATUS_OPTIONS = Object.entries(TASK_STATUS_LABELS);

export function TasksList() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    const res = await fetch(`/api/metworkcrm/tasks?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, status, priority, offset]);

  useEffect(() => {
    setOffset(0);
  }, [q, status, priority]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function quickSetStatus(task: TaskRow, next: string) {
    setRows((prev) => prev.map((r) => (r.id === task.id ? { ...r, status: next } : r)));
    const res = await fetch(`/api/metworkcrm/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par titre…" className="h-10 w-full max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
          <option value="">Toutes les priorités</option>
          {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <TaskFormDialog
          onSaved={load}
          trigger={
            <CrmButton size="sm" className="ms-auto">
              <Plus className="size-4" aria-hidden /> Nouvelle tâche
            </CrmButton>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titre</TableHead>
              <TableHead>Priorité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">
                  Aucune tâche trouvée.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((task) => (
                <TaskFormDialog
                  key={task.id}
                  task={task}
                  onSaved={load}
                  trigger={
                    <TableRow className="cursor-pointer">
                      <TableCell className="font-medium text-[var(--crm-black)]">{task.title}</TableCell>
                      <TableCell>
                        <Badge variant={TASK_PRIORITY_BADGE[task.priority] ?? 'default'}>
                          {TASK_PRIORITY_LABELS[task.priority] ?? task.priority}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <select
                          value={task.status}
                          onChange={(e) => quickSetStatus(task, e.target.value)}
                          className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-[var(--crm-green)]"
                        >
                          {STATUS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>{task.dueDate ?? '—'}</TableCell>
                      <TableCell />
                    </TableRow>
                  }
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > limit ? (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>
            {offset + 1}–{Math.min(offset + limit, total)} sur {total}
          </span>
          <div className="flex gap-2">
            <CrmButton size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Précédent
            </CrmButton>
            <CrmButton size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Suivant
            </CrmButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
