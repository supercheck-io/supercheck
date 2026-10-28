"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/utils/auth-client";
import { useAppConfig } from "@/hooks/use-app-config";
import { UserAvatar } from "@/components/ui/user-cell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectedApps } from "@/components/connected-apps/connected-apps";
import { LeaveOrganizationDialog } from "@/components/leave-organization-dialog";

const AVATAR_SIZE = 256;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** Center-crop to a square and downscale, so the upload stays small and well under the server's 2 MB cap. */
async function toAvatarBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("Could not process image");
  return blob;
}

function refreshSession() {
  authClient.$store.notify("$sessionSignal");
}

function ProfileTab({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession();
  const user = session?.user;
  // The server blocks photo changes while impersonating; keep the whole form read-only for consistency.
  const impersonating = !!(session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy;
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const nameError = trimmed.length < 1 ? "Name is required" : trimmed.length > 100 ? "Name must be 100 characters or fewer" : null;
  const dirty = trimmed !== (user?.name ?? "");

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (nameError || !dirty) return;
    setSaving(true);
    const { error } = await authClient.updateUser({ name: trimmed });
    setSaving(false);
    if (error) return void toast.error("Could not update your name");
    toast.success("Profile updated");
    onClose();
  }

  async function uploadPhoto(file: File) {
    if (!ACCEPTED.includes(file.type)) return void toast.error("Choose a PNG, JPEG or WebP image");
    if (file.size > MAX_INPUT_BYTES) return void toast.error("Image is too large");
    setPhotoBusy(true);
    try {
      const body = new FormData();
      body.append("file", await toAvatarBlob(file), "avatar.webp");
      const response = await fetch("/api/users/me/avatar", { method: "POST", body });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Upload failed");
      }
      refreshSession();
      toast.success("Photo updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      const response = await fetch("/api/users/me/avatar", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove photo");
      refreshSession();
      toast.success("Photo removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <UserAvatar name={user?.name || user?.email} image={user?.image} allowExternalImage className="h-16 w-16" data-testid="account-avatar" />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={photoBusy || impersonating} onClick={() => fileInput.current?.click()}>
            Change photo
          </Button>
          {user?.image && (
            <Button type="button" variant="ghost" size="sm" disabled={photoBusy || impersonating} onClick={removePhoto}>
              Remove photo
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            data-testid="account-photo-input"
            onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])}
          />
        </div>
      </div>

      <form onSubmit={saveName} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="account-name">Name</Label>
          <Input id="account-name" disabled={impersonating} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
          {nameError && dirty && <p role="alert" className="text-xs text-destructive">{nameError}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={user?.email ?? ""} readOnly disabled />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={impersonating || saving || !dirty || !!nameError}>{saving ? "Saving..." : "Save changes"}</Button>
        </div>
      </form>
      <LeaveOrganizationDialog />
    </div>
  );
}

export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { isMcpEnabled } = useAppConfig();
  const profile = <ProfileTab onClose={() => onOpenChange(false)} />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>Manage your profile{isMcpEnabled ? " and connected apps" : ""}.</DialogDescription>
        </DialogHeader>
        {isMcpEnabled ? (
          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="connected-apps">Connected apps</TabsTrigger>
            </TabsList>
            <TabsContent value="profile" forceMount className="pt-4 data-[state=inactive]:hidden">{profile}</TabsContent>
            <TabsContent value="connected-apps" className="pt-4 max-h-[60vh] overflow-y-auto"><ConnectedApps /></TabsContent>
          </Tabs>
        ) : profile}
      </DialogContent>
    </Dialog>
  );
}
