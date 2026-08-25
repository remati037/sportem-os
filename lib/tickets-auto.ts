import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createAdminClient } from "@/lib/supabase/admin";
import { datum } from "@/lib/format";
import { TICKET_DEFAULTS, TICKET_POSITION_STEP, TICKET_SOURCE } from "@/lib/tickets";

/*
 * Automatski tiketi (Korak T6).
 *
 * Jedini dogovoreni auto-tiket je „rizičan kupac": nova porudžbina kupca koji je
 * ranije otkazao/vratio → tiket „Pozovi i potvrdi porudžbinu #{woo}". Ništa
 * drugo se ne pravi automatski (zaključana odluka iz plana).
 *
 * Sve je BEST-EFFORT — funkcija nikad ne baca (Sentry + `false`), pa webhook ne
 * može da padne zbog tiketa; isti obrazac kao `syncOrderStock` i `pushWooStatus`.
 *
 * IDEMPOTENTNO: parcijalni unique indeks `tickets (order_id) where
 * source = 'auto_risky_customer'` je pravi garant — Woo retry vraća 23505, što
 * se tiho guta. Pre-provera postoji samo da ne trošimo `ticket_code_seq`.
 *
 * Čita/piše kroz SERVICE-ROLE klijent: webhook nema sesiju, a RLS na ticket
 * tabelama pušta samo Admina i Menadžera. Ne dira porudžbine, `order_items`
 * (zamrznute cene), finansije ni tok statusa.
 */

/** Prethodna otkazana/vraćena porudžbina istog kupca (opis tiketa). */
export type PriorCancellation = {
  woo_order_id: number | null;
  ordered_at: string | null;
};

export type RiskyTicketInput = {
  /** Interni UUID nove porudžbine. */
  orderId: string;
  /** Woo broj (naslov i link). */
  wooOrderId: number;
  /** Ime primaoca — samo za tekst opisa. */
  customerName?: string | null;
  /** `customers.id` nove porudžbine (veza „kupac" na tiketu). */
  customerId?: string | null;
  /** Istorija otkazivanja tog kupca (novije prvo). */
  prior: PriorCancellation[];
};

type Admin = ReturnType<typeof createAdminClient>;

/** Prva kolona board-a po redosledu prikaza (`column_id` je NOT NULL). */
async function firstColumnId(supabase: Admin): Promise<string | null> {
  const { data } = await supabase
    .from("ticket_columns")
    .select("id")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Config red po imenu (prioritet „Visok" / tag „Poziv"). Ako ga Admin obriše ili
 * preimenuje → `null`, i tiket se pravi BEZ tog polja (pravilo iz plana).
 * Poređenje je case-insensitive `ilike` bez džokera = tačno ime.
 */
async function configIdByName(
  supabase: Admin,
  table: "ticket_priorities" | "ticket_tags",
  name: string,
): Promise<string | null> {
  let query = supabase.from(table).select("id").ilike("name", name);
  // Arhiviran tag se ne kači na nov tiket (ne nudi se ni u dijalogu).
  if (table === "ticket_tags") query = query.is("archived_at", null);

  const { data } = await query.limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Dno kolone: `max(position) + 1000` (isti obrazac kao `nextPositionInColumn`). */
async function bottomPosition(supabase: Admin, columnId: string): Promise<number> {
  const { data } = await supabase
    .from("tickets")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number((data as { position: number } | null)?.position ?? 0) + TICKET_POSITION_STEP;
}

/** Opis tiketa: zašto je kupac rizičan + spisak ranijih otkazivanja. */
function buildDescription(input: RiskyTicketInput): string {
  const who = input.customerName?.trim();
  const lines = [
    `Kupac${who ? ` ${who}` : ""} je ranije otkazao ili vratio ${input.prior.length} porudžbina.`,
    "Pozovi ga i potvrdi porudžbinu pre slanja.",
  ];

  const history = input.prior
    .slice(0, 10)
    .map((p) => {
      const broj = p.woo_order_id != null ? `#${p.woo_order_id}` : "porudžbina";
      return p.ordered_at ? `${broj} (${datum(p.ordered_at)})` : broj;
    })
    .join(", ");
  if (history) lines.push(`Ranije otkazano/vraćeno: ${history}`);
  if (input.prior.length > 10) lines.push(`… i još ${input.prior.length - 10}.`);

  return lines.join("\n");
}

/**
 * Napravi (ili preskoči) auto-tiket „Pozovi i potvrdi porudžbinu #{woo}".
 * Tiket je NEDODELJEN, prioritet „Visok", tag „Poziv", prva kolona, vezan na
 * porudžbinu i kupca. Vraća `true` samo ako je tiket stvarno napravljen.
 */
export async function createRiskyCustomerTicket(input: RiskyTicketInput): Promise<boolean> {
  try {
    if (input.prior.length === 0) return false;
    const supabase = createAdminClient();

    // Pre-provera (idempotentnost je zagarantovana unique indeksom ispod).
    const { data: existing } = await supabase
      .from("tickets")
      .select("id")
      .eq("order_id", input.orderId)
      .eq("source", TICKET_SOURCE.autoRiskyCustomer)
      .limit(1)
      .maybeSingle();
    if (existing) return false;

    const columnId = await firstColumnId(supabase);
    // Bez ijedne kolone tiket nema gde da stane — tiho odustajemo.
    if (!columnId) return false;

    const [priorityId, tagId, position] = await Promise.all([
      configIdByName(supabase, "ticket_priorities", TICKET_DEFAULTS.priorities.high),
      configIdByName(supabase, "ticket_tags", TICKET_DEFAULTS.tags.call),
      bottomPosition(supabase, columnId),
    ]);

    const { data: created, error } = await supabase
      .from("tickets")
      .insert({
        title: `Pozovi i potvrdi porudžbinu #${input.wooOrderId}`,
        description: buildDescription(input),
        column_id: columnId,
        priority_id: priorityId,
        position,
        order_id: input.orderId,
        customer_id: input.customerId ?? null,
        source: TICKET_SOURCE.autoRiskyCustomer,
        created_by: null, // sistemski tiket — istorija ga prikazuje kao „Sistem"
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = drugi prijem istog webhooka je već napravio tiket.
      if ((error as { code?: string }).code === "23505") return false;
      throw new Error(error.message);
    }

    const ticketId = (created as { id: string }).id;

    // Tag i audit red su dopune — greška ovde ne poništava napravljen tiket.
    if (tagId) {
      await supabase.from("ticket_tag_links").insert({ ticket_id: ticketId, tag_id: tagId });
    }
    await supabase.from("ticket_events").insert({
      ticket_id: ticketId,
      actor_id: null,
      kind: "created",
      to_text: `Automatski: rizičan kupac (#${input.wooOrderId})`,
    });

    return true;
  } catch (err) {
    Sentry.captureException(err);
    return false;
  }
}
