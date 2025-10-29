"use client";

import React, { useState, useEffect, useCallback } from "react";
import { notificationChannelColumns } from "./notification-channels-columns";
import { NotificationChannelsDataTable } from "./notification-channels-data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { NotificationChannel } from "./notification-channels-schema";
import { useProjectContext } from "@/hooks/use-project-context";
import { hasPermission } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";

interface NotificationProvider {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsed?: string;
}

interface NotificationChannelsComponentProps {
  onEditChannel?: (channel: NotificationChannel) => void;
  onDeleteChannel?: (channel: NotificationChannel) => void;
}

export function NotificationChannelsComponent({ 
  onEditChannel, 
  onDeleteChannel 
}: NotificationChannelsComponentProps) {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canEdit = hasPermission(normalizedRole, 'notification', 'update');
  const canDelete = hasPermission(normalizedRole, 'notification', 'delete');

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetChannels = useCallback((channels: NotificationChannel[] | ((prev: NotificationChannel[]) => NotificationChannel[])) => {
    if (mounted) {
      setChannels(channels);
    }
  }, [mounted]);

  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (mounted) {
      setIsLoading(loading);
    }
  }, [mounted]);

  const fetchChannels = useCallback(async () => {
    safeSetIsLoading(true);
    try {
      const response = await fetch('/api/notification-providers');
      if (response.ok) {
        const data = await response.json();
        // Transform the data to match our schema
        const transformedData: NotificationChannel[] = data.map((provider: NotificationProvider) => ({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          config: provider.config,
          isEnabled: provider.isEnabled,
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt,
          lastUsed: provider.lastUsed,
        }));
        safeSetChannels(transformedData);
      } else {
        console.error('Failed to fetch notification channels');
        safeSetChannels([]);
      }
    } catch (error) {
      console.error("Failed to fetch notification channels:", error);
      safeSetChannels([]);
    } finally {
      safeSetIsLoading(false);
    }
  }, [safeSetChannels, safeSetIsLoading]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="h-full flex-1 flex-col">
        <DataTableSkeleton columns={4} rows={5} />
      </div>
    );
  }

  return (
    <div className="h-full flex-1 flex-col">
      <NotificationChannelsDataTable 
        columns={notificationChannelColumns} 
        data={channels} 
        isLoading={isLoading}
        meta={{
          onEdit: onEditChannel,
          onDelete: onDeleteChannel,
          canEdit,
          canDelete,
        }}
      />
    </div>
  );
} 