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
    title: "Add components",
    description:
      "Track the parts of your service visitors care about, such as API, website, or database.",
    icon: Layers,
  },
  {
    title: "Link monitors",
    description:
      "Connect monitors so each component status updates automatically.",
    icon: Link2,
  },
  {
    title: "Set up subscriptions",
    description:
      "Choose how visitors follow updates: email, webhook, Slack, or feeds.",
    icon: Users,
  },
  {
    title: "Customize branding",
    description:
      "Add your logo, favicon, status colors, and custom domain in Settings.",
    icon: Palette,
  },
  {
    title: "Publish the page",
    description:
      "Needs at least one public component. Draft pages are not visible to visitors.",
    icon: Rocket,
  },
  {
    title: "Communicate incidents",
    description:
      "Post updates about outages and scheduled maintenance once the page is live.",
    icon: AlertCircle,
  },
];
