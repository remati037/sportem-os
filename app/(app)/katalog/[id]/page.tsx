import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageIcon, Package, Plus } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getCategories, getProductWithVariants } from "@/db/catalog";
import { catalogImageUrl } from "@/lib/image-url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";

import { ProductActions } from "../product-actions";
import { VariantFormDialog } from "../variant-form";
import { VariantsTable } from "../variants-table";

export const dynamic = "force-dynamic";

export default async function ProizvodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager", "logistics");
  const role = profile.role;
  const isAdmin = role === "admin";
  const canSeeFinance = role === "admin" || role === "manager";

  const [product, categories] = await Promise.all([
    getProductWithVariants(id, role),
    getCategories(),
  ]);
  if (!product) notFound();

  const imageUrl = catalogImageUrl(product.image);
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <Link
        href="/katalog"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na katalog
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4">
          <div className="border-border bg-surface-2 relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={product.name}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <ImageIcon className="text-ink-faint size-6" />
            )}
          </div>
          <div className="space-y-1.5">
            <div className="eyebrow">Proizvod</div>
            <div className="flex items-center gap-2">
              <h1 className="text-ink text-xl font-bold">{product.name}</h1>
              {product.archived_at ? <Badge variant="warning">Arhiviran</Badge> : null}
            </div>
            <div className="text-ink-soft flex items-center gap-2 text-sm">
              {product.brand ? <span>{product.brand}</span> : null}
              {product.category ? (
                <>
                  {product.brand ? <span className="text-ink-faint">·</span> : null}
                  <span>{product.category.name}</span>
                </>
              ) : null}
            </div>
            {product.description ? (
              <p className="text-ink-soft max-w-prose text-sm">{product.description}</p>
            ) : null}
          </div>
        </div>
        {isAdmin ? (
          <ProductActions
            product={{
              id: product.id,
              name: product.name,
              description: product.description,
              brand: product.brand,
              category_id: product.category_id,
              image: product.image,
              archived: product.archived_at != null,
            }}
            categories={categoryOptions}
          />
        ) : null}
      </div>

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-ink text-base font-semibold">Varijante</h2>
        {isAdmin ? (
          <VariantFormDialog
            mode="create"
            productId={product.id}
            trigger={
              <Button size="sm">
                <Plus /> Dodaj varijantu
              </Button>
            }
          />
        ) : null}
      </div>

      {product.variants.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Nema varijanti"
          description={
            isAdmin
              ? "Dodajte bar jednu varijantu (SKU, cene, stanje)."
              : "Ovaj proizvod još nema varijanti."
          }
        />
      ) : (
        <VariantsTable
          productId={product.id}
          variants={product.variants}
          canSeeFinance={canSeeFinance}
          isAdmin={isAdmin}
        />
      )}
    </main>
  );
}
