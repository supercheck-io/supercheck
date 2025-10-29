"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Key, ExternalLink, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { UrlTriggerTooltip } from "./url-trigger-tooltip";
import Link from "next/link";

interface ApiKey {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
}

interface CiCdStatusProps {
  jobId: string;
  compact?: boolean;
}

export function CiCdStatus({ jobId, compact = false }: CiCdStatusProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApiKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/jobs/${jobId}/api-keys`);
      const data = await response.json();

      if (data.success) {
        setApiKeys(data.apiKeys);
      } else {
        setError("Failed to load API keys");
      }
    } catch (error) {
      console.error("Error loading API keys:", error);
      setError("Failed to load API keys");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);
  
  useEffect(() => {
    loadApiKeys();
  }, [jobId, loadApiKeys]);



  const activeKeysCount = apiKeys.filter(key => key.enabled).length;
  const totalKeysCount = apiKeys.length;
  const hasActiveKeys = activeKeysCount > 0;

  if (isLoading) {
    return (
      <Card className={compact ? "p-3" : ""}>
        <CardContent className={compact ? "p-0" : ""}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading CI/CD status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={compact ? "p-3" : ""}>
        <CardContent className={compact ? "p-0" : ""}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-600">{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">CI/CD:</span>
        </div>
        
        {hasActiveKeys ? (
          <div className="flex items-center gap-2">
            <Badge variant="default" className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {activeKeysCount} Active
            </Badge>
            <UrlTriggerTooltip jobId={jobId} />
          </div>
        ) : totalKeysCount > 0 ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {totalKeysCount} Disabled
            </Badge>
              <UrlTriggerTooltip jobId={jobId} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="outline">Not Configured</Badge>
                <UrlTriggerTooltip jobId={jobId} />
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
              <Key className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium">Remote Job Trigger</h4>
                <UrlTriggerTooltip jobId={jobId} />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {hasActiveKeys ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    <span>{activeKeysCount} active API key{activeKeysCount !== 1 ? 's' : ''}</span>
                  </>
                ) : totalKeysCount > 0 ? (
                  <>
                    <AlertCircle className="h-3 w-3 text-yellow-500" />
                    <span>{totalKeysCount} disabled API key{totalKeysCount !== 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 text-muted-foreground" />
                    <span>No API keys configured</span>
                  </>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {hasActiveKeys && (
              <Badge variant="default" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Active
              </Badge>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/jobs/${jobId}/edit`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Manage Keys
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 