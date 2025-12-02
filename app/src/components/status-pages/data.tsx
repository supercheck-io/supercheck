import {
  Layers,
  AlertCircle,
  Users,
  Palette,
  Link2,
  Rocket,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

export interface StatusPageStep {
  title: string;
  description: string;
  icon: LucideIcon;
}

export const statusPageSteps: StatusPageStep[] = [
  {
    title: "Add Components",
    description:
      "Track different parts of your service (API, Website, Database)",
    icon: Layers,
  },
  {
    title: "Create Incidents",
    description: "Communicate about outages or scheduled maintenance",
    icon: AlertCircle,
  },
  {
    title: "Enable Subscriptions",
    description: "Allow users to subscribe for email or webhook updates",
    icon: Users,
  },
  {
    title: "Customize Branding",
    description: "Add your logo, colors, and custom domain in Settings",
    icon: Palette,
  },
  {
    title: "Link Monitors",
    description: "Connect monitors to automatically update component status",
    icon: Link2,
  },
  {
    title: "Publish Page",
    description: "Make your status page live when you're ready",
    icon: Rocket,
  },
];
