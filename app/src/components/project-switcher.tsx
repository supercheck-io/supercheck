"use client"

import * as React from "react"
import { ChevronsUpDown, Search, Loader2 } from "lucide-react"
import { CheckIcon } from "@/components/logo/supercheck-logo"
import { useProjectContext } from "@/hooks/use-project-context"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { useRef, useEffect } from "react"

export function ProjectSwitcher() {
  const { isMobile } = useSidebar()
  const { 
    currentProject, 
    projects, 
    loading, 
    switchProject 
  } = useProjectContext()
  
  const [searchQuery, setSearchQuery] = React.useState("")
  const [isOpen, setIsOpen] = React.useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Filter and sort projects based on search query
  const filteredProjects = (projects || [])
    .filter(project =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("")
    }
  }, [isOpen])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      // Focus the search input after the dropdown is rendered
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setSearchQuery(e.target.value)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false)
    } else if (e.key === "Enter") {
      e.preventDefault()
      // Select the first filtered project if available
      if (filteredProjects.length > 0) {
        handleProjectSelect(filteredProjects[0])
      }
    }
    // Prevent dropdown from closing on other key presses
    e.stopPropagation()
  }

  const handleProjectSelect = async (project: { id: string; name: string }) => {
    const success = await switchProject(project.id)
    if (success) {
      setIsOpen(false)
    }
  }

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <div className="text-foreground flex items-center justify-center">
              <CheckIcon className="size-7" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Supercheck</span>
              <div className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="truncate text-xs">Loading...</span>
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild className="focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0">
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:ml-2.5 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            >
              <div className="text-foreground flex items-center justify-center">
                <CheckIcon className="size-7" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Supercheck</span>
                <span className="truncate text-xs">{currentProject?.name || "No project"}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Projects
            </DropdownMenuLabel>
            
            {/* Search Bar */}
            <div className="px-2 py-1.5" onMouseDown={(e) => e.stopPropagation()}>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  className="h-8 pl-8 text-xs"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            {/* Project List */}
            <div className="max-h-48 overflow-y-auto">
              {filteredProjects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  className="gap-2 p-2 flex items-center justify-between"
                  onClick={() => handleProjectSelect(project)}
                >
                  <div className="flex items-center justify-between flex-1">
                    <span className="font-medium truncate">{project.name}</span>
                    {currentProject?.id === project.id && (
                      <div className="h-2.5 w-2.5 rounded-full bg-primary flex-shrink-0 ml-2" />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
              {filteredProjects.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
                  No projects found
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
