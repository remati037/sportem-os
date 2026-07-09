import { z } from "zod";

/*
 * Labava UUID validacija — prihvata i standardne UUID-jeve (gen_random_uuid, RFC v4)
 * i fiksne seed UUID-jeve (npr. statusi „00000000-0000-0000-0000-000000000a01").
 *
 * Zod v4 `.uuid()` validira RFC verziju/varijantu i ODBIJA seed ID-jeve (verzija/varijanta = 0),
 * iako ih Postgres `uuid` tip uredno prihvata i koriste se kao FK širom baze. Zbog toga se
 * ovde koristi format 8-4-4-4-12 heks bez provere verzije/varijante.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuid = (msg: string) => z.string().regex(UUID_RE, msg);

/** Da li je string u UUID formatu (labavo — v. gore). */
export const isUuid = (v: string) => UUID_RE.test(v);
