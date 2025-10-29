'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, User, Shield, Crown, Info } from 'lucide-react';
import { toast } from 'sonner';
import { FormInput } from '@/components/ui/form-input';
import { inviteMemberSchema, updateMemberSchema } from '@/lib/validations/member';
import { z } from 'zod';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

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
  mode: 'invite' | 'edit';
  member?: MemberData;
  projects: Project[];
  onSubmit: (memberData: MemberData) => Promise<void>;
  isLoading?: boolean;
}

const accessLevels = [
  {
    role: 'project_viewer',
    label: 'Project Viewer',
    description: 'Read-only access to all organization projects. No project selection required.',
    icon: Eye
  },
  {
    role: 'project_editor',
    label: 'Project Editor',
    description: 'Create and edit tests, jobs, monitors in selected projects only. Project selection required.',
    icon: User
  },
  {
    role: 'project_admin',
    label: 'Project Admin',
    description: 'Full admin access to selected projects only. Can manage project settings. Project selection required.',
    icon: Shield
  },
  {
    role: 'org_admin',
    label: 'Organization Admin',
    description: 'Can manage organization settings and invite members. Has access to all projects.',
    icon: Crown
  }
];

// Role Info Popover Component
function RoleInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" side="right" sideOffset={8}>
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Member Roles</h4>
          {accessLevels.map((level) => (
            <div key={level.role} className="flex items-start space-x-2 text-xs">
              <level.icon className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">{level.label}</p>
                <p className="text-muted-foreground">{level.description}</p>
              </div>
            </div>
          ))}
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
  isLoading = false
}: MemberAccessDialogProps) {
  const [formData, setFormData] = useState<MemberData>({
    email: '',
    role: 'project_editor',
    selectedProjects: []
  });

  // Initialize form data when dialog opens or member changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && member) {
        setFormData({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          selectedProjects: member.selectedProjects || []
        });
      } else {
        setFormData({
          email: '',
          role: 'project_editor',
          selectedProjects: []
        });
      }
    }
  }, [open, mode, member]);

  // Clear project assignments when project_viewer is selected
  useEffect(() => {
    if (formData.role === 'project_viewer') {
      setFormData(prev => ({ ...prev, selectedProjects: [] }));
    }
  }, [formData.role]);

  const handleProjectToggle = (projectId: string) => {
    setFormData(prev => ({
      ...prev,
      selectedProjects: prev.selectedProjects.includes(projectId)
        ? prev.selectedProjects.filter(id => id !== projectId)
        : [...prev.selectedProjects, projectId]
    }));
  };

  const handleSelectAllProjects = () => {
    const activeProjectIds = projects.map(project => project.id);
    setFormData(prev => ({
      ...prev,
      selectedProjects: activeProjectIds
    }));
  };

  const handleClearProjectSelection = () => {
    setFormData(prev => ({
      ...prev,
      selectedProjects: []
    }));
  };

  const handleSubmit = async () => {
    // Prepare data for validation
    const dataToValidate = {
      email: formData.email.trim(),
      role: formData.role,
      selectedProjects: formData.selectedProjects
    };

    // Validate form data using appropriate schema
    try {
      if (mode === 'invite') {
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
      toast.error('Please fix the form errors');
      return;
    }

    try {
      await onSubmit({
        ...formData,
        email: dataToValidate.email,
        selectedProjects: dataToValidate.selectedProjects
      });
      
      // Reset form for invite mode
      if (mode === 'invite') {
        setFormData({
          email: '',
          role: 'project_editor',
          selectedProjects: []
        });
      }
      
      onOpenChange(false);
      toast.success(mode === 'invite' ? 'Invitation sent successfully' : 'Member access updated successfully');
    } catch (error) {
      console.error(`Error ${mode === 'invite' ? 'inviting' : 'updating'} member:`, error);
      toast.error(mode === 'invite' ? 'Failed to send invitation' : 'Failed to update member access');
    }
  };

  const isFormValid = formData.email.trim() && 
    (formData.role === 'project_viewer' || formData.selectedProjects.length > 0);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <DialogTitle>
              {mode === 'invite' ? 'Invite Member' : `Edit ${member?.name || 'Member'}`}
            </DialogTitle>
            <RoleInfoPopover />
          </div>
          <DialogDescription>
            {mode === 'invite' 
              ? 'Add a new member to your organization.'
              : 'Update member access and permissions.'
            }
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Email Input - only for invite mode */}
          {mode === 'invite' && (
            <FormInput
              id="email"
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="user@example.com"
              maxLength={255}
              showCharacterCount={false}
            />
          )}

          {/* Member Info - only for edit mode */}
          {mode === 'edit' && member && (
            <div className="space-y-2">
              <Label>Member</Label>
              <div className="p-2 bg-muted rounded text-sm">
                <div className="font-medium">{member.name}</div>
                <div className="text-muted-foreground">{member.email}</div>
              </div>
            </div>
          )}
          
          {/* Role Selection */}
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.role}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {accessLevels.map((level) => (
                  <SelectItem key={level.role} value={level.role}>
                    <div className="flex items-center space-x-2 text-left">
                      <level.icon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{level.label}</div>
                        <div className="text-xs text-muted-foreground">{level.description.split('.')[0]}</div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Project Selection - only for non-project_viewer roles */}
          {(formData.role === 'project_editor' || formData.role === 'project_admin') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Project Access ({formData.selectedProjects.length} selected)</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAllProjects}
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClearProjectSelection}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              
              <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                {projects.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">No projects available</div>
                ) : (
                  projects.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2 p-1">
                      <Checkbox
                        id={`project-${project.id}`}
                        checked={formData.selectedProjects.includes(project.id)}
                        onCheckedChange={() => handleProjectToggle(project.id)}
                      />
                      <Label
                        htmlFor={`project-${project.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        <div>{project.name}</div>
                        {project.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {project.description}
                          </div>
                        )}
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Project Viewer Info */}
          {formData.role === 'project_viewer' && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">
              Project viewers have read-only access to all projects automatically.
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !isFormValid}>
            {isLoading 
              ? (mode === 'invite' ? 'Sending...' : 'Updating...') 
              : (mode === 'invite' ? 'Send Invitation' : 'Update Access')
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}