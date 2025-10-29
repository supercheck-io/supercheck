"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Info, 
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
  const triggerUrl = `${process.env.NEXT_PUBLIC_BASE_URL || window.location.origin}/api/jobs/${jobId}/trigger`;
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Info className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[500px] p-0 bg-popover text-popover-foreground border shadow-xl">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
         <Workflow className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm">Remote trigger commands</h4>
          </div>
          
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
      </PopoverContent>
    </Popover>
  );
} 