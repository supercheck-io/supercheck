"use client";

import type * as React from "react";
import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** First letters of the first two words; a single word gives its first two letters. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]) : Array.from(words[0] ?? "").slice(0, 2);
  return letters.join("").toUpperCase() || "?";
}

// Literal class names so Tailwind keeps them. Each pair keeps the initials readable in light and dark mode.
const FALLBACK_COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
];

// shortcut: seeded by the display name, so a renamed user changes colour; seed by user id if that matters.
export function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

// Only the app's own avatar route: user.image can be any URL a user sets, which would make viewers' browsers fetch it.
const APP_AVATAR = /^\/api\/users\/[0-9a-f-]{36}\/avatar\?v=[a-f0-9]{32}\.(png|jpg|webp)$/;

/** Round avatar: the photo, else initials, else a dashed person icon when nobody is set. */
export function UserAvatar({
  name,
  image,
  allowExternalImage = false,
  className,
  ...props
}: {
  name: string | null | undefined;
  image?: string | null;
  /** Only for the signed-in user's own avatar, where an OAuth photo URL is safe to load. */
  allowExternalImage?: boolean;
  className?: string;
} & Omit<React.ComponentProps<typeof Avatar>, "children">) {
  const src = name && image && (allowExternalImage || APP_AVATAR.test(image)) ? image : null;
  return (
    // Initials scale with the avatar size (container query), so one component fits 16px to 64px.
    <Avatar className={cn("@container h-6 w-6", className)} {...props}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={cn("text-[max(8px,40cqw)] font-medium", name ? avatarColor(name) : "border border-dashed bg-transparent text-muted-foreground")}>
        {name ? initials(name) : <UserRound className="h-3/5 w-3/5" aria-hidden="true" />}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * One-line person: avatar plus name, with the email in a tooltip. Used wherever a
 * user is shown, so people look the same in tables, cards and timelines.
 */
export function UserCell({
  name,
  email,
  image,
  emptyLabel = "Unassigned",
  avatarOnly = false,
  className,
  avatarClassName,
}: {
  name: string | null | undefined;
  email?: string | null;
  image?: string | null;
  emptyLabel?: string;
  /** Table columns: only the avatar is visible; the name stays in the tooltip and for screen readers. */
  avatarOnly?: boolean;
  className?: string;
  avatarClassName?: string;
}) {
  const label = name || email || null;
  const content = (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", !label && "text-muted-foreground", className)}>
      <UserAvatar name={label} image={image} className={avatarClassName} />
      <span className={avatarOnly ? "sr-only" : "truncate"}>
        {label ?? emptyLabel}
        {name && email ? <span className="sr-only">, {email}</span> : null}
      </span>
    </div>
  );
  // Avatar-only cells keep a tooltip even when empty, so "System" or "Unassigned" is still readable.
  if (!label && !avatarOnly) return content;
  // The tooltip shows the full name (it may be truncated) and the email.
  return (
    <Tooltip>
      <TooltipTrigger asChild tabIndex={0}>{content}</TooltipTrigger>
      <TooltipContent>
        {name && email ? (
          <>
            <div className="font-medium">{name}</div>
            <div>{email}</div>
          </>
        ) : (
          label ?? emptyLabel
        )}
      </TooltipContent>
    </Tooltip>
  );
}
