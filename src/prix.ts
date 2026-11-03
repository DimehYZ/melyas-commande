/* =========================================================
   Le total se recalcule ICI, depuis la carte en base.

   Le navigateur n'envoie que des choix (« kebab, sauce algérienne,
   en menu ») : jamais un prix. Un total modifié dans la console du
   navigateur n'a donc aucun effet, et un plat retiré de la carte ou
   en rupture ne se commande plus, même depuis une vieille page ouverte.
   ========================================================= */

/* Un groupe d'options. `sup` : supplément en centimes. `si` : le groupe ne
   s'applique que si un autre choix a cette valeur (la boisson du menu).
   `plusieurs` : des cases à cocher (les suppléments du tacos), aucune ou plusieurs. */
export type Groupe = {
  cle: string;
  titre: string;
  valeurs: { v: string; sup?: number }[];
  si?: { cle: string; v: string };
  plusieurs?: boolean;
};

export type Plat = {
  id: string;
  nom: string;
  prix: number;
  choix: Groupe[];
  fenetre_debut: number | null;
  fenetre_fin: number | null;
  disponible: number;
};

export type LigneDemandee = { plat: string; qte: number; choix?: Record<string, string | string[]> };
export type LigneCalculee = { plat: string; nom: string; qte: number; options: { titre: string; v: string }[]; unitaire: number; montant: number };
export type Calcul = { ok: true; lignes: LigneCalculee[]; total: number } | { ok: false; erreur: string };

export const MAX_LIGNES = 30;
export const MAX_QTE = 20;

/** `minutes` : l'heure locale à laquelle la commande sera préparée (fenêtre du menu étudiant). */
export function calculer(demande: unknown, carte: Map<string, Plat>, minutes: number): Calcul {
  if (!Array.isArray(demande) || demande.length === 0) return { ok: false, erreur: 'panier_vide' };
  if (demande.length > MAX_LIGNES) return { ok: false, erreur: 'panier_trop_grand' };

  const lignes: LigneCalculee[] = [];
  for (const brut of demande as LigneDemandee[]) {
    const plat = typeof brut?.plat === 'string' ? carte.get(brut.plat) : undefined;
    if (!plat) return { ok: false, erreur: 'plat_inconnu' };
    if (!plat.disponible) return { ok: false, erreur: `indisponible:${plat.id}` };
    if (plat.fenetre_debut !== null && plat.fenetre_fin !== null && (minutes < plat.fenetre_debut || minutes >= plat.fenetre_fin)) {
      return { ok: false, erreur: `hors_fenetre:${plat.id}` };
    }
    const qte = brut.qte;
    if (!Number.isInteger(qte) || qte < 1 || qte > MAX_QTE) return { ok: false, erreur: 'quantite' };

    const choix = brut.choix ?? {};
    if (typeof choix !== 'object' || Array.isArray(choix)) return { ok: false, erreur: 'choix' };
    const connues = new Set(plat.choix.map((g) => g.cle));
    if (Object.keys(choix).some((k) => !connues.has(k))) return { ok: false, erreur: `choix_inconnu:${plat.id}` };

    let unitaire = plat.prix;
    const options: LigneCalculee['options'] = [];
    for (const g of plat.choix) {
      /* La boisson envoyée avec un sandwich « Seul » est ignorée, pas refusée. */
      if (g.si && choix[g.si.cle] !== g.si.v) continue;
      if (g.plusieurs) {
        /* Absent ou vide : pas de supplément. Une valeur en double est refusée, pas comptée deux fois. */
        const cochees = choix[g.cle] ?? [];
        if (!Array.isArray(cochees) || new Set(cochees).size !== cochees.length) return { ok: false, erreur: `choix:${plat.id}:${g.cle}` };
        const valeurs = cochees.map((v) => g.valeurs.find((x) => x.v === v));
        if (valeurs.some((x) => !x)) return { ok: false, erreur: `choix:${plat.id}:${g.cle}` };
        for (const x of valeurs) unitaire += x!.sup ?? 0;
        if (valeurs.length) options.push({ titre: g.titre, v: valeurs.map((x) => x!.v).join(', ') });
        continue;
      }
      const valeur = g.valeurs.find((x) => x.v === choix[g.cle]);
      if (!valeur) return { ok: false, erreur: `choix_manquant:${plat.id}:${g.cle}` };
      unitaire += valeur.sup ?? 0;
      options.push({ titre: g.titre, v: valeur.v });
    }
    lignes.push({ plat: plat.id, nom: plat.nom, qte, options, unitaire, montant: unitaire * qte });
  }
  return { ok: true, lignes, total: lignes.reduce((s, l) => s + l.montant, 0) };
}
