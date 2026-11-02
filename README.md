# Moteur de commande MELYAS

Un seul Worker Cloudflare pour tous les restaurants : il reçoit les commandes des sites, vérifie que le restaurant est ouvert, recalcule le total depuis la carte en base, enregistre la commande dans D1 et prévient le restaurant sur Telegram (Accepter / Refuser). Paiement au comptoir, rien n'est encaissé en ligne.

## Travailler en local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local     # crée la base locale et charge restaurants/kebab-jaune.json
npm run dev          # http://127.0.0.1:8787
npm test
```

Sans `TELEGRAM_TOKEN`, les alertes s'écrivent dans la console de `npm run dev`.

## Ce que le site envoie

`POST /api/kebab-jaune/commandes`

```json
{
  "cle": "identifiant-unique-par-commande",
  "turnstile": "jeton du widget Turnstile",
  "nom": "Mehdi",
  "tel": "06 12 34 56 78",
  "mode": "emporter",
  "pour": null,
  "lignes": [
    { "plat": "kebab", "qte": 2, "choix": { "sauce": "Algérienne", "formule": "Menu frites + boisson", "boisson_menu": "Coca-Cola" } }
  ]
}
```

`pour` : `null` pour « dès que possible », sinon l'heure souhaitée en millisecondes (`Date.getTime()`).
Réponse : `{ ok, numero, jeton, pour, total }` (total en centimes), ou `{ ok: false, code, message }` avec un message à afficher tel quel.

## Brancher Telegram (une fois)

1. Sur Telegram, écrire à **@BotFather**, `/newbot`, et garder le jeton.
2. `npx wrangler secret put TELEGRAM_TOKEN`, puis `TELEGRAM_WEBHOOK_SECRET` (une chaîne au hasard) et `TURNSTILE_SECRET`.
3. Déclarer le webhook :
   `https://api.telegram.org/bot<JETON>/setWebhook?url=https://<adresse du worker>/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
4. Écrire `/start` au bot (ou l'ajouter au groupe de l'équipe et y écrire `/start`) : il répond l'identifiant de la conversation.
5. Le recopier dans `restaurants.telegram_chat` (dans le JSON du restaurant, puis relancer le seed).

## Ajouter un restaurant

Copier `restaurants/kebab-jaune.json`, l'adapter, puis :

```bash
node scripts/seed.mjs restaurants/<id>.json > seed.sql
npx wrangler d1 execute melyas-commande --remote --file seed.sql
```
