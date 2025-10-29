import React from "react";
import { Info, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const accessLevels = [
  {
    role: "project_viewer",
    label: "Project Viewer",
    description: "Read-only access to all organization projects. No project selection required.",
    color: "text-blue-500"
  },
  {
    role: "project_editor", 
    label: "Project Editor",
    description: "Create and edit tests, jobs, monitors in selected projects only. Project selection required.",
    color: "text-green-500"
  },
  {
    role: "project_admin",
    label: "Project Admin", 
    description: "Full admin access to selected projects only. Can manage project settings. Project selection required.",
    color: "text-orange-500"
  },
  {
    role: "org_admin",
    label: "Organization Admin",
    description: "Can manage organization settings and invite members. Has access to all projects.",
    color: "text-red-500"
  }
];

export function MemberAccessInfoPopover() {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-muted">
              <Info className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Access level information</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-96 mt-2" side="bottom" sideOffset={8}>
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">Member Access Levels</h4>
          </div>
          <div className="space-y-3">
            {accessLevels.map((level) => (
              <div key={level.role} className="flex items-start space-x-3 p-2 rounded-md bg-muted/30">
                <div className={`h-2 w-2 rounded-full ${level.color} bg-current mt-2 flex-shrink-0`} />
                <div>
                  <p className="font-medium text-sm">{level.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{level.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}