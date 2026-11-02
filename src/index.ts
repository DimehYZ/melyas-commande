/* =========================================================
   Moteur de commande MELYAS : les routes.

   POST /api/<restaurant>/commandes           le site du restaurant envoie une commande
   GET  /api/<restaurant>/commandes/<jeton>   la page du client suit sa commande
   POST /telegram                             les clics Accepter / Refuser du bot
   ========================================================= */

import { creerCommande, reponse, suivreCommande, type Env, type Restaurant } from './commandes';
import { webhookTelegram } from './webhook';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/telegram' && req.method === 'POST') return webhookTelegram(req, env);

    const m = url.pathname.match(/^\/api\/([a-z0-9-]+)\/commandes(?:\/([a-f0-9]{32}))?$/);
    if (!m) return reponse({ ok: false, code: 'introuvable' }, 404);

    const resto = await env.DB.prepare('SELECT * FROM restaurants WHERE id = ? AND actif = 1').bind(m[1]).first<Restaurant>();
    if (!resto) return reponse({ ok: false, code: 'introuvable' }, 404);

    /* Seuls les sites déclarés pour CE restaurant peuvent commander depuis un navigateur. */
    const origine = req.headers.get('origin');
    const permises = JSON.parse(resto.origines) as string[];
    if (origine && !permises.includes(origine)) return reponse({ ok: false, code: 'origine' }, 403);
    const cors: HeadersInit = origine
      ? { 'access-control-allow-origin': origine, vary: 'Origin' }
      : {};

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
      });
    }

    const jeton = m[2];
    if (jeton) {
      if (req.method !== 'GET') return reponse({ ok: false, code: 'methode' }, 405, cors);
      return suivreCommande(env, resto, jeton, cors);
    }
    if (req.method !== 'POST') return reponse({ ok: false, code: 'methode' }, 405, cors);

    try {
      return await creerCommande(req, env, ctx, resto, cors);
    } catch (e) {
      console.error(`[${resto.id}] commande en échec`, e);
      return reponse({ ok: false, code: 'serveur', message: 'Un souci de notre côté. Appelle le restaurant pour commander.' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
