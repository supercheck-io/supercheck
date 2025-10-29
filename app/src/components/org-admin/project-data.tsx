import {
  FolderOpen,
  Archive,
  XCircle,
  CheckCircle,
} from "lucide-react";

export const projectStatuses = [
  {
    value: "active",
    label: "Active",
    icon: CheckCircle,
    color: "text-green-600",
  },
  {
    value: "archived",
    label: "Archived",
    icon: Archive,
    color: "text-yellow-600",
  },
  {
    value: "deleted",
    label: "Deleted",
    icon: XCircle,
    color: "text-red-600",
  },
];

export const projectTypes = [
  {
    value: "default",
    label: "Default Project",
    icon: FolderOpen,
    color: "text-blue-600",
  },
  {
    value: "regular",
    label: "Regular Project",
    icon: FolderOpen,
    color: "text-gray-600",
  },
];