"use client";

/**
 * RecorderAutoConnect - Seamless Extension Authentication
 * 
 * This component runs on Supercheck pages and automatically:
 * 1. Detects if the Supercheck Recorder extension is installed
 * 2. If installed and user is logged in, auto-connects the extension
 * 3. No user interaction required - completely seamless
 * 
 * Include this component in the app layout to enable seamless auth.
 */

import { useEffect, useRef, useCallback } from "react";
import { useSession } from "@/utils/auth-client";

const MESSAGE_TYPES = {
  CHECK_EXTENSION: "SUPERCHECK_CHECK_EXTENSION",
  EXTENSION_READY: "SUPERCHECK_RECORDER_READY",
  AUTO_CONNECT: "SUPERCHECK_AUTO_CONNECT",
  EXTENSION_CONNECTED: "SUPERCHECK_EXTENSION_CONNECTED",
  EXTENSION_NEEDS_AUTH: "SUPERCHECK_EXTENSION_NEEDS_AUTH",
} as const;

interface ExtensionReadyPayload {
  version: string;
  hasKey?: boolean; // absent on older extensions that cannot report their key
  keyId?: string;
  connectable?: boolean; // false when the extension is set to a different instance
}

export function RecorderAutoConnect() {
  const { data: session } = useSession();
  const extensionConnectedRef = useRef(false);
  const apiKeyGeneratedRef = useRef(false);

  const connectExtension = useCallback(async (ready?: ExtensionReadyPayload) => {
    if (!session?.user || extensionConnectedRef.current || apiKeyGeneratedRef.current || ready?.connectable === false) {
      return;
    }

    apiKeyGeneratedRef.current = true;

    try {
      // Generate API key for the extension
      const response = await fetch("/api/extension/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Supercheck Recorder Extension",
          // null: the extension holds no key; a string: the key it holds. Omitted for
          // older extensions (or keys stored before ids were kept), which keeps the
          // previous "already connected" behaviour.
          ...(ready?.hasKey === false ? { clientKeyId: null } : ready?.keyId ? { clientKeyId: ready.keyId } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.warn(data.error || "Failed to generate API key for extension");
        return;
      }

      // If extension already connected, no new key was generated
      if (data.data?.message === "Extension already connected") {
        extensionConnectedRef.current = true;
        return;
      }

      // Only send credentials when we have a new API key
      if (!data.data?.apiKey) {
        throw new Error("No API key returned");
      }

      // Send credentials to extension (same-origin for security)
      window.postMessage(
        {
          type: MESSAGE_TYPES.AUTO_CONNECT,
          payload: {
            instanceUrl: window.location.origin,
            apiKey: data.data.apiKey,
            keyId: data.data.keyId,
            userId: session.user.id,
            userEmail: session.user.email,
          },
        },
        window.location.origin
      );
    } catch (error) {
      console.error("[Supercheck] Failed to auto-connect extension:", error);
      apiKeyGeneratedRef.current = false; // Allow retry
    }
  }, [session]);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      // Only handle messages from our extension
      if (event.data?.source !== "supercheck-recorder") {
        return;
      }

      const message = event.data;

      switch (message.type) {
        case MESSAGE_TYPES.EXTENSION_READY:
          // Extension is installed and ready - auto-connect it
          console.log("[Supercheck] Recorder extension detected, auto-connecting...");
          connectExtension(message.payload as ExtensionReadyPayload | undefined);
          break;

        case MESSAGE_TYPES.EXTENSION_CONNECTED:
          if (message.payload?.success) {
            extensionConnectedRef.current = true;
            console.log("[Supercheck] Recorder extension connected successfully");
          } else {
            // The one-time key was not stored; allow the next READY to mint another.
            apiKeyGeneratedRef.current = false;
          }
          break;

        case MESSAGE_TYPES.EXTENSION_NEEDS_AUTH:
          // Extension needs credentials - provide them
          connectExtension();
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // Check if extension is already installed (same-origin for security)
    window.postMessage({ type: MESSAGE_TYPES.CHECK_EXTENSION }, window.location.origin);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [session, connectExtension]);

  // This component renders nothing - it just handles the auto-connect logic
  return null;
}
