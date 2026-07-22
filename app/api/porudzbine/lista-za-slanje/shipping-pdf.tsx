import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { rsd, num, datumVreme } from "@/lib/format";
import type { ShippingOrder } from "@/db/orders";

/*
 * PDF „lista za slanje" (Korak 1.5). Geist TTF (regular+bold) se registruje sa
 * diska — bez toga @react-pdf koristi Helvetica koja NEMA srpske dijakritike
 * (č/ć/đ). Fajlovi se trace-uju u bundle preko outputFileTracingIncludes
 * (next.config.ts). Kompaktan A4 layout: više porudžbina po strani.
 */

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(dir, "Geist-Regular.ttf") },
      { src: path.join(dir, "Geist-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Ne prelamaj reči na crtici (SKU, brojevi) — čitljivije na papiru.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 9,
    color: "#1A1A1A",
    paddingVertical: 28,
    paddingHorizontal: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1B7A45",
  },
  title: { fontSize: 14, fontWeight: "bold", color: "#1B7A45" },
  meta: { fontSize: 8, color: "#6B7280" },
  block: {
    borderWidth: 1,
    borderColor: "#D8DEDA",
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  blockHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  orderNo: { fontSize: 11, fontWeight: "bold" },
  name: { fontSize: 10, fontWeight: "bold" },
  phone: { fontSize: 9, color: "#374151" },
  address: { fontSize: 9, color: "#374151", marginBottom: 4 },
  itemsHead: { fontSize: 7, color: "#6B7280", marginBottom: 2 },
  itemRow: { flexDirection: "row", marginBottom: 1 },
  itemQty: { width: 26, fontWeight: "bold" },
  itemName: { flex: 1 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 5,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#EEF1EF",
  },
  cod: { fontSize: 11, fontWeight: "bold", color: "#1B7A45" },
  codNone: { fontSize: 9, color: "#6B7280" },
  packages: { fontSize: 9, color: "#374151" },
  note: { fontSize: 8, color: "#92400E", marginTop: 3 },
  pageNo: {
    position: "absolute",
    bottom: 14,
    right: 32,
    fontSize: 7,
    color: "#9CA3AF",
  },
});

function addressLine(o: ShippingOrder): string {
  const parts = [
    o.ship_address,
    [o.ship_postal_code, o.ship_city].filter(Boolean).join(" "),
  ].filter((p) => p && p.trim());
  return parts.join(", ") || "—";
}

export function ShippingListDocument({
  orders,
  printedAtIso,
}: {
  orders: ShippingOrder[];
  printedAtIso: string;
}) {
  registerFonts();

  return (
    <Document title="Lista za slanje" author="Sportem">
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.title}>Lista za slanje</Text>
          <Text style={styles.meta}>
            {orders.length} porudžbina · štampano {datumVreme(printedAtIso)}
          </Text>
        </View>

        {orders.map((o) => {
          // Otkupnina = roba + naplaćena poštarina (cod_amount je nepouzdan — NULL na
          // backfill/ne-COD; usklađeno sa finansijama).
          const otkup = (o.goods_total ?? 0) + (o.shipping_charged ?? 0);
          const showCod = o.delivery_method === "xexpress" && otkup > 0;
          return (
            <View key={o.id} style={styles.block} wrap={false}>
              <View style={styles.blockHead}>
                <Text style={styles.orderNo}>
                  {o.woo_order_id != null ? `#${o.woo_order_id}` : "—"}
                </Text>
                <Text style={styles.phone}>{o.ship_phone ?? "—"}</Text>
              </View>
              <Text style={styles.name}>{o.ship_name ?? "—"}</Text>
              <Text style={styles.address}>{addressLine(o)}</Text>

              <Text style={styles.itemsHead}>ARTIKLI</Text>
              {o.items.length > 0 ? (
                o.items.map((it, i) => (
                  <View style={styles.itemRow} key={`${o.id}-${i}`}>
                    <Text style={styles.itemQty}>{num(it.quantity)}×</Text>
                    <Text style={styles.itemName}>
                      {it.product_name}
                      {it.sku ? `  (${it.sku})` : ""}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.itemName}>—</Text>
              )}

              <View style={styles.footer}>
                <Text style={styles.packages}>
                  Paketa: {o.package_count != null ? num(o.package_count) : "—"}
                  {"   ·   "}
                  Težina: {o.weight_grams != null ? `${num(o.weight_grams)} g` : "—"}
                </Text>
                {showCod ? (
                  <Text style={styles.cod}>Otkupnina: {rsd(otkup)}</Text>
                ) : (
                  <Text style={styles.codNone}>
                    {o.delivery_method === "licno" ? "Lično" : "Bez otkupnine"}
                  </Text>
                )}
              </View>

              {o.ship_note ? <Text style={styles.note}>Napomena: {o.ship_note}</Text> : null}
            </View>
          );
        })}

        <Text
          style={styles.pageNo}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
