import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/* Loading skeleton preseti (docs/Sportem-Dizajn-Sistem.md, sekcija 8).
   Standardna loading stanja koja ekrani importuju umesto praznog spinnera. */

function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="border-border bg-surface shadow-soft overflow-hidden rounded-lg border">
      <div className="bg-surface-2 border-border flex gap-4 border-b px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-4 w-1/3" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "border-border bg-surface shadow-soft space-y-3 rounded-lg border p-5",
        className,
      )}
    >
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className="max-w-md space-y-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
}

export { TableSkeleton, CardSkeleton, StatCardSkeleton, FormSkeleton };
