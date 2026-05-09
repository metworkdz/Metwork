'use client';

/**
 * Toggle button for activating / deactivating a promo code.
 * Calls PATCH /api/admin/promo-codes/:id with { isActive } then refreshes.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Props {
  id: string;
  isActive: boolean;
}

export function PromoCodeToggle({ id, isActive }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: !isActive }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={isActive ? 'outline' : 'ghost'}
      loading={loading}
      onClick={toggle}
      className={isActive ? 'text-destructive hover:text-destructive' : 'text-muted-foreground'}
    >
      {isActive ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}
