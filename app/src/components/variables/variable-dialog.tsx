"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Shield, Variable as VariableIcon, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Variable } from "./schema";

interface VariableFormData {
  id?: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
}

interface VariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  variable?: Variable | null;
  onSuccess: () => void;
  defaultIsSecret?: boolean;
}

export function VariableDialog({
  open,
  onOpenChange,
  projectId,
  variable,
  onSuccess,
  defaultIsSecret = false
}: VariableDialogProps) {
  const [formData, setFormData] = useState<VariableFormData>({
    key: '',
    value: '',
    description: '',
    isSecret: defaultIsSecret
  });
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditing = !!variable;

  useEffect(() => {
    if (variable && open) {
      // Fetch the variable from API to get decrypted value for secrets
      const fetchVariable = async () => {
        setFetchingData(true);
        try {
          const response = await fetch(
            `/api/projects/${projectId}/variables/${variable.id}`
          );
          const data = await response.json();

          if (data.success && data.data) {
            setFormData({
              key: data.data.key,
              value: data.data.value || '', // Decrypted value from API
              description: data.data.description || '',
              isSecret: typeof data.data.isSecret === 'string'
                ? data.data.isSecret === 'true'
                : data.data.isSecret
            });
          } else {
            // Fallback to prop data if API fails
            setFormData({
              key: variable.key,
              value: variable.value || '',
              description: variable.description || '',
              isSecret: typeof variable.isSecret === 'string'
                ? variable.isSecret === 'true'
                : variable.isSecret
            });
          }
        } catch (error) {
          console.error("Error fetching variable:", error);
          // Fallback to prop data if fetch fails
          setFormData({
            key: variable.key,
            value: variable.value || '',
            description: variable.description || '',
            isSecret: typeof variable.isSecret === 'string'
              ? variable.isSecret === 'true'
              : variable.isSecret
          });
        } finally {
          setFetchingData(false);
        }
      };

      fetchVariable();
    } else if (!variable || !open) {
      setFormData({
        key: '',
        value: '',
        description: '',
        isSecret: defaultIsSecret
      });
      setFetchingData(false);
    }
    setErrors({});
  }, [variable, open, projectId, defaultIsSecret]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.key.trim()) {
      newErrors.key = "Variable name is required";
    } else if (formData.key.length < 4 || formData.key.length > 20) {
      newErrors.key = "Variable name must be between 4 and 20 characters";
    } else if (!/^[A-Z][A-Z0-9_]*$/.test(formData.key)) {
      newErrors.key = "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores";
    }

    if (!formData.value.trim()) {
      newErrors.value = "Value is required";
    }

    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    } else if (formData.description.length < 20) {
      newErrors.description = "Description must be at least 20 characters";
    } else if (formData.description.length > 300) {
      newErrors.description = "Description must be less than 300 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const url = isEditing
        ? `/api/projects/${projectId}/variables/${variable.id}`
        : `/api/projects/${projectId}/variables`;

      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(isEditing ? "Variable updated successfully" : "Variable created successfully");
        onSuccess();
        onOpenChange(false);
      } else {
        if (data.details && Array.isArray(data.details)) {
          // Handle validation errors from server
          const serverErrors: Record<string, string> = {};
          data.details.forEach((error: { path?: string[]; message: string }) => {
            if (error.path && error.path.length > 0) {
              serverErrors[error.path[0]] = error.message;
            }
          });
          setErrors(serverErrors);
        } else {
          toast.error(data.error || "Failed to save variable");
        }
      }
    } catch (error) {
      console.error("Error saving variable:", error);
      toast.error("Failed to save variable");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setFormData({ ...formData, key: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-2">
              {formData.isSecret ? (
                <Shield className="h-5 w-5 text-red-500" />
              ) : (
                <VariableIcon className="h-5 w-5 text-blue-500" />
              )}
              {isEditing ? 'Edit Variable' : 'Add Variable'}
            </DialogTitle>
            <DialogDescription className="text-left">
              {isEditing
                ? 'Update the variable details below.'
                : 'Variables store configuration values for your tests. Regular variables use getVariable() and secrets use getSecret().'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="key" className="text-sm font-medium">Variable Name *</Label>
              <Input
                id="key"
                placeholder="e.g., API_KEY, DB_URL (4-20 chars)"
                value={formData.key}
                onChange={handleKeyChange}
                disabled={loading || fetchingData}
                className={errors.key ? "border-destructive" : ""}
              />
              {errors.key && (
                <p className="text-sm text-destructive">{errors.key}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {formData.key.length}/20 characters (4-20 required, uppercase letters, numbers, and underscores only)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="value" className="text-sm font-medium">Value *</Label>
              <Input
                id="value"
                type={formData.isSecret ? "password" : "text"}
                placeholder={formData.isSecret ? "Enter secret value" : "Enter value"}
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                disabled={loading || fetchingData}
                className={errors.value ? "border-destructive" : ""}
              />
              {errors.value && (
                <p className="text-sm text-destructive">{errors.value}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">Description *</Label>
              <Textarea
                id="description"
                placeholder="Describe what this variable is used for (20-300 characters)..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                disabled={loading || fetchingData}
                className={errors.description ? "border-destructive" : ""}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {formData.description.length}/300 characters (minimum 20 required)
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="secret"
                  checked={formData.isSecret}
                  onCheckedChange={(checked) => setFormData({ ...formData, isSecret: !!checked })}
                  disabled={loading || fetchingData}
                />
                <Label htmlFor="secret" className="text-sm font-medium cursor-pointer">
                  Mark as secret
                </Label>
                <Badge variant={formData.isSecret ? "outline" : "secondary"} className={`text-xs ${formData.isSecret ? "border-red-300 text-red-600 bg-red-100 dark:border-red-400 dark:text-red-400 dark:bg-red-900/20" : ""}`}>
                  {formData.isSecret ? "Secret" : "Variable"}
                </Badge>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {formData.isSecret ? (
                    <>Secrets are encrypted and accessed using <code className="px-1 py-0.5 bg-muted rounded text-xs">getSecret(&apos;{formData.key || 'KEY'}&apos;)</code> in tests. They cannot be logged to console for security.</>
                  ) : (
                    <>Variables are stored in plain text and accessed using <code className="px-1 py-0.5 bg-muted rounded text-xs">getVariable(&apos;{formData.key || 'KEY'}&apos;)</code> in tests.</>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          </div>



          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading || fetchingData}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                loading ||
                fetchingData ||
                !formData.key.trim() ||
                !formData.value.trim() ||
                !formData.description.trim() ||
                formData.key.length < 4 ||
                formData.description.length < 20
              }
            >
              {loading
                ? (isEditing ? 'Updating...' : 'Creating...')
                : fetchingData
                  ? 'Loading...'
                  : (isEditing ? 'Update Variable' : 'Add Variable')
              }
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}