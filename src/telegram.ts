/* =========================================================
   L'alerte au restaurant, par un bot Telegram.

   Une commande arrive : le bot écrit dans la conversation du
   restaurant (`restaurants.telegram_chat`) avec deux boutons,
   Accepter et Refuser. Le clic revient par le webhook, qui change
   le statut et réécrit le message pour que toute l'équipe voie
   qui a répondu.

   Sans TELEGRAM_TOKEN (en local), le message est écrit dans la
   console au lieu d'être envoyé.
   ========================================================= */

import { heureLocale } from './horaires';
import type { LigneCalculee } from './prix';

export type Alerte = {
  id: number;
  numero: number;
  nom: string;
  tel: string;
  mode: string;
  pour: number | null;
  lignes: LigneCalculee[];
  total: number;
};

const MODES: Record<string, string> = { emporter: 'À emporter', sur_place: 'Sur place' };

const html = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const euros = (c: number) => (c % 100 === 0 ? `${c / 100} €` : `${(c / 100).toFixed(2).replace('.', ',')} €`);
const telLu = (t: string) => t.replace(/(\d{2})(?=\d)/g, '$1 ');
const heure = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

export function heureSouhaitee(pour: number | null, maintenant: number, fuseau: string): string {
  if (pour === null) return 'dès que possible';
  const l = heureLocale(pour, fuseau);
  const auj = heureLocale(maintenant, fuseau).date;
  return (l.date === auj ? '' : 'demain ') + heure(l.minutes);
}

export function texteAlerte(c: Alerte, maintenant: number, fuseau: string): string {
  const lignes = c.lignes.flatMap((l) => [
    `<b>${l.qte} × ${html(l.nom)}</b>`,
    /* « Formule : Seul » n'apprend rien à la cuisine. */
    ...l.options.filter((o) => o.v !== 'Seul').map((o) => `   ${html(o.titre)} : ${html(o.v)}`),
  ]);
  return [
    `🔥 <b>NOUVELLE COMMANDE #${c.numero}</b>`,
    '',
    `Client : ${html(c.nom)}`,
    `Téléphone : ${telLu(c.tel)}`,
    '',
    ...lignes,
    '',
    `<b>Total : ${euros(c.total)}</b> (à payer au comptoir)`,
    `Mode : ${MODES[c.mode] ?? c.mode}`,
    `Heure souhaitée : ${heureSouhaitee(c.pour, maintenant, fuseau)}`,
  ].join('\n');
}

export const boutons = (id: number) => ({
  inline_keyboard: [[
    { text: '✅ Accepter', callback_data: `ok:${id}` },
    { text: '❌ Refuser', callback_data: `non:${id}` },
  ]],
});

/** Appelle l'API du bot. Renvoie le `result` de Telegram, ou null en local / en cas d'échec. */
export async function telegram(token: string | undefined, methode: string, corps: object): Promise<any> {
  if (!token) {
    console.log(`[telegram:${methode}]`, JSON.stringify(corps, null, 2));
    return null;
  }
  const r = await fetch(`https://api.telegram.org/bot${token}/${methode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null;
  if (!j?.ok) {
    console.error(`[telegram:${methode}] échec`, r.status, j?.description);
    return null;
  }
  return j.result;
}
