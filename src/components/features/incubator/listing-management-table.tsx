'use client';

/**
 * Generic management table for any "listing" (Space, Program, Event).
 * The caller passes the rows and a row→cells mapper, so the same chrome
 * (header bar, table, empty state, actions) is reused across all three
 * incubator listing pages.
 */
import { MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { ReactNode } from 'react';

export interface ListingColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'start' | 'end';
}

export interface ListingManagementTableProps<T> {
  rows: T[];
  columns: ListingColumn<T>[];
  rowKey: (row: T) => string;
  /** Called when the user clicks "New" — pass undefined to hide the button. */
  onCreate?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: ReactNode;
  /** Optional per-row actions; defaults to Edit / Delete stubs. */
  actions?: { label: string; icon?: ReactNode; onSelect: (row: T) => void; destructive?: boolean }[];
}

export function ListingManagementTable<T>({
  rows,
  columns,
  rowKey,
  onCreate,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  actions,
}: ListingManagementTableProps<T>) {
  const finalActions = actions ?? [
    { label: 'Edit', icon: <Pencil className="size-4" />, onSelect: () => {} },
    { label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: () => {}, destructive: true },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} listing{rows.length === 1 ? '' : 's'}
        </p>
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            <Plus />
            New listing
          </Button>
        )}
      </div>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <InlineEmptyState
            title={emptyTitle}
            description={emptyDescription}
            icon={emptyIcon}
            action={
              onCreate && (
                <Button size="sm" onClick={onCreate}>
                  <Plus />
                  Create
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={c.align === 'end' ? 'text-end' : undefined}
                    >
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-12" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={rowKey(row)}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={[
                          c.align === 'end' ? 'text-end' : undefined,
                          c.className,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {c.render(row)}
                      </TableCell>
                    ))}
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Actions">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {finalActions.map((a) => (
                            <DropdownMenuItem
                              key={a.label}
                              onSelect={() => a.onSelect(row)}
                              className={a.destructive ? 'text-destructive focus:text-destructive' : undefined}
                            >
                              {a.icon}
                              {a.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
