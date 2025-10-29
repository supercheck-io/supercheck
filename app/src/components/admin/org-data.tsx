import { Building, Users, FolderOpen } from "lucide-react";

export const orgStatuses = [
  {
    value: "active",
    label: "Active",
    icon: Building,
    color: "text-green-600",
  },
  {
    value: "inactive", 
    label: "Inactive",
    icon: Building,
    color: "text-gray-600",
  },
];

export const memberCountRanges = [
  {
    value: "0",
    label: "No Members",
    icon: Users,
    color: "text-gray-600",
  },
  {
    value: "1-5",
    label: "1-5 Members", 
    icon: Users,
    color: "text-blue-600",
  },
  {
    value: "6-20",
    label: "6-20 Members",
    icon: Users,
    color: "text-green-600",
  },
  {
    value: "21+",
    label: "21+ Members",
    icon: Users,
    color: "text-purple-600",
  },
];

export const projectCountRanges = [
  {
    value: "0",
    label: "No Projects",
    icon: FolderOpen,
    color: "text-gray-600",
  },
  {
    value: "1-3",
    label: "1-3 Projects",
    icon: FolderOpen,
    color: "text-blue-600",
  },
  {
    value: "4-10",
    label: "4-10 Projects",
    icon: FolderOpen,
    color: "text-green-600",
  },
  {
    value: "11+",
    label: "11+ Projects",
    icon: FolderOpen,
    color: "text-purple-600",
  },
];