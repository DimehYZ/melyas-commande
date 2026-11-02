-- Moteur de commande MELYAS : schéma de départ.
-- Tous les montants sont en CENTIMES (entiers), jamais en euros flottants.
-- Toutes les heures d'ouverture sont en minutes depuis minuit, heure LOCALE du restaurant.

CREATE TABLE restaurants (
  id              TEXT PRIMARY KEY,            -- 'kebab-jaune'
  nom             TEXT NOT NULL,
  fuseau          TEXT NOT NULL DEFAULT 'Europe/Paris',
  delai_min       INTEGER NOT NULL DEFAULT 15, -- préparation, à emporter
  modes           TEXT NOT NULL DEFAULT '["emporter"]',   -- JSON : emporter, sur_place
  origines        TEXT NOT NULL DEFAULT '[]',  -- JSON : sites autorisés à commander (CORS)
  telegram_chat   TEXT,                        -- conversation qui reçoit les alertes
  pause_jusqua    INTEGER,                     -- epoch ms : commandes coupées jusqu'à cette heure
  actif           INTEGER NOT NULL DEFAULT 1
);

-- Plusieurs lignes par jour = service coupé (midi et soir). jour : 0 = dimanche.
CREATE TABLE horaires (
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  jour            INTEGER NOT NULL CHECK (jour BETWEEN 0 AND 6),
  debut           INTEGER NOT NULL,
  fin             INTEGER NOT NULL
);
CREATE INDEX horaires_resto ON horaires(restaurant_id);

-- Un jour à part : fermé (debut NULL) ou ouvert à d'autres heures. Remplace les horaires du jour.
CREATE TABLE exceptions (
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  date            TEXT NOT NULL,               -- 'AAAA-MM-JJ', date locale
  debut           INTEGER,
  fin             INTEGER
);
CREATE INDEX exceptions_resto ON exceptions(restaurant_id, date);

-- La carte. `choix` (JSON) décrit les options et leurs suppléments, voir src/prix.ts.
CREATE TABLE plats (
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  id              TEXT NOT NULL,
  nom             TEXT NOT NULL,
  prix            INTEGER NOT NULL,
  choix           TEXT NOT NULL DEFAULT '[]',
  fenetre_debut   INTEGER,                     -- plat servi seulement entre ces heures (menu étudiant)
  fenetre_fin     INTEGER,
  disponible      INTEGER NOT NULL DEFAULT 1,  -- 0 = rupture, le plat ne se commande plus
  PRIMARY KEY (restaurant_id, id)
);

CREATE TABLE commandes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  numero          INTEGER NOT NULL,            -- celui qu'on annonce au client : #1042
  jeton           TEXT NOT NULL UNIQUE,        -- lien de suivi secret
  cle             TEXT NOT NULL UNIQUE,        -- anti double clic : même clé = même commande
  statut          TEXT NOT NULL DEFAULT 'nouvelle',
  nom             TEXT NOT NULL,
  tel             TEXT NOT NULL,
  mode            TEXT NOT NULL,
  pour            INTEGER,                     -- epoch ms de l'heure souhaitée ; NULL = dès que possible
  lignes          TEXT NOT NULL,               -- JSON, recalculé par le serveur
  total           INTEGER NOT NULL,
  ip              TEXT NOT NULL,               -- empreinte de l'IP (hachée), pour les limites
  telegram_msg    INTEGER,                     -- message d'alerte, pour le modifier après Accepter / Refuser
  cree_le         INTEGER NOT NULL,
  UNIQUE (restaurant_id, numero)
);
CREATE INDEX commandes_ip ON commandes(restaurant_id, ip, cree_le);
CREATE INDEX commandes_tel ON commandes(restaurant_id, tel, cree_le);

-- Numéros refusés après une fausse commande.
CREATE TABLE blocages (
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  tel             TEXT NOT NULL,
  PRIMARY KEY (restaurant_id, tel)
);
