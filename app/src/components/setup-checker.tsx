"use client";

import { useEffect, useState, useRef } from "react";
import { useProjectContext } from "@/hooks/use-project-context";

/**
 * SetupChecker - Ensures new users have default organization/project
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Uses projects from ProjectContext instead of duplicate /api/projects fetch
 * - Only runs setup check once per session (tracked via ref)
 * - ProjectContext already fetches projects on mount, we just read from it
 */
export function SetupChecker() {
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const { projects, loading, refreshProjects } = useProjectContext();
  const setupAttemptedRef = useRef(false);

  useEffect(() => {
    // Skip if setup already attempted or context is still loading
    if (setupAttemptedRef.current || loading) {
      return;
    }

    const checkAndSetupDefaults = async () => {
      // Mark as attempted to prevent re-running
      setupAttemptedRef.current = true;

      try {
        // Use projects from context - no additional API call needed!
        if (projects.length === 0) {
          // Check if user is a member of any organization
          const membershipResponse = await fetch("/api/organizations");
          const membershipData = await membershipResponse.json();

          if (
            membershipData.success &&
            membershipData.data &&
            membershipData.data.length > 0
          ) {
            // User is a member of organizations but has no projects
            // This is likely an invited user with restricted project access
            setIsSetupComplete(true);
            return;
          }

          // No projects and no org membership - create defaults
          const setupResponse = await fetch("/api/auth/setup-defaults", {
            method: "POST",
          });

          if (setupResponse.ok) {
            console.log("✅ Default organization and project created");

            // PERFORMANCE: Reduced delay - modern DBs have immediate consistency
            await new Promise((resolve) => setTimeout(resolve, 500));

            try {
              await refreshProjects();
              console.log("✅ Projects refreshed successfully after setup");
            } catch (refreshError) {
              console.log(
                "⚠️ Projects refresh failed after setup, will retry on next load:",
                refreshError
              );
              // Force page reload as fallback to ensure clean state
              window.location.reload();
            }
          } else {
            console.log(
              "Setup not needed or failed, user likely already has org/project"
            );
          }
        }

        setIsSetupComplete(true);
      } catch (error) {
        console.log("Setup check failed:", error);
        setIsSetupComplete(true);
      }
    };

    // Only run setup check if not already complete
    if (!isSetupComplete) {
      // PERFORMANCE: Reduced delay - auth is now checked via useSession which is fast
      // Only need minimal delay for React state to settle
      const timer = setTimeout(checkAndSetupDefaults, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, projects, isSetupComplete, refreshProjects]);

  return null; // This component doesn't render anything
}
