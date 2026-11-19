"use client";

import { signOutAndClear } from "@/lib/auth/sign-out";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

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
    await signOutAndClear();
    // Sign-out crosses an authentication boundary. Replace the history entry
    // with a same-origin document navigation to avoid reusing private UI state.
    window.location.replace(new URL("/sign-in", window.location.origin));
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
