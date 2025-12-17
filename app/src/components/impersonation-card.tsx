"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UserX, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { useImpersonationStatus } from '@/hooks/use-impersonation-status';

/**
 * ImpersonationCard - Shows impersonation status in sidebar
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Uses cached useImpersonationStatus hook (React Query)
 * - Status is fetched once and cached, not on every sidebar mount
 */
export function ImpersonationCard() {
  const { isImpersonating, impersonatedUser, invalidate } = useImpersonationStatus();
  const [stopping, setStopping] = useState(false);
  const { state } = useSidebar();
  const router = useRouter();

  const stopImpersonation = async () => {
    setStopping(true);
    try {
      const response = await fetch('/api/admin/stop-impersonation', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Returned to admin account');
        // Invalidate the cache so it refetches after stopping
        invalidate();
        router.push('/');
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        toast.error(data.error || 'Failed to stop impersonation');
      }
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      toast.error('Failed to stop impersonation');
    } finally {
      setStopping(false);
    }
  };

  if (!isImpersonating) {
    return null;
  }

  const tooltipText = `Impersonating: ${impersonatedUser?.name || ''} (${impersonatedUser?.email || ''})`;

  // Show compact button when sidebar is collapsed
  if (state === 'collapsed') {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={tooltipText}
            onClick={stopImpersonation}
            disabled={stopping}
            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
          >
            <User className="h-4 w-4" />
            <span>Stop Impersonation</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // Show detailed card when sidebar is expanded
  return (
    <Card className="mx-2 mb-2 bg-card">
      <CardContent className="p-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <User className="h-4 w-4 text-orange-600" />
            <span className="text-xs font-medium">Impersonating</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={stopImpersonation}
            disabled={stopping}
            className="h-6 px-2 text-xs text-orange-600"
          >
            <UserX className="h-4 w-4" /> Stop
          </Button>
        </div>
        <div className="text-xs font-medium truncate">
          {impersonatedUser?.name}
        </div>
        <div className="text-xs truncate">
          {impersonatedUser?.email}
        </div>
      </CardContent>
    </Card>
  );
}