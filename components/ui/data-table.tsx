"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
};

/**
 * DataTable — canonical sortable/paginated table.
 * Handles loading, empty and row-hover states consistently.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  pageSize = 10,
  loading = false,
  initialSort,
  empty,
  onRowClick,
  className,
  tableClassName,
  pagination = true,
  compact = false,
}: {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  loading?: boolean;
  initialSort?: { id: string; dir: "asc" | "desc" };
  empty?: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode };
  onRowClick?: (row: T) => void;
  className?: string;
  tableClassName?: string;
  pagination?: boolean;
  compact?: boolean;
}) {
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null
  );
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return data;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [data, sort, columns]);

  const pages = pagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const pageRows = pagination ? sorted.slice(page * pageSize, (page + 1) * pageSize) : sorted;

  const visibleColumns = columns.filter((c) => {
    if (!c.hideBelow) return true;
    return true; // responsive hiding handled via className
  });

  if (loading) {
    return <LoadingState className={className} />;
  }

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={empty?.icon}
        title={empty?.title ?? "No data"}
        description={empty?.description}
        action={empty?.action}
        className={className}
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.hideBelow === "sm" && "hidden sm:table-cell",
                    col.hideBelow === "md" && "hidden md:table-cell",
                    col.hideBelow === "lg" && "hidden lg:table-cell",
                    col.className
                  )}
                >
                  {col.sortable && col.sortValue ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((prev) =>
                          prev?.id === col.id
                            ? prev.dir === "asc"
                              ? { id: col.id, dir: "desc" }
                              : null
                            : { id: col.id, dir: "asc" }
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                        col.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {col.header}
                      {sort?.id === col.id ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {visibleColumns.map((col) => (
                  <TableCell
                    key={col.id}
                    className={cn(
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.hideBelow === "sm" && "hidden sm:table-cell",
                      col.hideBelow === "md" && "hidden md:table-cell",
                      col.hideBelow === "lg" && "hidden lg:table-cell",
                      compact && "py-2",
                      col.className
                    )}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pagination && pages > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {sorted.length} results · page {page + 1} of {pages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-border px-2.5 py-1 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              className="rounded-md border border-border px-2.5 py-1 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}