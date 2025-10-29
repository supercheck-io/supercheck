"use client";

import React from 'react';
import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const allowedLibraries = [
  { name: '@playwright/test', description: 'Testing framework with built-in assertions' },
  { name: 'axios', description: 'Promise-based HTTP client' },
  { name: 'zod', description: 'TypeScript-first schema validation' },
  { name: 'mssql', description: 'Microsoft SQL Server client' },
  { name: 'mysql2', description: 'MySQL client with Promise support' },
  { name: 'pg', description: 'PostgreSQL client' },
  { name: 'mongodb', description: 'Official MongoDB driver' },
  { name: 'oracledb', description: 'Oracle Database client' },
  { name: 'date-fns', description: 'Modular date utility library' },
  { name: '@faker-js/faker', description: 'Modern faker alternative' }
];

const RuntimeInfoPopover: React.FC = () => {
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
            <h4 className="font-medium">Available Libraries</h4>
            <p className="text-sm text-muted-foreground">
              Pre-approved libraries for your test scripts
            </p>
          </div>
          
          <ScrollArea className="h-60">
            <div className="space-y-2">
              {allowedLibraries.map((lib) => (
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
            Scripts are validated for security and other modules are blocked. Test execution has a 2-minute timeout.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default RuntimeInfoPopover;