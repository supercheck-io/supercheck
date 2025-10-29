"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { createStatusPage, type CreateStatusPageData } from "@/actions/create-status-page";
import { toast } from "sonner";

type StatusPageResult = {
  id: string;
  name: string;
  headline: string | null;
  pageDescription: string | null;
  subdomain: string;
  status: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  createdByUserId: string;
};

type CreateStatusPageFormProps = {
  onSuccess: (statusPage: StatusPageResult) => void;
  onCancel: () => void;
};

export function CreateStatusPageForm({ onSuccess, onCancel }: CreateStatusPageFormProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateStatusPageData>({
    name: "",
    headline: "",
    pageDescription: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const result = await createStatusPage(formData);

      if (result.success && result.statusPage) {
        onSuccess(result.statusPage);
      } else {
        toast.error("Failed to create status page", {
          description: result.message || "An unexpected error occurred",
        });
      }
    } catch (error) {
      console.error("Failed to create status page:", error);
      toast.error("Failed to create status page", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Status Page Name *</Label>
        <Input
          id="name"
          placeholder="My Service Status"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          disabled={isCreating}
        />
        <p className="text-sm text-muted-foreground">
          This is the internal name for your status page
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="headline">Public Headline</Label>
        <Input
          id="headline"
          placeholder="Service Status Dashboard"
          value={formData.headline}
          onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
          disabled={isCreating}
        />
        <p className="text-sm text-muted-foreground">
          This headline will be displayed at the top of your public status page
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Stay updated on the status of our services"
          value={formData.pageDescription}
          onChange={(e) => setFormData({ ...formData, pageDescription: e.target.value })}
          rows={3}
          disabled={isCreating}
        />
        <p className="text-sm text-muted-foreground">
          A brief description of what this status page is for
        </p>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <h4 className="font-medium mb-2">What happens next?</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>A unique subdomain will be automatically generated</li>
          <li>Your status page will be created in draft mode</li>
          <li>You can add components, customize branding, and manage incidents</li>
          <li>Publish when you&apos;re ready to make it public</li>
        </ul>
      </div>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isCreating}>
          Cancel
        </Button>
        <Button type="submit" disabled={isCreating}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isCreating ? "Creating..." : "Create Status Page"}
        </Button>
      </div>
    </form>
  );
}
