"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTableColumnHeader } from "./data-table-column-header"
import { Test } from "./schema"
import { ExternalLink } from "lucide-react"
import { types } from "../tests/data";

export const createJobTestColumns = (): ColumnDef<Test>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Test ID" className="ml-3" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string
      return (
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
            {id.substring(0, 8)}...
          </code>
        </div>
      )
    },
    enableSorting: true,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const name = row.getValue("name") as string
      return (
        <div className="flex items-center gap-2">
          <span className="max-w-[150px] truncate" title={name}>
            {name}
          </span>
  
        </div>
      )
    },
    enableSorting: true,
    enableHiding: false,
  },
  {
    accessorKey: "description",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => {
      const description = row.getValue("description") as string
      return (
        <div className="flex items-center gap-2">
          <span className="max-w-[150px] truncate" title={description || "No description provided"}>
            {description || "No description provided"}
          </span>
        </div>
      )
    },
    enableSorting: true,
  },
  {
    accessorKey: "type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => {
      const typeValue = row.getValue("type") as string;
      const type = types.find((t) => t.value === typeValue);
      if (!type) return null;
      const Icon = type.icon;
      return (
        <div className="flex items-center w-[120px]">
          {Icon && <Icon className={`mr-2 h-4 w-4 ${type.color}`} />}
          <span>{type.label}</span>
        </div>
      );
    },
    enableSorting: true,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: "tags",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Tags" />
    ),
    cell: ({ row }) => {
      const tags = row.getValue("tags") as Test["tags"]
      
      if (!tags || tags.length === 0) {
        return (
          <div className="text-muted-foreground text-sm">
            No tags
          </div>
        )
      }

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 min-h-[24px]">
                {tags.slice(0, 2).map((tag) => (
                  <Badge 
                    key={tag.id} 
                    variant="secondary" 
                    className="text-xs whitespace-nowrap flex-shrink-0"
                    style={tag.color ? { 
                      backgroundColor: tag.color + "20", 
                      color: tag.color,
                      borderColor: tag.color + "40"
                    } : {}}
                  >
                    {tag.name}
                  </Badge>
                ))}
                {tags.length > 2 && (
                  <Badge variant="secondary" className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    +{tags.length - 2}
                  </Badge>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[600px]">
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge 
                    key={tag.id} 
                    variant="secondary" 
                    className="text-xs"
                    style={tag.color ? { 
                      backgroundColor: tag.color + "20", 
                      color: tag.color,
                      borderColor: tag.color + "40"
                    } : {}}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    enableSorting: true,
    filterFn: (row, id, value) => {
      const tags = row.getValue(id) as Test["tags"]
      if (!tags || tags.length === 0) return false
      return tags.some(tag => value.includes(tag.name))
    },
  },


  {
    accessorKey: "Open",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="" />
    ),
    cell: () => {
    
      return (
        <div className="max-w-[30px] truncate">
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </div>

      )
    },
    enableSorting: false,
  },


 
] 