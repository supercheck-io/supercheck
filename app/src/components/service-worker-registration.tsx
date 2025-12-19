"use client";

import { useEffect } from "react";

/**
 * ServiceWorkerRegistration - Registers service worker for static asset caching
 *
 * PERFORMANCE OPTIMIZATION:
 * The service worker caches static assets like images, fonts, and S3 content
 * to enable faster subsequent loads.
 *
 * This component should be placed in the root layout to register early.
 */
export function ServiceWorkerRegistration() {
    useEffect(() => {
        // Only register in production and if service workers are supported
        if (
            typeof window !== "undefined" &&
            "serviceWorker" in navigator &&
            process.env.NODE_ENV === "production"
        ) {
            // Register after page load to not compete with critical resources
            window.addEventListener("load", () => {
                navigator.serviceWorker
                    .register("/supercheck-sw.js")
                    .then((registration) => {
                        console.debug(
                            "[ServiceWorker] Registration successful:",
                            registration.scope
                        );

                        // Check for updates periodically (every hour)
                        setInterval(() => {
                            registration.update();
                        }, 60 * 60 * 1000);
                    })
                    .catch((error) => {
                        console.debug("[ServiceWorker] Registration failed:", error);
                    });
            });
        }
    }, []);

    // This component renders nothing
    return null;
}
