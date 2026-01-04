"use client";

import * as React from "react";
import { X, Plus, Check, ChevronsUpDown, Trash2, Palette } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdByUserId?: string;
}

interface TagSelectorProps {
  value: Tag[];
  onChange: (tags: Tag[]) => void;
  availableTags: Tag[];
  onCreateTag?: (name: string, color?: string) => Promise<Tag>;
  onDeleteTag?: (tagId: string) => Promise<void>;
  canDeleteTag?: (tag: Tag) => boolean; // Function to check if specific tag can be deleted
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxTags?: number;
}

const predefinedColors = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#EC4899",
  "#6B7280",
  "#14B8A6",
  "#F472B6",
  "#A78BFA",
  "#FB7185",
  "#FBBF24",
];

export function TagSelector({
  value,
  onChange,
  availableTags,
  onCreateTag,
  onDeleteTag,
  canDeleteTag,
  placeholder = "Select tags...",
  className,
  disabled = false,
  maxTags = 10,
}: TagSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [selectedColor, setSelectedColor] = React.useState<string>();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [tagToDelete, setTagToDelete] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const selectedIds = React.useMemo(
    () => new Set(value.map((tag) => tag.id)),
    [value]
  );

  const filteredTags = React.useMemo(() => {
    if (!inputValue) return availableTags;
    return availableTags.filter((tag) =>
      tag.name.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [availableTags, inputValue]);

  const handleSelect = (tag: Tag) => {
    if (selectedIds.has(tag.id)) {
      // Remove tag
      onChange(value.filter((t) => t.id !== tag.id));
    } else {
      // Check if we've reached the maximum number of tags
      if (value.length >= maxTags) {
        toast.error(`Maximum of ${maxTags} tags allowed`);
        return;
      }
      // Add tag
      onChange([...value, tag]);
    }
  };

  const validateTagName = (
    name: string
  ): { isValid: boolean; error?: string } => {
    if (!name.trim()) {
      return { isValid: false, error: "Tag name cannot be empty" };
    }

    const trimmedName = name.trim();

    // Check length (3-20 characters)
    if (trimmedName.length < 3 || trimmedName.length > 20) {
      return {
        isValid: false,
        error: "Tag name must be between 3 and 20 characters",
      };
    }

    // Check for whitespace
    if (/\s/.test(trimmedName)) {
      return { isValid: false, error: "Tag name cannot contain spaces" };
    }

    // Check for special characters - only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      return {
        isValid: false,
        error:
          "Tag name can only contain letters, numbers, underscores, and hyphens",
      };
    }

    return { isValid: true };
  };

  const handleCreateTag = async (color?: string) => {
    if (!inputValue.trim() || isCreating || !onCreateTag) return;

    const trimmedInput = inputValue.trim();

    // Validate tag name
    const validation = validateTagName(trimmedInput);
    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    // Check if tag already exists
    const existingTag = availableTags.find(
      (tag) => tag.name.toLowerCase() === trimmedInput.toLowerCase()
    );
    if (existingTag) {
      handleSelect(existingTag);
      setInputValue("");
      setShowColorPicker(false);
      toast.info(
        `Tag "${existingTag.name}" already exists and has been selected`
      );
      return;
    }

    // Check if we've reached the maximum number of tags per test (default 10)
    if (value.length >= maxTags) {
      toast.error(`Maximum of ${maxTags} tags allowed`);
      return;
    }

    setIsCreating(true);
    try {
      const newTag = await onCreateTag(trimmedInput, color);
      onChange([...value, newTag]);
      setInputValue("");
      setShowColorPicker(false);
      setSelectedColor(undefined);
      toast.success(`Tag "${newTag.name}" created successfully`);
    } catch (error) {
      console.error("Failed to create tag:", error);
      toast.error("Failed to create tag. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTag = (tagId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteTag) return;

    setTagToDelete(tagId);
    setShowDeleteDialog(true);
  };

  const confirmDeleteTag = async () => {
    if (!tagToDelete || !onDeleteTag) return;

    setIsDeleting(true);
    try {
      await onDeleteTag(tagToDelete);
      // Remove from selected tags if it was selected
      onChange(value.filter((t) => t.id !== tagToDelete));
      // Success message is now handled in the onDeleteTag function
    } catch (error) {
      console.error("Failed to delete tag:", error);
      // Show the specific error message from the API
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to delete tag. Please try again.";
      toast.error(errorMessage);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setTagToDelete(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      if (showColorPicker) {
        handleCreateTag(selectedColor);
      } else {
        handleCreateTag();
      }
    }
  };

  const removeSelectedTag = (tagId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((t) => t.id !== tagId));
  };

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            aria-expanded={open}
            aria-controls="tag-selector-content"
            className={cn(
              "flex min-h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              "cursor-pointer hover:bg-accent/50",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => !disabled && setOpen(!open)}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {value.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                value.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="text-xs pr-1"
                    style={
                      tag.color
                        ? {
                          backgroundColor: tag.color + "20",
                          color: tag.color,
                          borderColor: tag.color + "40",
                        }
                        : {}
                    }
                  >
                    {tag.name}
                    <div
                      className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-foreground/10 cursor-pointer p-0.5"
                      onClick={(e) => removeSelectedTag(tag.id, e)}
                    >
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </div>
                  </Badge>
                ))
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search or create tags..."
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={handleKeyDown}
            />
            <CommandList>
              <CommandEmpty>
                {inputValue && onCreateTag ? (
                  <div className="">
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => handleCreateTag()}
                      disabled={isCreating}
                    >
                      <Plus className="h-4 w-4 mr-2 text-green-500" />
                      {isCreating
                        ? "Creating tag..."
                        : `Create tag "${inputValue}"`}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      disabled={isCreating}
                    >
                      <Palette className="h-4 w-4 mr-2 text-orange-500" />
                      Choose tag color
                    </Button>
                    {showColorPicker && (
                      <div className="grid grid-cols-5 gap-2 p-2 border rounded-md">
                        {predefinedColors.map((color) => (
                          <button
                            key={color}
                            className={cn(
                              "w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform",
                              selectedColor === color
                                ? "border-foreground"
                                : "border-transparent"
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => setSelectedColor(color)}
                          />
                        ))}
                      </div>
                    )}
                    {showColorPicker && (
                      <Button
                        variant="default"
                        size="sm"
                        className="w-82 m-2"
                        onClick={() => handleCreateTag(selectedColor)}
                        disabled={isCreating}
                      >
                        {isCreating
                          ? "Creating..."
                          : `Create with ${selectedColor ? "selected" : "random"
                          } color`}
                      </Button>
                    )}
                  </div>
                ) : inputValue && !onCreateTag ? (
                  <div className="text-center py-2 text-xs text-muted-foreground">
                    No matching tags found.
                    <br />
                    No permission to create tags.
                  </div>
                ) : (
                  "No tags found."
                )}
              </CommandEmpty>
              <CommandGroup>
                {filteredTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleSelect(tag)}
                    className="flex items-center justify-between group"
                  >
                    <div className="flex items-center flex-1">
                      <div
                        className="w-3 h-3 rounded-full mr-2"
                        style={{ backgroundColor: tag.color || "#64748b" }}
                      />
                      <span className="flex-1">{tag.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedIds.has(tag.id) && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      {onDeleteTag && canDeleteTag && canDeleteTag(tag) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleDeleteTag(tag.id, e)}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the tag{" "}
              <span className="font-semibold">
                &quot;{availableTags.find((t) => t.id === tagToDelete)?.name}
                &quot;
              </span>
              . This action cannot be undone.
              <br />
              <br />
              <strong>Note:</strong> If this tag is currently used in any tests,
              the deletion will be prevented and you&apos;ll need to remove the
              tag from those tests first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTag}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
