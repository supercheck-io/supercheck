import * as React from "react";
import { CheckIcon, PlusCircle } from "lucide-react";
import { Column } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { getNotificationProviderConfig } from "./data";

interface DataTableProviderFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title?: string;
}

export function DataTableProviderFilter<TData, TValue>({
  column,
  title,
}: DataTableProviderFilterProps<TData, TValue>) {
  const selectedValues = new Set(column?.getFilterValue() as string[]);
  const facets = column?.getFacetedUniqueValues();

  // Get all unique providers from the facets
  const allProviders = React.useMemo(() => {
    if (!facets) return [];
    
    const providers = new Set<string>();
    facets.forEach((count, providerString) => {
      if (providerString) {
        const providerList = providerString
          .split(',')
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);
        
        providerList.forEach((provider: string) => {
          providers.add(provider);
        });
      }
    });
    
    return Array.from(providers).sort();
  }, [facets]);

  // Create options from unique providers
  const options = React.useMemo(() => {
    return allProviders.map(providerType => {
      const config = getNotificationProviderConfig(providerType);
      return {
        label: config.label,
        value: providerType,
        icon: config.icon,
        color: config.color,
      };
    });
  }, [allProviders]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle className="mr-2 h-4 w-4" />
          {title}
          {selectedValues?.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal lg:hidden"
              >
                {selectedValues.size}
              </Badge>
              <div className="hidden space-x-1 lg:flex">
                {selectedValues.size > 2 ? (
                  <Badge
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {selectedValues.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge
                        variant="secondary"
                        key={option.value}
                        className="rounded-sm px-1 font-normal flex items-center gap-1"
                      >
                        <option.icon className={`h-3 w-3 ${option.color}`} />
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No providers found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      if (isSelected) {
                        selectedValues.delete(option.value);
                      } else {
                        selectedValues.add(option.value);
                      }
                      const filterValues = Array.from(selectedValues);
                      column?.setFilterValue(
                        filterValues.length ? filterValues : undefined
                      );
                    }}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <CheckIcon className={cn("h-4 w-4")} />
                    </div>
                    <option.icon
                      className={cn(
                        "mr-2 h-4 w-4 flex-shrink-0",
                        option.color ?? "text-foreground"
                      )}
                    />
                    <span className="truncate flex-1">{option.label}</span>
                    {(() => {
                      // Calculate count for this provider from all facets
                      let count = 0;
                      facets?.forEach((facetCount, providerString) => {
                        if (providerString) {
                          const providerList = providerString
                            .split(',')
                            .map((p: string) => p.trim())
                            .filter((p: string) => p.length > 0);
                          
                          if (providerList.includes(option.value)) {
                            count += facetCount;
                          }
                        }
                      });
                      return count > 0 ? (
                        <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs flex-shrink-0">
                          {count}
                        </span>
                      ) : null;
                    })()}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column?.setFilterValue(undefined)}
                    className="justify-center text-center"
                  >
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
} 