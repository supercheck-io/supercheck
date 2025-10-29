import {
  Activity,
  Plus,
  Trash,
  Edit,
  LogIn,
  LogOut,
  Settings,
  Users,
  Shield,
} from "lucide-react";

export const auditActions = [
  {
    value: "user.login",
    label: "User Login",
    icon: LogIn,
    color: "text-green-600",
  },
  {
    value: "user.logout",
    label: "User Logout", 
    icon: LogOut,
    color: "text-gray-600",
  },
  {
    value: "user.created",
    label: "User Created",
    icon: Users,
    color: "text-blue-600",
  },
  {
    value: "user.updated",
    label: "User Updated",
    icon: Edit,
    color: "text-yellow-600",
  },
  {
    value: "user.deleted",
    label: "User Deleted",
    icon: Trash,
    color: "text-red-600",
  },
  {
    value: "org.created",
    label: "Organization Created",
    icon: Plus,
    color: "text-green-600",
  },
  {
    value: "org.updated",
    label: "Organization Updated",
    icon: Edit,
    color: "text-blue-600",
  },
  {
    value: "org.deleted",
    label: "Organization Deleted",
    icon: Trash,
    color: "text-red-600",
  },
  {
    value: "member.invited",
    label: "Member Invited",
    icon: Users,
    color: "text-blue-600",
  },
  {
    value: "member.role.updated",
    label: "Member Role Updated",
    icon: Shield,
    color: "text-purple-600",
  },
  {
    value: "member.removed",
    label: "Member Removed",
    icon: Trash,
    color: "text-red-600",
  },
  {
    value: "project.created",
    label: "Project Created",
    icon: Plus,
    color: "text-green-600",
  },
  {
    value: "project.updated",
    label: "Project Updated",
    icon: Edit,
    color: "text-blue-600",
  },
  {
    value: "project.deleted",
    label: "Project Deleted",
    icon: Trash,
    color: "text-red-600",
  },
  {
    value: "settings.updated",
    label: "Settings Updated",
    icon: Settings,
    color: "text-gray-600",
  },
];

export const auditStatuses = [
  {
    value: "success",
    label: "Success",
    icon: Activity,
    color: "text-green-600",
  },
  {
    value: "warning",
    label: "Warning",
    icon: Activity,
    color: "text-yellow-600",
  },
  {
    value: "error",
    label: "Error",
    icon: Activity,
    color: "text-red-600",
  },
];

// Action categories for better filtering
export const auditActionCategories = [
  {
    value: "user",
    label: "User Actions",
    icon: Users,
    color: "text-blue-600",
  },
  {
    value: "org",
    label: "Organization Actions", 
    icon: Shield,
    color: "text-purple-600",
  },
  {
    value: "member",
    label: "Member Actions",
    icon: Users,
    color: "text-green-600",
  },
  {
    value: "project",
    label: "Project Actions",
    icon: Plus,
    color: "text-orange-600",
  },
  {
    value: "settings",
    label: "Settings Actions",
    icon: Settings,
    color: "text-gray-600",
  },
];