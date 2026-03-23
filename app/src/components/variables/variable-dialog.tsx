"use client";

import { useState, useEffect, useRef } from "react";
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
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Shield, Variable as VariableIcon, Info, FileText, Upload, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Variable } from "./schema";
import { MAX_FILE_SIZE } from "@/lib/validations/variable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VariableType = "variable" | "secret" | "file";

interface VariableFormData {
  id?: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  type: VariableType;
}

interface VariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  variable?: Variable | null;
  onSuccess: () => void;
  defaultIsSecret?: boolean;
  defaultType?: VariableType;
  canViewSecrets?: boolean;
  initialSecretValue?: string;
}

function toBoolean(value: boolean | string | undefined): boolean {
  return typeof value === 'string' ? value === 'true' : Boolean(value);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VariableDialog({
  open,
  onOpenChange,
  projectId,
  variable,
  onSuccess,
  defaultIsSecret = false,
  defaultType,
  canViewSecrets = false,
  initialSecretValue,
}: VariableDialogProps) {
  const initialType: VariableType = defaultType ?? (defaultIsSecret ? 'secret' : 'variable');

  const [formData, setFormData] = useState<VariableFormData>({
    key: '',
    value: '',
    description: '',
    isSecret: defaultIsSecret,
    type: initialType,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secretLoadWarning, setSecretLoadWarning] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!variable;
  const isFileType = formData.type === 'file';
  const isSecretType = formData.type === 'secret';
  const isEditingFile = isEditing && variable?.type === 'file';

  useEffect(() => {
    if (!variable || !open) {
      setFormData({
        key: '',
        value: '',
        description: '',
        isSecret: defaultIsSecret,
        type: initialType,
      });
      setSelectedFile(null);
      setSecretLoadWarning(null);
      setFetchingData(false);
      setErrors({});
      return;
    }

    const abortController = new AbortController();

    const fetchVariable = async () => {
      setFetchingData(true);
      setSecretLoadWarning(null);
      setErrors({});

      try {
        const response = await fetch(
          `/api/projects/${projectId}/variables/${variable.id}`,
          {
            signal: abortController.signal,
            cache: 'no-store',
          }
        );
        const data = await response.json();

        const sourceVariable = data.success && data.data ? data.data : variable;
        const isSecretValue = toBoolean(sourceVariable.isSecret);
        const varType: VariableType = sourceVariable.type || (isSecretValue ? 'secret' : 'variable');
        let resolvedValue = '';

        if (varType !== 'file') {
          resolvedValue = isSecretValue ? '' : (sourceVariable.value || '');

          if (isSecretValue) {
            if (canViewSecrets && initialSecretValue) {
              resolvedValue = initialSecretValue;
            } else if (canViewSecrets) {
              try {
                const decryptResponse = await fetch(
                  `/api/projects/${projectId}/variables/${variable.id}/decrypt`,
                  {
                    method: 'POST',
                    signal: abortController.signal,
                    cache: 'no-store',
                  }
                );

                if (decryptResponse.ok) {
                  const decryptData = await decryptResponse.json();
                  resolvedValue = decryptData?.data?.value || '';
                } else if (decryptResponse.status === 401 || decryptResponse.status === 403) {
                  setSecretLoadWarning('You can edit metadata, but secret reveal requires permission. Leave value blank to keep current secret.');
                } else {
                  setSecretLoadWarning('Could not load the current secret value. Leave value blank to keep existing secret.');
                }
              } catch (decryptError) {
                if (!abortController.signal.aborted) {
                  console.error('Error decrypting variable for edit:', decryptError);
                  setSecretLoadWarning('Could not load the current secret value. Leave value blank to keep existing secret.');
                }
              }
            }
          }
        }

        if (!abortController.signal.aborted) {
          setFormData({
            key: sourceVariable.key,
            value: resolvedValue,
            description: sourceVariable.description || '',
            isSecret: isSecretValue,
            type: varType,
          });
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        console.error('Error fetching variable:', error);
        const isSecretValue = toBoolean(variable.isSecret);
        const varType: VariableType = variable.type || (isSecretValue ? 'secret' : 'variable');
        setFormData({
          key: variable.key,
          value: varType === 'file' ? '' : (isSecretValue ? (canViewSecrets ? (initialSecretValue || '') : '') : (variable.value || '')),
          description: variable.description || '',
          isSecret: isSecretValue,
          type: varType,
        });
      } finally {
        if (!abortController.signal.aborted) {
          setFetchingData(false);
        }
      }
    };

    fetchVariable();

    return () => {
      abortController.abort();
    };
  }, [variable, open, projectId, defaultIsSecret, initialType, canViewSecrets, initialSecretValue]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.key.trim()) {
      newErrors.key = "Variable name is required";
    } else if (formData.key.length < 4 || formData.key.length > 20) {
      newErrors.key = "Variable name must be between 4 and 20 characters";
    } else if (!/^[A-Z][A-Z0-9_]*$/.test(formData.key)) {
      newErrors.key = "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores";
    }

    if (isFileType) {
      if (!isEditing && !selectedFile) {
        newErrors.file = "File is required";
      }
      if (selectedFile && selectedFile.size > MAX_FILE_SIZE) {
        newErrors.file = `File size must be less than ${formatFileSize(MAX_FILE_SIZE)}`;
      }
    } else {
      if (!isEditing && !formData.value.trim()) {
        newErrors.value = "Value is required";
      }
    }

    if (formData.description.length > 300) {
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
      const normalizedDescription = formData.description.trim();

      if (isFileType) {
        const body = new FormData();
        body.append('key', formData.key);
        body.append('type', 'file');
        if (normalizedDescription) {
          body.append('description', normalizedDescription);
        }
        if (selectedFile) {
          body.append('file', selectedFile);
        }

        const response = await fetch(url, { method, body });
        const data = await response.json();

        if (data.success) {
          toast.success(isEditing ? "File variable updated successfully" : "File variable created successfully");
          onSuccess();
          onOpenChange(false);
        } else {
          handleServerErrors(data);
        }
      } else {
        const payload: Record<string, string | boolean> = {
          key: formData.key,
          isSecret: isSecretType,
          type: formData.type,
        };

        if (isEditing || normalizedDescription) {
          payload.description = normalizedDescription;
        }

        if (!isEditing || formData.value.trim() !== '') {
          payload.value = formData.value;
        }

        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (data.success) {
          toast.success(isEditing ? "Variable updated successfully" : "Variable created successfully");
          onSuccess();
          onOpenChange(false);
        } else {
          handleServerErrors(data);
        }
      }
    } catch (error) {
      console.error("Error saving variable:", error);
      toast.error("Failed to save variable");
    } finally {
      setLoading(false);
    }
  };

  const handleServerErrors = (data: { error?: string; details?: Array<{ path?: string[]; message: string }> }) => {
    if (data.details && Array.isArray(data.details)) {
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
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setFormData({ ...formData, key: value });
  };

  const handleTypeChange = (type: VariableType) => {
    setFormData({
      ...formData,
      type,
      isSecret: type === 'secret',
      value: type === 'file' ? '' : formData.value,
    });
    if (type !== 'file') {
      setSelectedFile(null);
    }
    setErrors({});
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setErrors((prev) => { const { file: _, ...rest } = prev; return rest; });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrors((prev) => { const { file: _, ...rest } = prev; return rest; });
    }
  };

  const typeIcon = isFileType
    ? <FileText className="h-5 w-5 text-green-500" />
    : isSecretType
      ? <Shield className="h-5 w-5 text-red-500" />
      : <VariableIcon className="h-5 w-5 text-blue-500" />;

  const canSubmit = (() => {
    if (loading || fetchingData || !formData.key.trim() || formData.key.length < 4 || formData.description.length > 300) {
      return false;
    }
    if (isFileType) {
      return isEditing || !!selectedFile;
    }
    return isEditing || !!formData.value.trim();
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="space-y-3">
            <DialogTitle className="flex items-center gap-2">
              {typeIcon}
              {isEditing ? 'Edit Variable' : 'Add Variable'}
            </DialogTitle>
            <DialogDescription className="text-left">
              {isEditing
                ? 'Update the variable details below.'
                : 'Variables store configuration values for your tests. Regular variables use getVariable(), secrets use getSecret(), and files use getFile().'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Type selector - disabled when editing */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(val) => handleTypeChange(val as VariableType)}
                disabled={isEditing || loading || fetchingData}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="variable">
                    <span className="flex items-center gap-2">
                      <VariableIcon className="h-4 w-4 text-blue-500" />
                      Variable
                    </span>
                  </SelectItem>
                  <SelectItem value="secret">
                    <span className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-red-500" />
                      Secret
                    </span>
                  </SelectItem>
                  <SelectItem value="file">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-green-500" />
                      File
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {isEditing && (
                <p className="text-xs text-muted-foreground">Type cannot be changed after creation.</p>
              )}
            </div>

            {/* Variable name */}
            <div className="space-y-2">
              <Label htmlFor="key" className="text-sm font-medium">Variable Name *</Label>
              <Input
                id="key"
                placeholder="e.g., API_KEY, TEST_DATA (4-20 chars)"
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

            {/* Value input for variable/secret OR file upload for file type */}
            {isFileType ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">File {!isEditing && '*'}</Label>
                {isEditingFile && variable?.fileName && !selectedFile && (
                  <div className="flex items-center gap-2 rounded-md border p-3 bg-muted/50">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{variable.fileName}</span>
                    {variable.fileSize && (
                      <span className="text-xs text-muted-foreground">({formatFileSize(Number(variable.fileSize))})</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">Select a new file below to replace</span>
                  </div>
                )}
                <div
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
                    dragActive
                      ? 'border-primary bg-primary/5'
                      : errors.file
                        ? 'border-destructive'
                        : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.json,.txt,.tsv,.xml,.yaml,.yml"
                    onChange={handleFileSelect}
                    disabled={loading || fetchingData}
                  />
                  {selectedFile ? (
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="text-sm font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Drag & drop a file here, or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        CSV, JSON, TXT, TSV, XML, YAML — up to {formatFileSize(MAX_FILE_SIZE)}
                      </p>
                    </>
                  )}
                </div>
                {errors.file && (
                  <p className="text-sm text-destructive">{errors.file}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="value" className="text-sm font-medium">Value *</Label>
                <Input
                  id="value"
                  type={isSecretType ? "password" : "text"}
                  placeholder={isSecretType ? "Enter secret value" : "Enter value"}
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  disabled={loading || fetchingData}
                  className={errors.value ? "border-destructive" : ""}
                />
                {errors.value && (
                  <p className="text-sm text-destructive">{errors.value}</p>
                )}
                {isEditing && isSecretType && (
                  <p className="text-xs text-muted-foreground">
                    {secretLoadWarning || 'Leave value blank to keep the current secret unchanged.'}
                  </p>
                )}
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what this variable is used for (optional, up to 300 characters)..."
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
                {formData.description.length}/300 characters
              </p>
            </div>

            {/* Usage info */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {isFileType ? (
                  <>Files are stored securely and accessed using <code className="px-1 py-0.5 bg-muted rounded text-xs">getFile(&apos;{formData.key || 'KEY'}&apos;)</code> in tests, which returns the file path. You can then read the file content in your test script.</>
                ) : isSecretType ? (
                  <>Secrets are encrypted and accessed using <code className="px-1 py-0.5 bg-muted rounded text-xs">getSecret(&apos;{formData.key || 'KEY'}&apos;)</code> in tests. Avoid intentional logging; execution output redaction is applied as an additional protection layer.</>
                ) : (
                  <>Variables are stored in plain text and accessed using <code className="px-1 py-0.5 bg-muted rounded text-xs">getVariable(&apos;{formData.key || 'KEY'}&apos;)</code> in tests.</>
                )}
              </AlertDescription>
            </Alert>
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
              disabled={!canSubmit}
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
