"use client";

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { UserCheck, Building2, Loader2, Crown, Shield, User } from 'lucide-react';

interface OrganizationRole {
  organizationId: string;
  organizationName: string;
  role: string;
}

interface ImpersonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userEmail: string;
}

export function ImpersonateDialog({ 
  open, 
  onOpenChange, 
  userId, 
  userName, 
  userEmail 
}: ImpersonateDialogProps) {
  const [organizations, setOrganizations] = useState<OrganizationRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const fetchUserOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/organizations`);
      if (response.ok) {
        const data = await response.json();
        setOrganizations(data.organizations || []);
      } else {
        console.error('Failed to fetch user organizations');
        toast.error('Failed to load user organizations');
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
      toast.error('Failed to load user organizations');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) {
      fetchUserOrganizations();
    }
  }, [open, userId, fetchUserOrganizations]);

  const handleImpersonate = async (organizationId?: string) => {
    setImpersonating(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'impersonate',
          organizationId // Optional: specify which organization to impersonate in
        }),
      });

      const data = await response.json();

      if (data.success) {
        const orgName = organizations.find(o => o.organizationId === organizationId)?.organizationName;
        const message = organizationId 
          ? `Now impersonating ${userName} in ${orgName}`
          : `Now impersonating ${userName}`;
        
        toast.success(message);
        onOpenChange(false);
        // Force a full page reload to refresh all session context
        window.location.href = '/';
      } else {
        toast.error(data.error || 'Failed to impersonate user');
      }
    } catch (error) {
      console.error('Error impersonating user:', error);
      toast.error('Failed to impersonate user');
    } finally {
      setImpersonating(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'org_owner':
        return 'bg-indigo-100 text-indigo-800';
      case 'org_admin':
        return 'bg-blue-100 text-blue-800';
      case 'project_editor':
        return 'bg-green-100 text-green-800';
      case 'project_viewer':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'org_owner':
        return <Crown className="h-3 w-3" />;
      case 'org_admin':
        return <Shield className="h-3 w-3" />;
      case 'project_editor':
        return <UserCheck className="h-3 w-3" />;
      case 'project_viewer':
        return <User className="h-3 w-3" />;
      default:
        return <User className="h-3 w-3" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Impersonate User
          </DialogTitle>
          <DialogDescription>
            Impersonate <strong>{userName}</strong> ({userEmail}) to test their permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading organizations...</span>
            </div>
          ) : organizations.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-muted-foreground">This user has no organization memberships.</p>
              <Button 
                onClick={() => handleImpersonate()} 
                disabled={impersonating}
                className="mt-4"
              >
                {impersonating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Impersonating...
                  </>
                ) : (
                  <>
                    <UserCheck className="mr-2 h-4 w-4" />
                    Impersonate Anyway
                  </>
                )}
              </Button>
            </div>
          ) : organizations.length === 1 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This user is a member of one organization:
              </p>
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{organizations[0].organizationName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {getRoleIcon(organizations[0].role)}
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(organizations[0].role)}`}>
                          {organizations[0].role}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <Button 
                onClick={() => handleImpersonate(organizations[0].organizationId)} 
                disabled={impersonating}
                className="w-full"
              >
                {impersonating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Impersonating...
                  </>
                ) : (
                  <>
                    <UserCheck className="mr-2 h-4 w-4" />
                    Impersonate in {organizations[0].organizationName}
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This user is a member of {organizations.length} organizations. Choose which one to impersonate in:
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {organizations.map((org) => (
                  <div key={org.organizationId} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{org.organizationName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {getRoleIcon(org.role)}
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(org.role)}`}>
                              {org.role}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleImpersonate(org.organizationId)}
                        disabled={impersonating}
                      >
                        {impersonating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <UserCheck className="mr-1 h-3 w-3" />
                            Impersonate
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}