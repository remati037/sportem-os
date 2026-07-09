import Link from "next/link";
import { FileUp, Plus, Tags } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getCatalog, getCategories } from "@/db/catalog";
import { Button } from "@/components/ui/button";

import { CatalogTable } from "./catalog-table";
import { CategoryDialog } from "./category-dialog";
import { ProductFormDialog } from "./product-form";

export const dynamic = "force-dynamic";

export default async function KatalogPage() {
  const { profile } = await requireRole("admin", "manager", "logistics");
  const role = profile.role;
  const isAdmin = role === "admin";

  const [products, categories] = await Promise.all([getCatalog({ role }), getCategories()]);
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="eyebrow">Inventar</div>
          <h1 className="text-ink text-xl font-bold">Katalog</h1>
          <p className="text-ink-soft text-sm">Proizvodi, varijante, cene i stanje.</p>
        </div>
        {isAdmin ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button variant="ghost" asChild>
              <Link href="/katalog/uvoz">
                <FileUp /> Uvoz iz Sheets-a
              </Link>
            </Button>
            <CategoryDialog
              categories={categoryOptions}
              trigger={
                <Button variant="ghost">
                  <Tags /> Kategorije
                </Button>
              }
            />
            <ProductFormDialog
              mode="create"
              categories={categoryOptions}
              trigger={
                <Button>
                  <Plus /> Dodaj proizvod
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      <CatalogTable products={products} role={role} categories={categoryOptions} />
    </main>
  );
}
