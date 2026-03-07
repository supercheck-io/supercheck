"use client";

import React from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { useStatusPageFavicon } from "./use-status-page-favicon";
import {
  getTranslations,
  translateIncidentStatus,
  translateIncidentImpact,
  getLocaleForLanguage,
} from "@/lib/status-page-translations";
import { SupportContactButton } from "./support-contact-button";
import { StatusPageBranding } from "./status-page-branding";

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
  supportUrl?: string | null;
  hideBranding?: boolean;
  isPublicView?: boolean;
  isCustomDomain?: boolean;
  language?: string;
};

export function PublicIncidentDetail({
  incident,
  idOrSubdomain,
  faviconLogo,
  transactionalLogo,
  statusPageHeadline,
  supportUrl,
  hideBranding = false,
  isPublicView = false,
  isCustomDomain = false,
  language = "en",
}: PublicIncidentDetailProps) {
  useStatusPageFavicon(faviconLogo);

  const t = getTranslations(language);
  const locale = getLocaleForLanguage(language);
  const utcDateTimeFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

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
    return translateIncidentStatus(status, t);
  };

  const formatImpact = (impact: IncidentImpact) => {
    return translateIncidentImpact(impact, t);
  };

  const statusPageName =
    incident.statusPage?.headline || incident.statusPage?.name || t.systemStatus;
  const statusPageId = incident.statusPage?.id || idOrSubdomain;
  const statusPageHref = isPublicView
    ? isCustomDomain
      ? `/status/_custom/${idOrSubdomain}`
      : `/status/${idOrSubdomain}`
    : `/status-pages/${statusPageId}/public`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {transactionalLogo && (
          <Image
            src={transactionalLogo}
            alt={statusPageHeadline || t.systemStatus}
            width={200}
            height={64}
            className="h-12 sm:h-16 mb-3 sm:mb-4 object-contain object-left"
            unoptimized
          />
        )}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight break-words">
              {incident.name}
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-2">
              {t.incidentReportFor} {statusPageName}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto sm:justify-end">
            <SupportContactButton
              supportUrl={supportUrl}
              language={language}
            />
            <Badge
              className={`${getImpactColor(incident.impact)} text-xs sm:text-sm px-2.5 sm:px-3 py-0.5 sm:py-1 font-medium border w-fit`}
            >
              {formatImpact(incident.impact)} {t.impact}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-8 sm:pb-12">
        {/* Timeline */}
        <div className="space-y-4 sm:space-y-5">
          {incident.updates.map((update, index) => (
            <div key={update.id} className="relative flex gap-3 sm:gap-5">
              {/* Timeline connector */}
              {index < incident.updates.length - 1 && (
                <div className="absolute left-[35px] sm:left-[47px] top-10 bottom-0 w-px bg-gray-200 dark:bg-gray-800" />
              )}

              {/* Status Badge */}
              <div className="flex-shrink-0 w-20 sm:w-28">
                <Badge
                  className={`${getStatusColor(update.status)} text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 font-medium border w-full justify-center`}
                >
                  {formatStatus(update.status)}
                </Badge>
              </div>

              {/* Update Content */}
              <div className="flex-1 min-w-0 pb-4 sm:pb-5">
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-xl p-3 sm:p-5 shadow-sm">
                  <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
                    {update.body}
                  </p>
                  <div className="flex items-center gap-2 mt-3 sm:mt-4 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                    <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>
                      {update.createdAt
                        ? utcDateTimeFormatter.format(new Date(update.createdAt))
                        : t.recently}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Initial Report (if no updates exist) */}
          {incident.updates.length === 0 && (
            <div className="flex gap-3 sm:gap-5">
              <div className="flex-shrink-0 w-20 sm:w-28">
                <Badge
                  className={`${getStatusColor(incident.status)} text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 font-medium border w-full justify-center`}
                >
                  {formatStatus(incident.status)}
                </Badge>
              </div>

              <div className="flex-1">
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-xl p-3 sm:p-5 shadow-sm">
                  <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300">
                    {t.incidentReported}
                  </p>
                  <div className="flex items-center gap-2 mt-3 sm:mt-4 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                    <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>
                      {incident.createdAt
                        ? utcDateTimeFormatter.format(new Date(incident.createdAt))
                        : t.recently}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t dark:border-gray-800">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href={statusPageHref}>
              <Button variant="outline" size="default" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t.backToStatus}
              </Button>
            </Link>
            {!hideBranding && (
              <StatusPageBranding
                poweredByLabel={t.poweredBy}
                className="justify-center sm:justify-end"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
