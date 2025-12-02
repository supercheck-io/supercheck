"use client";

import React from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { useStatusPageFavicon } from "./use-status-page-favicon";

type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled";

type IncidentImpact = "none" | "minor" | "major" | "critical";

type IncidentUpdate = {
  id: string;
  status: IncidentStatus;
  body: string;
  createdAt: Date | null;
};

type Incident = {
  id: string;
  name: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  createdAt: Date | null;
  resolvedAt: Date | null;
  updates: IncidentUpdate[];
  statusPage?: {
    id: string;
    name: string;
    headline: string | null;
    subdomain: string;
  };
};

type PublicIncidentDetailProps = {
  incident: Incident;
  idOrSubdomain: string;
  faviconLogo?: string | null;
  transactionalLogo?: string | null;
  statusPageHeadline?: string | null;
  isPublicView?: boolean;
};

export function PublicIncidentDetail({
  incident,
  idOrSubdomain,
  faviconLogo,
  transactionalLogo,
  statusPageHeadline,
  isPublicView = false,
}: PublicIncidentDetailProps) {
  useStatusPageFavicon(faviconLogo);

  const getStatusColor = (status: IncidentStatus) => {
    switch (status) {
      case "resolved":
        return "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
      case "monitoring":
        return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
      case "identified":
        return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
      case "investigating":
        return "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800";
      case "scheduled":
        return "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700";
    }
  };

  const getImpactColor = (impact: IncidentImpact) => {
    switch (impact) {
      case "critical":
        return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
      case "major":
        return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
      case "minor":
        return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700";
    }
  };

  const formatStatus = (status: IncidentStatus) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const formatImpact = (impact: IncidentImpact) => {
    return impact.charAt(0).toUpperCase() + impact.slice(1);
  };

  const statusPageName =
    incident.statusPage?.headline || incident.statusPage?.name || "Status Page";
  const statusPageId = incident.statusPage?.id || idOrSubdomain;
  const statusPageHref = isPublicView
    ? `/status/${idOrSubdomain}`
    : `/status-pages/${statusPageId}/public`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {transactionalLogo && (
          <Image
            src={transactionalLogo}
            alt={statusPageHeadline || "Status Page"}
            width={160}
            height={48}
            className="h-10 mb-4 object-contain object-left"
            unoptimized
          />
        )}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {incident.name}
          </h1>
          <Badge
            className={`${getImpactColor(incident.impact)} text-xs px-2 py-0.5 font-medium border`}
          >
            {formatImpact(incident.impact)} Impact
          </Badge>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Incident Report for {statusPageName}
        </p>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-8">
        {/* Timeline */}
        <div className="space-y-4">
          {incident.updates.map((update, index) => (
            <div key={update.id} className="relative flex gap-4">
              {/* Timeline connector */}
              {index < incident.updates.length - 1 && (
                <div className="absolute left-[47px] top-10 bottom-0 w-px bg-gray-200 dark:bg-gray-800" />
              )}

              {/* Status Badge */}
              <div className="flex-shrink-0 w-24">
                <Badge
                  className={`${getStatusColor(update.status)} text-xs px-2 py-1 font-medium border w-full justify-center`}
                >
                  {formatStatus(update.status)}
                </Badge>
              </div>

              {/* Update Content */}
              <div className="flex-1 min-w-0 pb-4">
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-4 shadow-sm">
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {update.body}
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="h-3 w-3" />
                    <span>
                      {update.createdAt
                        ? format(
                            new Date(update.createdAt),
                            "MMM d, yyyy 'at' HH:mm 'UTC'"
                          )
                        : "recently"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Initial Report (if no updates exist) */}
          {incident.updates.length === 0 && (
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-24">
                <Badge
                  className={`${getStatusColor(incident.status)} text-xs px-2 py-1 font-medium border w-full justify-center`}
                >
                  {formatStatus(incident.status)}
                </Badge>
              </div>

              <div className="flex-1">
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-4 shadow-sm">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Incident reported.
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="h-3 w-3" />
                    <span>
                      {incident.createdAt
                        ? format(
                            new Date(incident.createdAt),
                            "MMM d, yyyy 'at' HH:mm 'UTC'"
                          )
                        : "recently"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Back to Status Button */}
        <div className="mt-8 pt-6 border-t dark:border-gray-800">
          <Link href={statusPageHref}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back to Status
            </Button>
          </Link>
        </div>

        {/* Footer */}
        <div className="text-center py-6 mt-6 text-xs text-gray-500 dark:text-gray-400">
          Powered by{" "}
          <a
            href="https://supercheck.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Supercheck
          </a>
        </div>
      </div>
    </div>
  );
}
