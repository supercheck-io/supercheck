import { z } from "zod";

export const updateOrganizationNameSchema = z.object({
  name: z
    .string()
    .min(1, "Organization name is required")
    .min(2, "Organization name must be at least 2 characters")
    .max(50, "Organization name must be 50 characters or less")
    .trim(),
});

export type UpdateOrganizationNameFormData = z.infer<typeof updateOrganizationNameSchema>;
