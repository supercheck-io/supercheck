"use client";

import React from "react";
import Image from "next/image";
import { formatMaintenanceWindow, statusPageTimeZone } from "@/lib/incident-schedule";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Bell, CheckCircle2, Clock, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { SubscribeDialog } from "./subscribe-dialog";
import { INCIDENT_PILL, incidentImpactTone, INCIDENT_STATUS_PILL, incidentStatusDot } from "./public-incident-tones";

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
  scheduledFor?: Date | null;
  scheduledUntil?: Date | null;
  updates: IncidentUpdate[];
  statusPage?: {
    id: string;
    name: string;
    headline: string | null;
    subdomain: string;
  };
};

/** The page's public subscription settings; given only on the public page, never in the in-app preview. */
type SubscriptionSettings = {
  id: string;
  name: string;
  headline?: string | null;
  allowPageSubscribers?: boolean | null;
  allowIncidentSubscribers?: boolean | null;
  allowEmailSubscribers?: boolean | null;
  allowWebhookSubscribers?: boolean | null;
  allowSlackSubscribers?: boolean | null;
};

type PublicIncidentDetailProps = {
  incident: Incident;
  subscription?: SubscriptionSettings;
  idOrSubdomain: string;
  faviconLogo?: string | null;
  transactionalLogo?: string | null;
  statusPageHeadline?: string | null;
  supportUrl?: string | null;
  hideBranding?: boolean;
  isPublicView?: boolean;
  isCustomDomain?: boolean;
  /** URL prefix for custom-domain links. Empty string for proxy-rewritten requests, full internal path for direct access. */
  customDomainRoutePrefix?: string;
  language?: string;
  /** The status page's time zone; times show in it, with the zone named. */
  timeZone?: string | null;
};

export function PublicIncidentDetail({
  incident,
  subscription,
  idOrSubdomain,
  faviconLogo,
  transactionalLogo,
  statusPageHeadline,
  supportUrl,
  hideBranding = false,
  isPublicView = false,
  isCustomDomain = false,
  customDomainRoutePrefix = "",
  language = "en",
  timeZone,
}: PublicIncidentDetailProps) {
  useStatusPageFavicon(faviconLogo);

  const t = getTranslations(language);
  const locale = getLocaleForLanguage(language);
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: statusPageTimeZone(timeZone),
    timeZoneName: "short",
  });

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
      ? customDomainRoutePrefix || "/"
      : `/status/${idOrSubdomain}`
    : `/status-pages/${statusPageId}/public`;

  const formatTime = (date: Date | null) =>
    date ? dateTimeFormatter.format(new Date(date)) : t.recently;

  // Shown when the incident has no updates yet, so the timeline is never empty.
  const timeline: IncidentUpdate[] = incident.updates.length
    ? incident.updates
    : [{ id: "initial", status: incident.status, body: t.incidentReported, createdAt: incident.createdAt }];

  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Page bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={statusPageHref}
            className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4 flex-shrink-0 rtl:rotate-180" />
            {transactionalLogo ? (
              <Image
                src={transactionalLogo}
                alt={statusPageHeadline || t.systemStatus}
                width={120}
                height={32}
                className="h-7 w-auto object-contain"
                unoptimized
              />
            ) : null}
            <span className="sr-only">{t.backToStatus}: </span>
            <span className="truncate">{statusPageName}</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <SupportContactButton supportUrl={supportUrl} language={language} />
            {subscription?.allowPageSubscribers &&
              subscription.allowIncidentSubscribers &&
              incident.status !== "resolved" && (
                <SubscribeDialog
                  incident={{ id: incident.id, name: incident.name }}
                  allowIncidentSubscribers
                  allowPageSubscribers
                  allowEmailSubscribers={subscription.allowEmailSubscribers ?? false}
                  allowWebhookSubscribers={subscription.allowWebhookSubscribers ?? false}
                  allowSlackSubscribers={subscription.allowSlackSubscribers ?? false}
                  statusPageId={subscription.id}
                  statusPageName={subscription.headline || subscription.name}
                  language={language}
                  trigger={
                    <Button variant="outline" size="sm" className="gap-2 shadow-sm">
                      <Bell className="h-4 w-4" />
                      {t.subscribe}
                    </Button>
                  }
                />
              )}
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-xl border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(INCIDENT_PILL, INCIDENT_STATUS_PILL)}>
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", incidentStatusDot(incident.status))} />
              {formatStatus(incident.status)}
            </span>
            <span className={cn(INCIDENT_PILL, incidentImpactTone(incident.impact))}>
              {formatImpact(incident.impact)} {t.impact}
            </span>
          </div>
          <h1 className="mt-3 break-words text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-2xl">
            {incident.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 flex-shrink-0" />
              {formatTime(incident.createdAt)}
            </span>
            {incident.resolvedAt && (
              <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {formatStatus("resolved")} {formatTime(incident.resolvedAt)}
              </span>
            )}
            {incident.scheduledFor && incident.scheduledUntil && (
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-4 w-4 flex-shrink-0" />
                {t.scheduledMaintenance}:{" "}
                {formatMaintenanceWindow(locale, incident.scheduledFor, incident.scheduledUntil, timeZone)}
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <ol className="mt-8 ms-2 border-s border-gray-200 dark:border-gray-800">
          {timeline.map((update) => (
            <li key={update.id} className="relative pb-6 ps-6 last:pb-0">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -start-[6px] top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-gray-50 dark:ring-gray-950",
                  incidentStatusDot(update.status),
                )}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn(INCIDENT_PILL, INCIDENT_STATUS_PILL)}>
                  <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", incidentStatusDot(update.status))} />
                  {formatStatus(update.status)}
                </span>
                <time className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(update.createdAt)}
                </time>
              </div>
              <div className="mt-2 rounded-lg border bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {update.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {!hideBranding && (
          <div className="mt-10 border-t pt-6 dark:border-gray-800">
            <StatusPageBranding poweredByLabel={t.poweredBy} className="justify-center" />
          </div>
        )}
      </div>
    </div>
  );
}
