"use client";

import { useSession, signOut } from "@/utils/auth-client";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "next-themes";
import { Moon, Sun, User, Monitor } from "lucide-react";
import { useProjectContext } from "@/hooks/use-project-context";

export function NavUser() {
  const { data: session, isPending } = useSession();
  const [isClient, setIsClient] = useState(false);
  const user = session?.user;
  const { theme, setTheme } = useTheme();
  
  // Safely try to get project context, handle case where component is used outside provider
  let currentProject = null;
  try {
    const projectContext = useProjectContext();
    currentProject = projectContext.currentProject;
  } catch {
    // Component is used outside ProjectContextProvider, that's fine
    console.debug('NavUser: Project context not available');
  }

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleLogout = async () => {
    await signOut();
    window.location.href = "/sign-in";
  };

  // Always show skeleton during SSR and initial client render to prevent hydration mismatch
  if (!isClient || isPending) {
    return <Skeleton className="h-8 w-8 rounded-lg" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className=" h-8 w-8 rounded-lg focus-visible:ring-ring flex items-center  focus-visible:outline-none">
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src={user?.image || ""} alt={user?.name || ""} />
            <AvatarFallback className="rounded-lg">
              {user?.name?.charAt(0).toUpperCase()}
              {/* {user?.name?.charAt(1).toUpperCase()} */}
            </AvatarFallback>
          </Avatar>
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
        <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
