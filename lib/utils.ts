import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Spaja className vrednosti i razrešava Tailwind konflikte (shadcn konvencija). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
