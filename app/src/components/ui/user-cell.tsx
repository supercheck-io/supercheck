"use client";

import type * as React from "react";
import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]?.toUpperCase()).join("") || "?";
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
      <AvatarFallback className={cn("text-[max(8px,40cqw)] font-medium", !name && "border border-dashed bg-transparent text-muted-foreground")}>
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
  className,
  avatarClassName,
}: {
  name: string | null | undefined;
  email?: string | null;
  image?: string | null;
  emptyLabel?: string;
  className?: string;
  avatarClassName?: string;
}) {
  const label = name || email || null;
  const content = (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", !label && "text-muted-foreground", className)}>
      <UserAvatar name={label} image={image} className={avatarClassName} />
      <span className="truncate">
        {label ?? emptyLabel}
        {name && email ? <span className="sr-only">, {email}</span> : null}
      </span>
    </div>
  );
  if (!label) return content;
  // The tooltip shows the full name (it may be truncated) and the email.
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>
        {name && email ? (
          <>
            <div className="font-medium">{name}</div>
            <div>{email}</div>
          </>
        ) : (
          label
        )}
      </TooltipContent>
    </Tooltip>
  );
}
