"use client";

import { signOut } from "@/utils/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { clearAuthSession } from "@/components/auth-guard";

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
    clearAuthSession(); // Clear client-side auth cache
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
