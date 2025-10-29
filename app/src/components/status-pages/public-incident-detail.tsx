"use client";

import React from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
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
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "monitoring":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "identified":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "investigating":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "scheduled":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  const getImpactColor = (impact: IncidentImpact) => {
    switch (impact) {
      case "critical":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "major":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "minor":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
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
      <div className="max-w-4xl mx-auto px-6 py-8">
        {transactionalLogo && (
          <Image
            src={transactionalLogo}
            alt={statusPageHeadline || "Status Page"}
            width={200}
            height={64}
            className="h-16 mb-4 object-contain object-left"
            unoptimized
          />
        )}
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            {incident.name}
          </h1>
          <Badge className={`${getImpactColor(incident.impact)} text-sm px-3 py-1.5 font-semibold whitespace-nowrap`}>
            {formatImpact(incident.impact)} Impact
          </Badge>
        </div>

        <p className="text-gray-600 dark:text-gray-400 text-lg">
          Incident Report for {statusPageName}
        </p>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Timeline */}
        <div className="space-y-8">
          {incident.updates.map((update, index) => (
            <div key={update.id} className="relative">
              {/* Timeline line */}
              {index < incident.updates.length - 1 && (
                <div className="absolute left-[27px] top-14 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-800" />
              )}

              <div className="flex gap-6">
                {/* Status Badge */}
                <div className="flex-shrink-0">
                  <Badge
                    className={`${getStatusColor(
                      update.status
                    )} text-base px-4 py-2 font-semibold`}
                  >
                    {formatStatus(update.status)}
                  </Badge>
                </div>

                {/* Update Content */}
                <div className="flex-1 pb-8">
                  <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6">
                    <p className="text-gray-700 dark:text-gray-300 text-base leading-relaxed whitespace-pre-wrap">
                      {update.body}
                    </p>

                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                      Posted{" "}
                      {update.createdAt
                        ? format(
                            new Date(update.createdAt),
                            "EEEE, MMMM d, yyyy 'at' HH:mm 'UTC'"
                          )
                        : "recently"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Initial Report (if no updates exist) */}
          {incident.updates.length === 0 && (
            <div className="flex gap-6">
              <div className="flex-shrink-0">
                <Badge
                  className={`${getStatusColor(
                    incident.status
                  )} text-base px-4 py-2 font-semibold`}
                >
                  {formatStatus(incident.status)}
                </Badge>
              </div>

              <div className="flex-1">
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-6">
                  <p className="text-gray-700 dark:text-gray-300 text-base">
                    Incident reported.
                  </p>

                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                    Posted{" "}
                    {incident.createdAt
                      ? format(
                          new Date(incident.createdAt),
                          "EEEE, MMMM d, yyyy 'at' HH:mm 'UTC'"
                        )
                      : "recently"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Back to Status Button */}
        <div className="mt-12 pt-8">
          <Link href={statusPageHref}>
            <Button variant="outline" size="lg">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Current Status
            </Button>
          </Link>
        </div>

        {/* Footer */}
        <div className="text-center py-8 mt-12 text-sm text-gray-600 dark:text-gray-400 border-t dark:border-gray-800">
          <p>
            Powered by{" "}
            <a
              href="https://supercheck.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Supercheck
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
