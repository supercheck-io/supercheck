"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye,
  User,
  Shield,
  Crown,
  Info,
  UserPlus,
  Mail,
  Loader2,
  FolderOpen,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { FormInput } from "@/components/ui/form-input";
import {
  inviteMemberSchema,
  updateMemberSchema,
} from "@/lib/validations/member";
import { z } from "zod";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  isDisposableEmail,
  getDisposableEmailErrorMessage,
} from "@/lib/validations/disposable-email-domains";

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface MemberData {
  id?: string;
  name?: string;
  email: string;
  role: string;
  selectedProjects: string[];
}

interface MemberAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "invite" | "edit";
  member?: MemberData;
  projects: Project[];
  onSubmit: (memberData: MemberData) => Promise<void>;
  isLoading?: boolean;
  isCloudMode?: boolean;
}

const accessLevels = [
  {
    role: "project_viewer",
    label: "Viewer",
    fullLabel: "Project Viewer",
    description: "Read-only access to all projects",
    fullDescription:
      "Read-only access to all organization projects. No project selection required.",
    icon: Eye,
    color: "text-slate-500",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/20",
  },
  {
    role: "project_editor",
    label: "Editor",
    fullLabel: "Project Editor",
    description: "Create & edit in selected projects",
    fullDescription:
      "Create and edit tests, jobs, monitors in selected projects only. Project selection required.",
    icon: User,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  {
    role: "project_admin",
    label: "Project Admin",
    fullLabel: "Project Admin",
    description: "Full access to selected projects",
    fullDescription:
      "Full admin access to selected projects only. Can manage project settings. Project selection required.",
    icon: Shield,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  {
    role: "org_admin",
    label: "Org Admin",
    fullLabel: "Organization Admin",
    description: "Full organization access",
    fullDescription:
      "Can manage organization settings and invite members. Has access to all projects.",
    icon: Crown,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
  },
];

// Role Info Popover Component
function RoleInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-muted"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" side="right" sideOffset={8}>
        <div className="space-y-4">
          <h4 className="font-semibold text-sm">Role Permissions</h4>
          <div className="space-y-3">
            {accessLevels.map((level) => (
              <div key={level.role} className="flex items-start gap-3">
                <div className={cn("p-1.5 rounded-md", level.bgColor)}>
                  <level.icon className={cn("h-3.5 w-3.5", level.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{level.fullLabel}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {level.fullDescription}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MemberAccessDialog({
  open,
  onOpenChange,
  mode,
  member,
  projects,
  onSubmit,
  isLoading = false,
  isCloudMode = true,
}: MemberAccessDialogProps) {
  const [formData, setFormData] = useState<MemberData>({
    email: "",
    role: "project_editor",
    selectedProjects: [],
  });

  // Initialize form data when dialog opens or member changes
  useEffect(() => {
    if (open) {
      if (mode === "edit" && member) {
        setFormData({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          selectedProjects: member.selectedProjects || [],
        });
      } else {
        setFormData({
          email: "",
          role: "project_editor",
          selectedProjects: [],
        });
      }
    }
  }, [open, mode, member]);

  // Clear project assignments when project_viewer is selected
  useEffect(() => {
    if (formData.role === "project_viewer") {
      setFormData((prev) => ({ ...prev, selectedProjects: [] }));
    }
  }, [formData.role]);

  const handleProjectToggle = (projectId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedProjects: prev.selectedProjects.includes(projectId)
        ? prev.selectedProjects.filter((id) => id !== projectId)
        : [...prev.selectedProjects, projectId],
    }));
  };

  const handleSelectAllProjects = () => {
    const activeProjectIds = projects.map((project) => project.id);
    setFormData((prev) => ({
      ...prev,
      selectedProjects: activeProjectIds,
    }));
  };

  const handleClearProjectSelection = () => {
    setFormData((prev) => ({
      ...prev,
      selectedProjects: [],
    }));
  };

  const handleSubmit = async () => {
    // Prepare data for validation
    const dataToValidate = {
      email: formData.email.trim(),
      role: formData.role,
      selectedProjects: formData.selectedProjects,
    };

    // Check for disposable email in cloud mode (invite only)
    if (
      mode === "invite" &&
      isCloudMode &&
      isDisposableEmail(dataToValidate.email)
    ) {
      toast.error(getDisposableEmailErrorMessage());
      return;
    }

    // Validate form data using appropriate schema
    try {
      if (mode === "invite") {
        inviteMemberSchema.parse(dataToValidate);
      } else {
        updateMemberSchema.parse(dataToValidate);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        if (error.errors && error.errors.length > 0) {
          toast.error(error.errors[0].message);
          return;
        }
      }
      toast.error("Please fix the form errors");
      return;
    }

    try {
      await onSubmit({
        ...formData,
        email: dataToValidate.email,
        selectedProjects: dataToValidate.selectedProjects,
      });

      // Reset form for invite mode
      if (mode === "invite") {
        setFormData({
          email: "",
          role: "project_editor",
          selectedProjects: [],
        });
      }

      onOpenChange(false);
      toast.success(
        mode === "invite"
          ? "Invitation sent successfully"
          : "Member access updated successfully"
      );
    } catch (error) {
      console.error(
        `Error ${mode === "invite" ? "inviting" : "updating"} member:`,
        error
      );
      const errorMessage =
        error instanceof Error
          ? error.message
          : mode === "invite"
            ? "Failed to send invitation"
            : "Failed to update member access";
      toast.error(errorMessage);
    }
  };

  const isFormValid =
    formData.email.trim() &&
    (formData.role === "project_viewer" ||
      formData.role === "org_admin" ||
      formData.selectedProjects.length > 0);

  const selectedRole = accessLevels.find((l) => l.role === formData.role);
  const requiresProjectSelection =
    formData.role === "project_editor" || formData.role === "project_admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3">
          <DialogTitle className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="text-lg">
                {mode === "invite"
                  ? "Invite Member"
                  : `Edit ${member?.name || "Member"}`}
              </span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {mode === "invite"
                  ? "Add a new member to your organization"
                  : "Update member access and permissions"}
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Email Input - only for invite mode */}
          {mode === "invite" && (
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm font-medium flex items-center gap-2"
              >
                <Mail className="h-4 w-4 text-muted-foreground" />
                Email Address
              </Label>
              <FormInput
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                placeholder="colleague@company.com"
                maxLength={255}
                showCharacterCount={false}
                className="h-11"
              />
            </div>
          )}

          {/* Member Info - only for edit mode */}
          {mode === "edit" && member && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Member</Label>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                  {member.name?.charAt(0).toUpperCase() ||
                    member.email.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{member.name}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {member.email}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Role Selection - Visual Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Access Level
              </Label>
              <RoleInfoPopover />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {accessLevels.map((level) => {
                const isSelected = formData.role === level.role;
                return (
                  <button
                    key={level.role}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, role: level.role })
                    }
                    className={cn(
                      "relative flex flex-col items-start p-3 rounded-lg border-2 transition-all text-left",
                      isSelected
                        ? cn("border-primary bg-primary/5", level.borderColor)
                        : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={cn("p-1.5 rounded-md mb-2", level.bgColor)}>
                      <level.icon className={cn("h-4 w-4", level.color)} />
                    </div>
                    <span className="font-medium text-sm">{level.label}</span>
                    <span className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {level.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Project Selection - only for editor/admin roles */}
          {requiresProjectSelection && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  Project Access
                  <span className="text-xs font-normal text-muted-foreground">
                    ({formData.selectedProjects.length} selected)
                  </span>
                </Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleSelectAllProjects}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleClearProjectSelection}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="max-h-[180px] overflow-y-auto border rounded-lg bg-muted/30">
                {projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <FolderOpen className="h-8 w-8 text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No projects available
                    </p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {projects.map((project) => {
                      const isChecked = formData.selectedProjects.includes(
                        project.id
                      );
                      return (
                        <label
                          key={project.id}
                          className={cn(
                            "flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors",
                            isChecked ? "bg-primary/10" : "hover:bg-muted"
                          )}
                        >
                          <Checkbox
                            id={`project-${project.id}`}
                            checked={isChecked}
                            onCheckedChange={() =>
                              handleProjectToggle(project.id)
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {project.name}
                            </div>
                            {project.description && (
                              <div className="text-xs text-muted-foreground truncate">
                                {project.description}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              {requiresProjectSelection &&
                formData.selectedProjects.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Select at least one project for this role
                  </p>
                )}
            </div>
          )}

          {/* Org Admin / Viewer Info */}
          {(formData.role === "project_viewer" ||
            formData.role === "org_admin") && (
            <div
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border",
                selectedRole?.bgColor,
                selectedRole?.borderColor
              )}
            >
              <Info className={cn("h-4 w-4 mt-0.5", selectedRole?.color)} />
              <p className="text-sm text-muted-foreground">
                {formData.role === "project_viewer"
                  ? "Viewers automatically get read-only access to all projects."
                  : "Organization admins have full access to all projects and settings."}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !isFormValid}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === "invite" ? "Sending..." : "Updating..."}
              </>
            ) : (
              <>
                {mode === "invite" ? (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invitation
                  </>
                ) : (
                  "Update Access"
                )}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
