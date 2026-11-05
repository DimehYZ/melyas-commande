/* =========================================================
   POST /api/<restaurant>/commandes

   Le paiement se fait au comptoir : rien n'est encaissé d'avance,
   donc le vrai risque est la FAUSSE commande. D'où, dans l'ordre :
   Turnstile (robots), numéros bloqués, limites par IP et par numéro,
   puis le bouton « Accepter » du restaurant avant de préparer.
   ========================================================= */

import { heureLocale, verifierCreneau, type Planning } from './horaires';
import { calculer, type Plat } from './prix';
import { boutons, telegram, texteAlerte } from './telegram';

export type Env = {
  DB: D1Database;
  TURNSTILE_SECRET?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

export type Restaurant = {
  id: string;
  nom: string;
  fuseau: string;
  delai_min: number;
  modes: string;
  origines: string;
  telegram_chat: string | null;
  pause_jusqua: number | null;
  actif: number;
};

/* Limites contre les fausses commandes : au-delà, on renvoie vers le téléphone. */
const PAR_IP = { nombre: 15, fenetre: 10 * 60_000 }; // large : en 4G, beaucoup de clients partagent la même IP
const PAR_TEL = { nombre: 3, fenetre: 60 * 60_000 };

/* Le message que le client lit : il dit quoi faire, jamais « erreur 400 ». */
const MESSAGES: Record<string, string> = {
  ferme: 'Le restaurant est fermé à cette heure-là. Choisis un autre créneau.',
  pause: 'La cuisine fait une courte pause, les commandes reprennent dans quelques minutes.',
  trop_tot: 'Ce créneau est trop proche, la cuisine n’aura pas le temps. Choisis-en un plus tard.',
  trop_loin: 'On prend les commandes jusqu’à deux jours à l’avance.',
  robot: 'La vérification anti-robot a échoué. Recharge la page et réessaie.',
  limite: 'Trop de commandes d’un coup. Appelle le restaurant pour commander.',
  refuse: 'Commande impossible en ligne. Appelle le restaurant pour commander.',
  infos: 'Il manque ton prénom ou ton numéro de téléphone.',
  mode: 'Ce mode de retrait n’est pas proposé.',
  panier: 'Ton panier a changé : un plat n’est plus disponible ou a été modifié. Vérifie-le.',
};

export const reponse = (corps: object, status = 200, entetes: HeadersInit = {}) =>
  new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...entetes } });
const refus = (code: string, status: number, h: HeadersInit, detail?: string) =>
  reponse({ ok: false, code, message: MESSAGES[code] ?? 'Commande impossible.', ...(detail ? { detail } : {}) }, status, h);

/** 06 12 34 56 78, +33 6 12…, 0033 6… → 0612345678. null si ce n'est pas un numéro français. */
export function normaliserTel(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  let t = brut.replace(/[\s.\-()]/g, '');
  if (t.startsWith('+33')) t = '0' + t.slice(3);
  else if (t.startsWith('0033')) t = '0' + t.slice(4);
  return /^0[1-9]\d{8}$/.test(t) ? t : null;
}

async function empreinte(texte: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function turnstileOk(secret: string | undefined, jeton: unknown, ip: string): Promise<boolean> {
  /* Sans secret configuré, on refuse : un oubli de configuration ne doit pas ouvrir la porte aux robots. */
  if (!secret || typeof jeton !== 'string' || !jeton) return false;
  const corps = new FormData();
  corps.append('secret', secret);
  corps.append('response', jeton);
  corps.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: corps });
  const j = (await r.json().catch(() => null)) as { success?: boolean } | null;
  return j?.success === true;
}

/* GET /api/<restaurant>/commandes/<jeton> : la page du client l'interroge toutes les
   quelques secondes. Le jeton secret suffit, et on ne renvoie ni nom ni téléphone. */
