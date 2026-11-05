-- Une promotion sur un plat, certains jours de la semaine : le menu kebab à -50 %
-- le mercredi (Kebab Jaune, 2026-11-04). JSON, voir `Promo` dans src/prix.ts ; NULL = aucune.
ALTER TABLE plats ADD COLUMN promo TEXT;
