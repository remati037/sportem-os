"use client";

import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* „⋮" dropdown akcije za red tabele / mobilnu karticu (docs/Sportem-Dizajn-Sistem.md).
   Trigger je ghost „icon-sm" dugme sa vertikalnim tačkicama; sadržaj su DropdownMenuItem-i
   koje prosleđuje pozivalac (fleksibilno — npr. „Izmeni" otvara Dialog kroz kontrolisani open). */
export function RowActions({
  children,
  align = "end",
  label = "Akcije",
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
