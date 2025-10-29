import {
  Crown,
  Shield,
  User,
  CheckCircle,
  XCircle,
  UserCheck,
  UserX,
} from "lucide-react";

export const userRoles = [
  {
    value: "user",
    label: "User",
    icon: User,
    color: "text-gray-600",
  },
  {
    value: "admin",
    label: "Admin",
    icon: Shield,
    color: "text-blue-600",
  },
  {
    value: "super_admin",
    label: "Super Admin",
    icon: Crown,
    color: "text-purple-600",
  },
];

export const userStatuses = [
  {
    value: "active",
    label: "Active",
    icon: UserCheck,
    color: "text-green-600",
  },
  {
    value: "banned",
    label: "Banned",
    icon: UserX,
    color: "text-red-600",
  },
];

export const emailVerificationStatus = [
  {
    value: "verified",
    label: "Verified",
    icon: CheckCircle,
    color: "text-green-600",
  },
  {
    value: "unverified",
    label: "Unverified",
    icon: XCircle,
    color: "text-yellow-600",
  },
];