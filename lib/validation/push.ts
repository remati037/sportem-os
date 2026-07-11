import { z } from "zod";

/*
 * Zod šema za Web Push subscription (Korak 1.9). Oblik koji vraća
 * `PushManager.subscribe()` → `subscription.toJSON()`: endpoint + p256dh/auth
 * ključevi. Čuva se kao jsonb u `push_subscriptions.subscription`.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url("Neispravan push endpoint."),
  keys: z.object({
    p256dh: z.string().min(1, "Nedostaje p256dh ključ."),
    auth: z.string().min(1, "Nedostaje auth ključ."),
  }),
  // Woo/Chrome umeju da pošalju i expirationTime — prihvatamo, ne koristimo.
  expirationTime: z.number().nullable().optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Telo /api/push/unsubscribe — samo endpoint identifikuje uređaj. */
export const unsubscribeSchema = z.object({
  endpoint: z.string().url("Neispravan push endpoint."),
});
