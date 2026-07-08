import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/patterns/loading";

/* Group-level loading UI za (app) segment — AppShell (sidebar/bottom-nav)
   ostaje montiran, samo sadržaj pokazuje skeleton dok server renderuje. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-48" />
      </div>
      <TableSkeleton />
    </main>
  );
}
