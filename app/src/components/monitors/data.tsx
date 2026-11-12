import {
  CheckCircle,
  Clock,
  Pause,
  RefreshCw,
  XCircle,
  LaptopMinimal,
  EthernetPort,
  ChevronsLeftRightEllipsis,
  ArrowLeftRight,
} from "lucide-react";
import { typeText } from "@/lib/type-tones";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";


export const monitorStatuses = [
  {
    value: "up",
    label: "Up",
    icon: CheckCircle,
    color: "text-success",
  },
  {
    value: "down",
    label: "Down",
    icon: XCircle,
    color: "text-failure",
  },
  {
    value: "pending",
    label: "Pending",
    icon: Clock,
    color: "text-warning",
  },
  {
    value: "paused",
    label: "Paused",
    icon: Pause,
    color: "text-muted-foreground",
  },
  {
    value: "maintenance",
    label: "Maintenance",
    icon: RefreshCw,
    color: "text-blue-500",
  },
  {
    value: "error",
    label: "Error",
    icon: XCircle,
    color: "text-orange-500",
  },
];

export const monitorTypes = [
  {
    label: "HTTP Monitor",
    value: "http_request",
    icon: ArrowLeftRight,
    color: typeText("monitor", "http_request"),
    description: "Check HTTP/S endpoints (availability, status, response time)",
  },
  {
    label: "Website Monitor",
    value: "website",
    icon: LaptopMinimal,
    color: typeText("monitor", "website"),
    description: "Monitor website availability and performance with optional SSL certificate checking",
  },
  {
    label: "Ping Monitor",
    value: "ping_host",
    icon: ChevronsLeftRightEllipsis,
    color: typeText("monitor", "ping_host"),
    description: "Check host reachability over TCP on ports 443 and 80",
  },
  {
    label: "Port Monitor",
    value: "port_check",
    icon: EthernetPort,
    color: typeText("monitor", "port_check"),
    description: "Check specific TCP or UDP port",
  },
  {
    label: "Synthetic Monitor",
    value: "synthetic_test",
    icon: PlaywrightLogo,
    color: typeText("monitor", "synthetic_test"),
    description: "Run Playwright tests on schedule to monitor critical user flows",
  },
];
