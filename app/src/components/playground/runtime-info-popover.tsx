"use client";

import React from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TestType } from "@/db/schema";

interface AllowedLibrary {
  name: string;
  description: string;
}

interface RuntimeInfo {
  title: string;
  description: string;
  libraries: AllowedLibrary[];
  footer: string;
}

const PLAYWRIGHT_TYPES: TestType[] = [
  "browser",
  "api",
  "database",
  "custom",
];

const PLAYWRIGHT_LIBRARIES: AllowedLibrary[] = [
  {
    name: "@playwright/test",
    description: "Testing framework with built-in assertions",
  },
  { name: "axios", description: "Promise-based HTTP client" },
  { name: "zod", description: "TypeScript-first schema validation" },
  { name: "mssql", description: "Microsoft SQL Server client" },
  { name: "mysql2", description: "MySQL client with Promise support" },
  { name: "pg", description: "PostgreSQL client" },
  { name: "mongodb", description: "Official MongoDB driver" },
  { name: "oracledb", description: "Oracle Database client" },
  { name: "date-fns", description: "Modular date utility library" },
  { name: "@faker-js/faker", description: "Modern faker alternative" },
];

const PERFORMANCE_LIBRARIES: AllowedLibrary[] = [
  { name: "k6", description: "Core runtime for k6 performance tests" },
  { name: "k6/http", description: "HTTP client for load testing" },
  { name: "k6/metrics", description: "Custom metrics and aggregations" },
  { name: "k6/crypto", description: "Cryptographic utilities" },
  { name: "k6/data", description: "Data handling helpers" },
  { name: "k6/encoding", description: "Encoding and decoding utilities" },
  { name: "k6/html", description: "HTML parsing helpers" },
  { name: "k6/ws", description: "WebSocket support" },
  { name: "k6/grpc", description: "gRPC client support" },
  { name: "k6/net/grpc", description: "Low-level gRPC networking" },
  { name: "k6/browser", description: "Experimental browser automation" },
  {
    name: "k6/experimental/redis",
    description: "k6 Redis client (experimental)",
  },
  {
    name: "k6/experimental/tracing",
    description: "Distributed tracing instrumentation",
  },
];

const PLAYWRIGHT_RUNTIME: RuntimeInfo = {
  title: "Playwright Runtime Libraries",
  description: "Pre-approved modules available to Playwright-based tests.",
  libraries: PLAYWRIGHT_LIBRARIES,
  footer:
    "Scripts are validated for security. Node.js core modules are blocked and test execution has a 2-minute timeout.",
};

const PERFORMANCE_RUNTIME: RuntimeInfo = {
  title: "k6 Runtime Modules",
  description:
    "These ES modules are available when running k6 performance tests.",
  libraries: PERFORMANCE_LIBRARIES,
  footer:
    "Scripts run inside the k6 engine. Only k6 modules listed above are supported and Node.js packages are blocked.",
};

const getRuntimeInfo = (testType: TestType | undefined): RuntimeInfo => {
  if (!testType) {
    return PLAYWRIGHT_RUNTIME;
  }

  if (testType === "performance") {
    return PERFORMANCE_RUNTIME;
  }

  if (PLAYWRIGHT_TYPES.includes(testType)) {
    return PLAYWRIGHT_RUNTIME;
  }

  return PLAYWRIGHT_RUNTIME;
};

interface RuntimeInfoPopoverProps {
  testType?: TestType;
}

const RuntimeInfoPopover: React.FC<RuntimeInfoPopoverProps> = ({
  testType,
}) => {
  const runtimeInfo = getRuntimeInfo(testType);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Available runtime libraries</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium">{runtimeInfo.title}</h4>
            <p className="text-sm text-muted-foreground">
              {runtimeInfo.description}
            </p>
          </div>

          <ScrollArea className="h-60">
            <div className="space-y-2">
              {runtimeInfo.libraries.map((lib) => (
                <div key={lib.name} className="text-sm">
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {lib.name}
                  </code>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lib.description}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="pt-2 border-t text-xs text-muted-foreground">
            {runtimeInfo.footer}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default RuntimeInfoPopover;
