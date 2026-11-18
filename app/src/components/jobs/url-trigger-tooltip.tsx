"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { InfoPopover } from "@/components/ui/info-popover";
import { 
  Copy, 
  Github,
  Gitlab,
  Code,
  Workflow
} from "lucide-react";
import { toast } from "sonner";

interface ApiDocsTooltipProps {
  jobId: string;
}

export function UrlTriggerTooltip({ jobId }: ApiDocsTooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerUrl = `${(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || window.location.origin).replace(/\/+$/, "")}/api/jobs/${jobId}/trigger`;
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <InfoPopover
      label="About remote trigger commands"
      title="Remote trigger commands"
      icon={Workflow}
      open={open}
      onOpenChange={setOpen}
      contentClassName="w-[500px]"
    >
        <div className="space-y-4">
          <div className="space-y-3">
            

            <Separator />

           {/* curl example */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                <Code className="h-3 w-3 text-primary" />
                cURL</Label>
              <div className="relative">
                <pre className="bg-muted p-2 pr-8 rounded text-xs overflow-x-auto text-wrap">
                  <code>{`curl -X POST "${triggerUrl}" \\
      -H "Authorization: Bearer YOUR_API_KEY"  \\
      -H "Content-Type: application/json"`}</code>
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0"
                  onClick={() => copyToClipboard(
                    `curl -X POST "${triggerUrl}" \\\n      -H "Authorization: Bearer YOUR_API_KEY"  \\\n      -H "Content-Type: application/json"`,
                    "Curl example"
                  )}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* github actions example */}
            <div className="space-y-2">
              <Label className="text-xs font-medium"> 
                <Github className="h-3 w-3 text-primary" />
                GitHub Actions</Label>
              <div className="relative">
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto text-wrap">
                  <code>{`- name: Trigger Test Job
  run: |
    curl -X POST "${triggerUrl}" \\
      -H "Authorization: Bearer YOUR_API_KEY"  \\
      -H "Content-Type: application/json"`}</code>
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0"
                  onClick={() => copyToClipboard(
                    `- name: Trigger Test Job\n  run: |\n    curl -X POST "${triggerUrl}" \\\n      -H "Authorization: Bearer YOUR_API_KEY"  \\\n      -H "Content-Type: application/json"`,
                    "GitHub Actions example"
                  )}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* gitlab pipeline example */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">       <Gitlab className="h-3 w-3 text-primary" />Gitlab Pipeline</Label>
              <div className="relative">
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto text-wrap">
                  <code>{`- trigger_test_job:
  stage: test
  script:
    - curl -X POST "${triggerUrl}" \\
        -H "Authorization: Bearer YOUR_API_KEY" \\
        -H "Content-Type: application/json"
`}</code>
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0"
                  onClick={() => copyToClipboard(
                    `- trigger_test_job:
  stage: test
  script:
    - curl -X POST "${triggerUrl}" \\
        -H "Authorization: Bearer YOUR_API_KEY" \\
        -H "Content-Type: application/json"`,
                    "GitLab Pipeline example"
                  )}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            
          </div>
        </div>
    </InfoPopover>
  );
} 