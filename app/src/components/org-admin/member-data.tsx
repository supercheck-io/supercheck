import {
  Crown,
  Shield,
  User,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

export const memberRoles = [
  {
    value: "org_owner",
    label: "Organization Owner",
    icon: Crown,
    color: "text-purple-600",
  },
  {
    value: "org_admin",
    label: "Organization Admin",
    icon: Shield,
    color: "text-blue-600",
  },
  {
    value: "project_editor",
    label: "Project Editor",
    icon: User,
    color: "text-green-600",
  },
  {
    value: "project_viewer",
    label: "Project Viewer",
    icon: Eye,
    color: "text-gray-600",
  },
];

export const memberStatuses = [
  {
    value: "active",
    label: "Active",
    icon: CheckCircle,
    color: "text-green-600",
  },
  {
    value: "pending",
    label: "Pending Invitation",
    icon: Clock,
    color: "text-yellow-600",
  },
  {
    value: "expired",
    label: "Expired Invitation",
    icon: XCircle,
    color: "text-red-600",
  },
];