export async function suivreCommande(env: Env, resto: Restaurant, jeton: string, cors: HeadersInit): Promise<Response> {
  const c = await env.DB.prepare('SELECT numero, statut, pour, prete_vers FROM commandes WHERE restaurant_id = ? AND jeton = ?')
    .bind(resto.id, jeton).first();
  if (!c) return reponse({ ok: false, code: 'introuvable' }, 404, cors);
  return reponse({ ok: true, ...c }, 200, { ...cors, 'cache-control': 'no-store' });
}

export async function creerCommande(req: Request, env: Env, ctx: ExecutionContext, resto: Restaurant, cors: HeadersInit): Promise<Response> {
  const maintenant = Date.now();
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';

  if (Number(req.headers.get('content-length') ?? 0) > 20_000) return refus('panier', 413, cors);
  const corps = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corps || typeof corps !== 'object') return refus('panier', 400, cors);

  /* Anti double clic : la même clé renvoie la même commande, sans en créer une deuxième. */
  const cle = typeof corps.cle === 'string' && /^[\w-]{8,64}$/.test(corps.cle) ? corps.cle : null;
  if (!cle) return refus('panier', 400, cors, 'cle');
  const deja = await env.DB.prepare('SELECT numero, jeton, pour, total FROM commandes WHERE restaurant_id = ? AND cle = ?')
    .bind(resto.id, cle).first<{ numero: number; jeton: string; pour: number | null; total: number }>();
  if (deja) return reponse({ ok: true, ...deja }, 200, cors);

  if (!(await turnstileOk(env.TURNSTILE_SECRET, corps.turnstile, ip))) return refus('robot', 403, cors);

  const nom = typeof corps.nom === 'string' ? corps.nom.trim().slice(0, 40) : '';
  const tel = normaliserTel(corps.tel);
  if (!nom || !tel) return refus('infos', 400, cors);
  const modes = JSON.parse(resto.modes) as string[];
  const mode = typeof corps.mode === 'string' && modes.includes(corps.mode) ? corps.mode : null;
  if (!mode) return refus('mode', 400, cors);

  const ipH = await empreinte(`${resto.id}:${ip}`);
  const [bloque, parIp, parTel] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM blocages WHERE restaurant_id = ? AND tel = ?').bind(resto.id, tel),
    env.DB.prepare('SELECT COUNT(*) AS n FROM commandes WHERE restaurant_id = ? AND ip = ? AND cree_le > ?')
      .bind(resto.id, ipH, maintenant - PAR_IP.fenetre),
    env.DB.prepare('SELECT COUNT(*) AS n FROM commandes WHERE restaurant_id = ? AND tel = ? AND cree_le > ?')
      .bind(resto.id, tel, maintenant - PAR_TEL.fenetre),
  ]);
  if (bloque.results[0].n > 0) return refus('refuse', 403, cors);
  if (parIp.results[0].n >= PAR_IP.nombre || parTel.results[0].n >= PAR_TEL.nombre) return refus('limite', 429, cors);

  /* Le créneau. `pour` arrive en millisecondes (Date.getTime() du navigateur), ou null. */
  const [horaires, exceptions, plats] = await env.DB.batch([
    env.DB.prepare('SELECT jour, debut, fin FROM horaires WHERE restaurant_id = ?').bind(resto.id),
    env.DB.prepare('SELECT date, debut, fin FROM exceptions WHERE restaurant_id = ? AND date >= ?')
      .bind(resto.id, heureLocale(maintenant - 86_400_000, resto.fuseau).date),
    env.DB.prepare('SELECT * FROM plats WHERE restaurant_id = ?').bind(resto.id),
  ]);
  const planning: Planning = {
    fuseau: resto.fuseau, delaiMin: resto.delai_min, pauseJusqua: resto.pause_jusqua,
    horaires: horaires.results as Planning['horaires'], exceptions: exceptions.results as Planning['exceptions'],
  };
  const pour = corps.pour === null || corps.pour === undefined ? null : Number(corps.pour);
  const creneau = verifierCreneau(maintenant, pour, planning);
  if (!creneau.ok) return refus(creneau.raison, 409, cors);

  /* Le total, recalculé depuis la carte. Le menu étudiant et les promos du jour se jugent
     à l'heure de préparation : commandé mardi soir pour mercredi midi, le menu est en promo. */
  const carte = new Map((plats.results as Plat[]).map((p) => [p.id, {
    ...p, choix: JSON.parse(p.choix as unknown as string), promo: p.promo ? JSON.parse(p.promo as unknown as string) : null,
  }]));
  const prepa = heureLocale(creneau.pour ?? maintenant, resto.fuseau);
  const calcul = calculer(corps.lignes, carte, { minutes: prepa.minutes, jour: prepa.jour });
  if (!calcul.ok) return refus('panier', 409, cors, calcul.erreur);

  /* Le numéro suit le dernier du restaurant, dans la même requête : deux commandes
     simultanées ne peuvent pas prendre le même (UNIQUE restaurant_id, numero).
     Les limites sont recomptées dans cette même requête : le comptage plus haut ne suffit
     pas quand vingt envois arrivent à la même milliseconde. */
  const jeton = crypto.randomUUID().replaceAll('-', '');
  let cree: { id: number; numero: number } | null = null;
  try {
    cree = await env.DB.prepare(
      `INSERT INTO commandes (restaurant_id, numero, jeton, cle, nom, tel, mode, pour, lignes, total, ip, cree_le)
       SELECT * FROM (
         SELECT ?1, COALESCE(MAX(numero), 1000) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 FROM commandes WHERE restaurant_id = ?1
       )
       WHERE (SELECT COUNT(*) FROM commandes WHERE restaurant_id = ?1 AND ip = ?10 AND cree_le > ?12) < ?13
         AND (SELECT COUNT(*) FROM commandes WHERE restaurant_id = ?1 AND tel = ?5 AND cree_le > ?14) < ?15
       RETURNING id, numero`,
    ).bind(resto.id, jeton, cle, nom, tel, mode, creneau.pour, JSON.stringify(calcul.lignes), calcul.total, ipH, maintenant,
      maintenant - PAR_IP.fenetre, PAR_IP.nombre, maintenant - PAR_TEL.fenetre, PAR_TEL.nombre)
      .first<{ id: number; numero: number }>();
  } catch (e) {
    /* Deux clics partis en même temps : le second bute sur la clé unique, on renvoie le premier. */
    const premier = await env.DB.prepare('SELECT numero, jeton, pour, total FROM commandes WHERE restaurant_id = ? AND cle = ?')
      .bind(resto.id, cle).first();
    if (premier) return reponse({ ok: true, ...premier }, 200, cors);
    throw e;
  }
  if (!cree) return refus('limite', 429, cors); // une limite atteinte entre le comptage et l'insertion

  /* L'alerte part après la réponse : le client n'attend pas Telegram. */
  ctx.waitUntil(
    (async () => {
      const texte = texteAlerte({ ...cree!, nom, tel, mode, pour: creneau.pour, lignes: calcul.lignes, total: calcul.total }, maintenant, resto.fuseau);
      if (!resto.telegram_chat) {
        console.warn(`[${resto.id}] pas de telegram_chat : commande #${cree!.numero} non signalée`);
        console.log(texte);
        return;
      }
      const msg = await telegram(env.TELEGRAM_TOKEN, 'sendMessage', {
        chat_id: resto.telegram_chat, text: texte, parse_mode: 'HTML', reply_markup: boutons(cree!.id, creneau.pour),
      });
      if (msg?.message_id) await env.DB.prepare('UPDATE commandes SET telegram_msg = ? WHERE id = ?').bind(msg.message_id, cree!.id).run();
    })(),
  );

  return reponse({ ok: true, numero: cree.numero, jeton, pour: creneau.pour, total: calcul.total }, 201, cors);
}
