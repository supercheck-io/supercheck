import { z } from "zod";

/**
 * http(s) only: an external URL is rendered as a link in the UI, so `javascript:` and friends must never be
 * stored. Kept free of server imports so the client form can share it with the service.
 */
export const httpUrlSchema = z
  .string()
  .url("Invalid URL format")
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must start with http:// or https://");
