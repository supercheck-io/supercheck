"use client";

import { signOut } from "@/utils/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { clearAuthSession } from "@/components/auth-guard";
import { clearQueryCache } from "@/lib/query-provider";
import { clearProjectsCache } from "@/hooks/use-project-context";

interface SignOutButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  showIcon?: boolean;
  showText?: boolean;
  className?: string;
}

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  showIcon = true,
  showText = true,
  className
}: SignOutButtonProps) {
  const handleSignOut = async () => {
    // Clear all caches to prevent data leakage between sessions
    clearAuthSession(); // Clear client-side auth cache
    clearProjectsCache(); // Clear projects cache
    clearQueryCache(); // Clear React Query cache and localStorage
    await signOut();
    window.location.href = "/sign-in";
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSignOut}
      className={className}
    >
      {showIcon && <LogOut className="h-4 w-4" />}
      {showText && <span className={showIcon ? "ml-2" : ""}>Sign out</span>}
    </Button>
  );
}
