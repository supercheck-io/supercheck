import { z } from "zod"

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email must be 255 characters or less"),
  role: z
    .enum(["project_viewer", "project_editor", "project_admin", "org_admin"], {
      errorMap: () => ({ message: "Please select a valid role" })
    }),
  selectedProjects: z
    .array(z.string())
    .max(50, "Cannot select more than 50 projects"),
}).refine((data) => {
  // Project viewers don't need specific project selection as they get access to all projects
  if (data.role === "project_viewer") {
    return true;
  }
  // Other roles require at least one project to be selected
  return data.selectedProjects.length > 0;
}, {
  message: "At least one project must be selected for project-specific roles",
  path: ["selectedProjects"]
})

export const updateMemberSchema = z.object({
  role: z
    .enum(["project_viewer", "project_editor", "project_admin", "org_admin"], {
      errorMap: () => ({ message: "Please select a valid role" })
    }),
  selectedProjects: z
    .array(z.string())
    .max(50, "Cannot select more than 50 projects"),
}).refine((data) => {
  // Project viewers don't need specific project selection as they get access to all projects
  if (data.role === "project_viewer") {
    return true;
  }
  // Other roles require at least one project to be selected
  return data.selectedProjects.length > 0;
}, {
  message: "At least one project must be selected for project-specific roles",
  path: ["selectedProjects"]
})

export type InviteMemberFormData = z.infer<typeof inviteMemberSchema>
export type UpdateMemberFormData = z.infer<typeof updateMemberSchema>





