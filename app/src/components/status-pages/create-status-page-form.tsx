"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { createStatusPage, type CreateStatusPageData } from "@/actions/create-status-page";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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

const createStatusPageSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  headline: z.string().max(100, "Headline is too long").optional(),
  pageDescription: z.string().max(500, "Description is too long").optional(),
});

export function CreateStatusPageForm({ onSuccess, onCancel }: CreateStatusPageFormProps) {
  const [isCreating, setIsCreating] = useState(false);
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateStatusPageData>({
    resolver: zodResolver(createStatusPageSchema),
    defaultValues: {
      name: "",
      headline: "",
      pageDescription: "",
    },
  });

  const onSubmit = async (data: CreateStatusPageData) => {
    setIsCreating(true);

    try {
      const result = await createStatusPage(data);

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Status Page Name *</Label>
        <Input
          id="name"
          placeholder="My Service Status"
          {...register("name")}
          disabled={isCreating}
        />
        {errors.name && (
          <p className="text-sm text-red-500">{errors.name.message}</p>
        )}
        <p className="text-sm text-muted-foreground">
          This is the internal name for your status page
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="headline">Public Headline</Label>
        <Input
          id="headline"
          placeholder="Service Status Dashboard"
          {...register("headline")}
          disabled={isCreating}
        />
        {errors.headline && (
          <p className="text-sm text-red-500">{errors.headline.message}</p>
        )}
        <p className="text-sm text-muted-foreground">
          This headline will be displayed at the top of your public status page
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Stay updated on the status of our services"
          {...register("pageDescription")}
          rows={3}
          disabled={isCreating}
        />
        {errors.pageDescription && (
          <p className="text-sm text-red-500">{errors.pageDescription.message}</p>
        )}
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
