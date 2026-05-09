'use client';

import { useState } from 'react';
import { Building2, Briefcase, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { StatCard } from '@/components/shared/stat-card';
import type { BookingRecord } from '@/server/db/store';

type BookingRow = BookingRecord & { customerName: string; customerEmail: string };

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger' | 'default' | 'outline'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
  COMPLETED: 'default',
  REFUNDED: 'outline',
};

const KIND_ICON: Record<string, React.ReactNode> = {
  SPACE:   <Building2 className="size-3.5" />,
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT:   <Calendar className="size-3.5" />,
};

interface Props { initial: BookingRow[] }

export function AdminBookingsTable({ initial }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [kindFilter, setKindFilter] = useState<string>('ALL');

  const filtered = initial.filter((b) => {
    if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
    if (kindFilter !== 'ALL' && b.itemKind !== kindFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !b.customerName.toLowerCase().includes(q) &&
        !b.customerEmail.toLowerCase().includes(q) &&
        !b.itemName.toLowerCase().includes(q) &&
        !b.vendorName.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const pending = initial.filter((b) => b.status === 'PENDING').length;
  const confirmed = initial.filter((b) => b.status === 'CONFIRMED').length;
  const gross = initial
    .filter((b) => b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
    .reduce((s, b) => s + b.totalAmount, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pending review" value={pending} icon={Calendar} />
        <StatCard label="Confirmed" value={confirmed} />
        <StatCard label="Gross revenue" value={`${gross.toLocaleString()} DZD`} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search customer, item, vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="CONFIRMED">Confirmed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="SPACE">Space</SelectItem>
            <SelectItem value="PROGRAM">Program</SelectItem>
            <SelectItem value="EVENT">Event</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title="No bookings"
              description="No bookings match your filters."
              icon={<Calendar className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-xs text-muted-foreground">{b.customerEmail}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{b.itemName}</div>
                        <Badge variant="outline" className="mt-1 gap-1 text-xs">
                          {KIND_ICON[b.itemKind]}
                          {b.itemKind.charAt(0) + b.itemKind.slice(1).toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.vendorName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(b.startsAt).toLocaleString([], {
                          dateStyle: 'medium', timeStyle: 'short',
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'}>
                          {b.status.charAt(0) + b.status.slice(1).toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium text-sm">
                        {b.totalAmount === 0
                          ? <span className="text-muted-foreground">Free</span>
                          : `${b.totalAmount.toLocaleString()} DZD`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
