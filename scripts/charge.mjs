/* =========================================================
   Test de charge du moteur, à lancer contre `npm run dev` (jamais contre le site en ligne :
   il sonnerait 100 fois sur Telegram).

     node scripts/charge.mjs [adresse] [nombre]

   1. N commandes envoyées à la même milliseconde, chacune avec son téléphone et son IP :
      toutes doivent passer, avec des numéros uniques et qui se suivent.
   2. La même commande envoyée 5 fois d'un coup (double clic, réseau qui renvoie) : une seule.
   3. 20 commandes simultanées depuis la même IP : la limite doit s'appliquer.
   ========================================================= */

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const N = Number(process.argv[3] ?? 100);
const api = `${base}/api/kebab-jaune/commandes`;

/* Demain 12h30 à Paris : le restaurant est ouvert, quelle que soit l'heure du test. */
function demainMidi() {
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(Date.now() + 86_400_000);
  for (const decalage of ['+01:00', '+02:00']) {
    const t = Date.parse(`${jour}T12:30:00${decalage}`);
    const h = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric' }).format(t);
    if (parseInt(h, 10) === 12) return t;
  }
  throw new Error('heure de Paris introuvable');
}
const pour = demainMidi();

const panier = [
  { plat: 'kebab', qte: 2, choix: { sauce: 'Algérienne', formule: 'Menu frites + boisson', boisson_menu: 'Coca-Cola' } },
  { plat: 'canette', qte: 1, choix: { canette: 'Sprite' } },
];
const TOTAL = 2200; // 2 × (8 € + 2 € de menu) + canette 2 €

const unique = Date.now() % 1_000_000;
function commande(i, { ip, cle } = {}) {
  return fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip ?? `10.${(i >> 8) & 255}.${i & 255}.${unique % 250}` },
    body: JSON.stringify({
      cle: cle ?? crypto.randomUUID(), turnstile: 'XXXX.DUMMY.TOKEN.XXXX', nom: `Charge ${i}`,
      tel: `07${String(unique * 1000 + i).padStart(8, '0').slice(-8)}`, mode: 'emporter', pour, lignes: panier,
    }),
  }).then(async (r) => ({ statut: r.status, ...(await r.json()) }));
}

let echecs = 0;
const verifier = (ok, texte) => { console.log(`${ok ? 'OK  ' : 'RATÉ'} ${texte}`); if (!ok) echecs++; };

/* 1. Le rush */
let t0 = performance.now();
const rush = await Promise.all(Array.from({ length: N }, (_, i) => commande(i)));
const duree = Math.round(performance.now() - t0);
const passees = rush.filter((r) => r.statut === 201);
const numeros = passees.map((r) => r.numero).sort((a, b) => a - b);
verifier(passees.length === N, `${passees.length}/${N} commandes simultanées enregistrées en ${duree} ms`);
verifier(new Set(numeros).size === numeros.length, 'aucun numéro en double');
verifier(numeros.at(-1) - numeros[0] === numeros.length - 1, `numéros qui se suivent : #${numeros[0]} à #${numeros.at(-1)}`);
verifier(passees.every((r) => r.total === TOTAL), 'total recalculé juste sur chaque commande (22 €)');
const refus = rush.filter((r) => r.statut !== 201);
if (refus.length) console.log('     refus :', [...new Set(refus.map((r) => `${r.statut} ${r.code}`))].join(', '));

/* 2. Le double clic */
const cle = crypto.randomUUID();
const clics = await Promise.all(Array.from({ length: 5 }, () => commande(9999, { cle, ip: '10.99.99.99' })));
const nums = new Set(clics.filter((r) => r.ok).map((r) => r.numero));
verifier(clics.every((r) => r.ok) && nums.size === 1, `5 envois de la même commande → une seule (#${[...nums].join(', #')})`);

/* 3. Une même IP qui mitraille */
t0 = performance.now();
const ip = `192.168.${unique % 250}.1`;
const meme = await Promise.all(Array.from({ length: 20 }, (_, i) => commande(5000 + i, { ip })));
const acceptees = meme.filter((r) => r.statut === 201).length;
verifier(acceptees <= 15, `20 commandes d'une même IP → ${acceptees} acceptées, ${20 - acceptees} refusées (limite : 15)`);

console.log(echecs ? `\n${echecs} vérification(s) ratée(s)` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
