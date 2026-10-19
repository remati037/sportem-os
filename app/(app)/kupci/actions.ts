"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { firstZodError } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { chunked } from "@/lib/supabase/paginate";
import {
  addCustomerNoteSchema,
  customerNoteIdSchema,
  editCustomerNoteSchema,
  setCustomerFlagsSchema,
} from "@/lib/validation/customers";
import { customerCandidateKeys, findCustomerGroup } from "@/db/customers";

/*
 * Beleške i oznake kupca (Korak C3). Admin i Menadžer pišu oboje; belešku
 * menja i briše SAMO autor — server proverava, a RLS (`customer_notes_author_*`)
 * isto odbija tuđu. Klijent šalje samo repId; ključ grupe razrešava server.
 * Ništa ovde ne dira porudžbine, `order_items` ni finansije.
 */

export type CustomerActionState = {
  error: string | null;
  success?: string | null;
};

function revalidateCustomers() {
  revalidatePath("/kupci", "layout");
  revalidatePath("/porudzbine", "layout");
}

export async function addCustomerNote(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = addCustomerNoteSchema.safeParse({
    customer_id: formData.get("customer_id"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const group = await findCustomerGroup(parsed.data.customer_id);
  if (!group) return { error: "Kupac nije pronađen." };

  const supabase = await createClient();
  const { error } = await supabase.from("customer_notes").insert({
    customer_key: group.key,
    body: parsed.data.body,
    created_by: userId,
  });
  if (error) return { error: "Čuvanje beleške nije uspelo." };

  revalidateCustomers();
  return { error: null, success: "Beleška sačuvana." };
}

/** Beleška postoji i ulogovani korisnik je njen autor. */
async function requireNoteAuthor(id: string, userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_notes")
    .select("created_by")
    .eq("id", id)
    .maybeSingle();
  if (error) return "Beleška nije dostupna.";
  const row = data as { created_by: string | null } | null;
  if (!row) return "Beleška nije pronađena.";
  if (row.created_by !== userId) return "Možeš da menjaš samo svoje beleške.";
  return null;
}

export async function editCustomerNote(id: string, body: string): Promise<CustomerActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = editCustomerNoteSchema.safeParse({ id, body });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const denied = await requireNoteAuthor(parsed.data.id, userId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_notes")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.id);
  if (error) return { error: "Izmena beleške nije uspela." };

  revalidateCustomers();
  return { error: null, success: "Beleška izmenjena." };
}

export async function deleteCustomerNote(id: string): Promise<CustomerActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = customerNoteIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const denied = await requireNoteAuthor(parsed.data.id, userId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("customer_notes").delete().eq("id", parsed.data.id);
  if (error) return { error: "Brisanje beleške nije uspelo." };

  revalidateCustomers();
  return { error: null, success: "Beleška obrisana." };
}

/**
 * Zamena cele liste oznaka. Oznake se upisuju pod SVIM ključevima grupe
 * (telefoni, e-mailovi, `customers` redovi) — tako ih lista porudžbina nalazi
 * po ključevima same porudžbine, a spajanje grupa ništa ne gubi.
 */
export async function setCustomerFlags(
  customerId: string,
  flags: string[],
): Promise<CustomerActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = setCustomerFlagsSchema.safeParse({ customer_id: customerId, flags });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const group = await findCustomerGroup(parsed.data.customer_id);
  if (!group) return { error: "Kupac nije pronađen." };

  const keys = customerCandidateKeys(group);
  const wanted = [...new Set(parsed.data.flags)];
  const supabase = await createClient();

  for (const chunk of chunked(keys)) {
    const { error } = await supabase.from("customer_flags").delete().in("customer_key", chunk);
    if (error) return { error: "Čuvanje oznaka nije uspelo." };
  }

  const rows = keys.flatMap((customer_key) =>
    wanted.map((flag) => ({ customer_key, flag, created_by: userId })),
  );
  for (const chunk of chunked(rows, 500)) {
    const { error } = await supabase.from("customer_flags").insert(chunk);
    if (error) return { error: "Čuvanje oznaka nije uspelo." };
  }

  revalidateCustomers();
  return { error: null, success: wanted.length > 0 ? "Oznake sačuvane." : "Oznake uklonjene." };
}
