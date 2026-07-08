import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <div className="eyebrow">Interni operativni sistem</div>
        <h1 className="text-ink text-[1.75rem] font-bold">Sportem</h1>
        <p className="text-ink-soft text-[0.9375rem]">
          Porudžbine, katalog, finansije i dashboard na jednom mestu.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/stil">Dizajn sistem</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/stil/komponente">Komponente</Link>
        </Button>
      </div>
    </main>
  );
}
