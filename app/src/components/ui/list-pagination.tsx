import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pageSizeOptions } from "@/hooks/use-fit-page-size";

interface ListPaginationProps {
  total: number;
  itemName?: string;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** "incidents (from the latest 500)" -> "incident (from the latest 500)", "saved queries" -> "saved query". */
export function singularize(itemName: string): string {
  if (/ies(?=\s*\(|$)/.test(itemName)) return itemName.replace(/ies(?=\s*\(|$)/, "y");
  return itemName.replace(/s(?=\s*\(|$)/, "");
}

/** Shared table footer (see DESIGN.md): total, rows-per-page menu and page controls. */
export function ListPagination({
  total,
  itemName = "items",
  pageIndex,
  pageSize,
  pageCount,
  onPageChange,
  onPageSizeChange,
}: ListPaginationProps) {
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2 px-2">
      <div className="flex-1 text-sm text-muted-foreground">
        Total {total} {total === 1 ? singularize(itemName) : itemName}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 lg:gap-x-8">
        <div className="flex items-center space-x-2">
          <p className="text-sm">Rows per page</p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions(pageSize).map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[100px] items-center justify-center text-sm">
          Page {pageIndex + 1} of {Math.max(pageCount, 1)}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => onPageChange(0)}
            disabled={!canPrevious}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => onPageChange(pageIndex - 1)}
            disabled={!canPrevious}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => onPageChange(pageIndex + 1)}
            disabled={!canNext}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => onPageChange(Math.max(0, pageCount - 1))}
            disabled={!canNext}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
