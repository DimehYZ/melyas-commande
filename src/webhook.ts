/* =========================================================
   POST /telegram : ce que Telegram nous renvoie.

   - un clic sur Accepter / Refuser → le statut change, le message
     est réécrit avec le nom de qui a répondu, les boutons partent ;
   - « /start » dans une conversation → le bot répond l'identifiant
     de la conversation, à recopier dans `restaurants.telegram_chat`.

   Telegram signe chaque appel avec l'en-tête
   X-Telegram-Bot-Api-Secret-Token, déclaré une fois avec setWebhook.
   Sans lui, n'importe qui pourrait accepter des commandes.
   ========================================================= */

import type { Env } from './commandes';
import { telegram } from './telegram';

const ISSUES: Record<string, { statut: string; texte: string }> = {
  ok: { statut: 'acceptee', texte: '✅ Acceptée' },
  non: { statut: 'refusee', texte: '❌ Refusée' },
};

export async function webhookTelegram(req: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('interdit', { status: 403 });
  }
  const maj = (await req.json().catch(() => null)) as any;

  const texte: string | undefined = maj?.message?.text;
  if (texte?.startsWith('/start')) {
    await telegram(env.TELEGRAM_TOKEN, 'sendMessage', {
      chat_id: maj.message.chat.id,
      text: `Identifiant de cette conversation : ${maj.message.chat.id}\nÀ recopier dans la fiche du restaurant (telegram_chat).`,
    });
    return new Response('ok');
  }

  const clic = maj?.callback_query;
  const [action, idBrut] = String(clic?.data ?? '').split(':');
  const issue = ISSUES[action];
  if (!clic || !issue || !/^\d+$/.test(idBrut ?? '')) return new Response('ok');

  /* Le clic doit venir de LA conversation du restaurant de cette commande. */
  const chat = String(clic.message?.chat?.id ?? '');
  const c = await env.DB.prepare(
    `SELECT c.id, c.numero, c.statut FROM commandes c JOIN restaurants r ON r.id = c.restaurant_id
     WHERE c.id = ? AND r.telegram_chat = ?`,
  ).bind(Number(idBrut), chat).first<{ id: number; numero: number; statut: string }>();
  if (!c) {
    await telegram(env.TELEGRAM_TOKEN, 'answerCallbackQuery', { callback_query_id: clic.id, text: 'Commande introuvable.' });
    return new Response('ok');
  }

  /* Seule une commande encore « nouvelle » change : deux équipiers qui cliquent, le premier gagne. */
  const fait = await env.DB.prepare(`UPDATE commandes SET statut = ? WHERE id = ? AND statut = 'nouvelle'`).bind(issue.statut, c.id).run();
  if (!fait.meta.changes) {
    const deja = Object.values(ISSUES).find((i) => i.statut === c.statut)?.texte ?? c.statut;
    await telegram(env.TELEGRAM_TOKEN, 'answerCallbackQuery', { callback_query_id: clic.id, text: `Déjà traitée : ${deja}.` });
    return new Response('ok');
  }

  const qui = clic.from?.first_name ? ` par ${clic.from.first_name}` : '';
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date());
  await telegram(env.TELEGRAM_TOKEN, 'editMessageText', {
    chat_id: chat,
    message_id: clic.message.message_id,
    /* Le texte reçu par le webhook a perdu son gras : on le réécrit tel quel, avec la réponse dessous. */
    text: `${clic.message.text}\n\n${issue.texte}${qui} à ${heure.replace(':', 'h')}`,
  });
  await telegram(env.TELEGRAM_TOKEN, 'answerCallbackQuery', { callback_query_id: clic.id, text: `Commande #${c.numero} : ${issue.texte}` });
  return new Response('ok');
}
