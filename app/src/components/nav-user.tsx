"use client";

import { useSession, signOut } from "@/utils/auth-client";
import { useState, useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "next-themes";
import { Moon, Sun, User, UserCog, Monitor } from "lucide-react";
import { AccountDialog } from "@/components/account/account-dialog";
import { useProjectContextSafe, clearProjectsCache } from "@/hooks/use-project-context";
import { resetChatwootSession } from "@/components/support/chatwoot-widget";
import { LeaveOrganizationDialog } from "@/components/leave-organization-dialog";
import { clearQueryCache } from "@/lib/query-provider";

export function NavUser() {
  const { data: session, isPending } = useSession();
  const user = session?.user;
  const hasData = user !== undefined && user !== null;
  const { theme, setTheme } = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);

  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Use safe hook that returns null if outside provider (no try-catch needed)
  const projectContext = useProjectContextSafe();
  const currentProject = projectContext?.currentProject ?? null;

  const handleLogout = async () => {
    // Clear all caches to prevent data leakage between sessions
    clearProjectsCache();
    clearQueryCache();
    resetChatwootSession(); // Drop the support-chat contact so the next user never sees this conversation
    await signOut();
    // Sign-out crosses an authentication boundary. Replace the history entry
    // with a same-origin document navigation to avoid reusing private UI state.
    window.location.replace(new URL("/sign-in", window.location.origin));
  };

  if (!isMounted || (!hasData && isPending)) {
    return <Skeleton className="h-8 w-8 rounded-lg" />;
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-testid="user-menu" aria-label={user?.name ? `Account menu for ${user.name}` : "Account menu"} className="h-8 w-8 rounded-full focus-visible:ring-ring flex items-center focus-visible:outline-none">
          <UserAvatar name={user?.name || user?.email} image={user?.image} allowExternalImage className="h-8 w-8" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        {currentProject?.userRole && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Role</DropdownMenuLabel>
            <DropdownMenuItem className="text-sm">
              <span className="mr-2 flex items-center">
                <User className="h-4 w-4 mr-2" />
                {currentProject.userRole.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {!currentProject?.userRole && currentProject !== null && (
          <DropdownMenuSeparator />
        )}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <span className="mr-2 flex items-center"><Monitor className="h-4 w-4 mr-2" />System</span>
          <span className="ml-auto">{theme === "system" && <span className="inline-block w-2 h-2 rounded-full bg-primary" />}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <span className="mr-2 flex items-center"><Moon className="h-4 w-4 mr-2" />Dark</span>
          <span className="ml-auto">{theme === "dark" && <span className="inline-block w-2 h-2 rounded-full bg-primary" />}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <span className="mr-2 flex items-center"><Sun className="h-4 w-4 mr-2" />Light</span>
          <span className="ml-auto">{theme === "light" && <span className="inline-block w-2 h-2 rounded-full bg-primary" />}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAccountOpen(true)} data-testid="account-menu-item">
          <UserCog className="h-4 w-4 mr-2" />Account
        </DropdownMenuItem>
        <LeaveOrganizationDialog />
        <DropdownMenuItem onClick={handleLogout} data-testid="sign-out-button">Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}
