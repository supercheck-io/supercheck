"use client";

import { useEffect, useState } from "react";
import { useProjectContext } from "@/hooks/use-project-context";

export function SetupChecker() {
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const { refreshProjects } = useProjectContext();

  useEffect(() => {
    const checkAndSetupDefaults = async () => {
      try {
        // Check if user has active project
        const response = await fetch("/api/projects");
        const data = await response.json();

        if (!data.success || data.data.length === 0) {
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

          // Additional check: see if user was recently invited
          // This prevents creating defaults for users who just accepted invitations
          // but haven't been assigned to projects yet due to timing issues

          const setupResponse = await fetch("/api/auth/setup-defaults", {
            method: "POST",
          });

          if (setupResponse.ok) {
            console.log("✅ Default organization and project created");

            // Wait a moment for database consistency, then refresh projects
            // This helps with potential race conditions between org creation and permission checks
            await new Promise((resolve) => setTimeout(resolve, 2000));

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
      // Run check after a short delay to ensure auth is fully loaded
      const timer = setTimeout(checkAndSetupDefaults, 1000);
      return () => clearTimeout(timer);
    }
  }, [isSetupComplete, refreshProjects]);

  return null; // This component doesn't render anything
}
