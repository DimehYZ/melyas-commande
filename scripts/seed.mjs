// Transforme une carte restaurants/<id>.json en SQL à exécuter sur D1.
//   node scripts/seed.mjs restaurants/kebab-jaune.json > seed.sql
//   npx wrangler d1 execute melyas-commande --local --file seed.sql
//
// Rejouable : le restaurant, ses horaires et sa carte sont remplacés,
// ses commandes ne sont jamais touchées.
import { readFileSync } from 'node:fs';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : node scripts/seed.mjs restaurants/<id>.json');
  process.exit(1);
}
let carte = JSON.parse(readFileSync(fichier, 'utf8'));
/* `"carte": "autre.json"` reprend les horaires, groupes et plats d'un autre restaurant
   (la démo des rendez-vous reprend ceux du Kebab Jaune) ; seule la fiche change. */
if (carte.carte) {
  const base = JSON.parse(readFileSync(new URL(carte.carte, new URL(fichier, `file:///${process.cwd()}/`)), 'utf8'));
  carte = { ...base, restaurant: carte.restaurant };
}
const r = carte.restaurant;

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const centimes = (euros) => Math.round(euros * 100);
const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Un groupe s'écrit court dans le JSON ("Blanche" ou { v, sup }), on le rend complet pour le serveur.
// `"cle"` : la clé que le site envoie, quand deux groupes répondent à la même question
// (la formule à +2 € et celle à +3 € des maxi s'appellent toutes deux « formule »).
const groupe = (nom) => {
  const g = carte.groupes[nom];
  if (!g) throw new Error(`Groupe inconnu : ${nom}`);
  return {
    cle: g.cle ?? nom,
    titre: g.titre,
    valeurs: g.valeurs.map((x) => (typeof x === 'string' ? { v: x } : { v: x.v, ...(x.sup ? { sup: centimes(x.sup) } : {}) })),
    ...(g.si ? { si: g.si } : {}),
    ...(g.plusieurs ? { plusieurs: true } : {}),
  };
};

const sql = [];
const id = q(r.id);
sql.push(`DELETE FROM plats WHERE restaurant_id = ${id};`);
sql.push(`DELETE FROM horaires WHERE restaurant_id = ${id};`);
sql.push(
  `INSERT INTO restaurants (id, nom, fuseau, delai_min, modes, origines, telegram_chat) VALUES (` +
    [id, q(r.nom), q(r.fuseau), r.delai_min, q(JSON.stringify(r.modes)), q(JSON.stringify(r.origines)), q(r.telegram_chat)].join(', ') +
    `) ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, fuseau = excluded.fuseau, delai_min = excluded.delai_min,` +
    ` modes = excluded.modes, origines = excluded.origines, telegram_chat = COALESCE(excluded.telegram_chat, restaurants.telegram_chat);`,
);
for (const h of carte.horaires) {
  for (const jour of h.jours) {
    sql.push(`INSERT INTO horaires (restaurant_id, jour, debut, fin) VALUES (${id}, ${jour}, ${minutes(h.debut)}, ${minutes(h.fin)});`);
  }
}
for (const p of carte.plats) {
  const choix = JSON.stringify((p.choix ?? []).map(groupe));
  const [fd, ff] = p.fenetre ? p.fenetre.map(minutes) : [null, null];
  const promo = p.promo ? JSON.stringify(p.promo) : null;
  sql.push(
    `INSERT INTO plats (restaurant_id, id, nom, prix, choix, fenetre_debut, fenetre_fin, promo) VALUES (` +
      [id, q(p.id), q(p.nom), centimes(p.prix), q(choix), q(fd), q(ff), q(promo)].join(', ') +
      `);`,
  );
}
console.log(sql.join('\n'));
