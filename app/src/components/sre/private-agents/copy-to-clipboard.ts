import { toast } from "sonner";

/**
 * Copy text and always tell the user what happened. `navigator.clipboard` is
 * undefined or rejects on insecure (plain-http self-hosted) origins and when
 * permission is denied; a one-time token must never be lost silently.
 */
export async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}. Select the text and copy it manually.`);
  }
}
