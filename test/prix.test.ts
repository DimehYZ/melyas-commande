import { describe, expect, it } from 'vitest';
import { calculer, type Groupe, type Plat } from '../src/prix';

const sauce: Groupe = { cle: 'sauce', titre: 'Sauce', valeurs: [{ v: 'Blanche' }, { v: 'Algérienne' }] };
const formule: Groupe = { cle: 'formule', titre: 'Formule', valeurs: [{ v: 'Seul' }, { v: 'Menu frites + boisson', sup: 200 }] };
const boisson: Groupe = { cle: 'boisson_menu', titre: 'Boisson', valeurs: [{ v: 'Coca-Cola' }, { v: 'Sprite' }], si: { cle: 'formule', v: 'Menu frites + boisson' } };

const supplements: Groupe = {
  cle: 'supplements', titre: 'Suppléments', plusieurs: true,
  valeurs: [{ v: 'Viande en plus', sup: 200 }, { v: 'Cheddar', sup: 100 }, { v: 'Miel', sup: 100 }],
};

const plat = (p: Partial<Plat> & Pick<Plat, 'id' | 'prix'>): Plat => ({ nom: p.id, choix: [], fenetre_debut: null, fenetre_fin: null, disponible: 1, ...p });
const carte = new Map<string, Plat>(
  [
    plat({ id: 'kebab', nom: 'Kebab', prix: 800, choix: [sauce, formule, boisson, supplements],
      promo: { titre: 'Mercredi', jours: [3], remise: 50, si: { cle: 'formule', v: 'Menu frites + boisson' } } }),
    plat({ id: 'canette', nom: 'Canette 33 cl', prix: 200 }),
    plat({ id: 'tacos', nom: 'Tacos', prix: 800, choix: [sauce, supplements] }),
    plat({ id: 'etudiant', prix: 800, fenetre_debut: 660, fenetre_fin: 810 }),
    plat({ id: 'rupture', prix: 400, disponible: 0 }),
  ].map((p) => [p.id, p]),
);
const MIDI = { minutes: 12 * 60, jour: 1 }; // un lundi midi

describe('calculer', () => {
  it('recalcule le total depuis la carte, suppléments compris', () => {
    const r = calculer(
      [
        { plat: 'kebab', qte: 2, choix: { sauce: 'Algérienne', formule: 'Menu frites + boisson', boisson_menu: 'Sprite' } },
        { plat: 'canette', qte: 1 },
      ],
      carte,
      MIDI,
    );
    expect(r).toMatchObject({ ok: true, total: 2 * 1000 + 200 });
    if (r.ok) {
      expect(r.lignes[0].options).toEqual([
        { titre: 'Sauce', v: 'Algérienne' },
        { titre: 'Formule', v: 'Menu frites + boisson' },
        { titre: 'Boisson', v: 'Sprite' },
      ]);
    }
  });

  it('ignore un prix envoyé par le navigateur', () => {
    const r = calculer([{ plat: 'canette', qte: 1, prix: 1 } as never], carte, MIDI);
    expect(r).toMatchObject({ ok: true, total: 200 });
  });

  it('ignore la boisson d’un sandwich seul, exige celle d’un menu', () => {
    expect(calculer([{ plat: 'kebab', qte: 1, choix: { sauce: 'Blanche', formule: 'Seul', boisson_menu: 'Sprite' } }], carte, MIDI))
      .toMatchObject({ ok: true, total: 800 });
    expect(calculer([{ plat: 'kebab', qte: 1, choix: { sauce: 'Blanche', formule: 'Menu frites + boisson' } }], carte, MIDI))
      .toMatchObject({ ok: false, erreur: 'choix_manquant:kebab:boisson_menu' });
  });

  it('refuse une valeur hors carte et un choix inconnu', () => {
    expect(calculer([{ plat: 'kebab', qte: 1, choix: { sauce: 'Mayo maison', formule: 'Seul' } }], carte, MIDI)).toMatchObject({ ok: false });
    expect(calculer([{ plat: 'canette', qte: 1, choix: { supplement: 'fromage' } }], carte, MIDI)).toMatchObject({ ok: false });
  });

  it('refuse un plat inconnu, en rupture, ou hors de sa fenêtre', () => {
    expect(calculer([{ plat: 'pizza', qte: 1 }], carte, MIDI)).toMatchObject({ ok: false, erreur: 'plat_inconnu' });
    expect(calculer([{ plat: 'rupture', qte: 1 }], carte, MIDI)).toMatchObject({ ok: false, erreur: 'indisponible:rupture' });
    expect(calculer([{ plat: 'etudiant', qte: 1 }], carte, MIDI)).toMatchObject({ ok: true });
    expect(calculer([{ plat: 'etudiant', qte: 1 }], carte, { minutes: 20 * 60, jour: 1 })).toMatchObject({ ok: false, erreur: 'hors_fenetre:etudiant' });
  });

  it('additionne les suppléments cochés, aucun compris', () => {
    const r = calculer([{ plat: 'tacos', qte: 2, choix: { sauce: 'Blanche', supplements: ['Viande en plus', 'Miel'] } }], carte, MIDI);
    expect(r).toMatchObject({ ok: true, total: 2 * 1100 });
    if (r.ok) expect(r.lignes[0].options).toContainEqual({ titre: 'Suppléments', v: 'Viande en plus, Miel' });
    const sans = calculer([{ plat: 'tacos', qte: 1, choix: { sauce: 'Blanche' } }], carte, MIDI);
    expect(sans).toMatchObject({ ok: true, total: 800 });
    if (sans.ok) expect(sans.lignes[0].options).toEqual([{ titre: 'Sauce', v: 'Blanche' }]);
  });

  it('refuse un supplément hors carte, en double, ou envoyé comme texte', () => {
    for (const supplements of [['Caviar'], ['Miel', 'Miel'], 'Miel']) {
      expect(calculer([{ plat: 'tacos', qte: 1, choix: { sauce: 'Blanche', supplements } } as never], carte, MIDI)).toMatchObject({ ok: false });
    }
  });

  it('refuse les quantités absurdes et le panier vide', () => {
    for (const qte of [0, -1, 1.5, 21, '2']) {
      expect(calculer([{ plat: 'canette', qte } as never], carte, MIDI)).toMatchObject({ ok: false, erreur: 'quantite' });
    }
    expect(calculer([], carte, MIDI)).toMatchObject({ ok: false, erreur: 'panier_vide' });
    expect(calculer('n’importe quoi', carte, MIDI)).toMatchObject({ ok: false });
  });

  describe('promo du mercredi', () => {
    const MERCREDI = { minutes: 12 * 60, jour: 3 };
    const menu = { sauce: 'Blanche', formule: 'Menu frites + boisson', boisson_menu: 'Sprite' };

    it('met le menu kebab à moitié prix le mercredi seulement', () => {
      const r = calculer([{ plat: 'kebab', qte: 2, choix: menu }], carte, MERCREDI);
      expect(r).toMatchObject({ ok: true, total: 2 * 500 });
      if (r.ok) expect(r.lignes[0].options).toContainEqual({ titre: 'Promo', v: 'Mercredi -50 %' });
      expect(calculer([{ plat: 'kebab', qte: 1, choix: menu }], carte, MIDI)).toMatchObject({ ok: true, total: 1000 });
    });

    it('laisse le kebab seul et les autres plats au plein tarif', () => {
      const seul = calculer([{ plat: 'kebab', qte: 1, choix: { sauce: 'Blanche', formule: 'Seul' } }], carte, MERCREDI);
      expect(seul).toMatchObject({ ok: true, total: 800 });
      if (seul.ok) expect(seul.lignes[0].options.map((o) => o.titre)).not.toContain('Promo');
      expect(calculer([{ plat: 'canette', qte: 1 }], carte, MERCREDI)).toMatchObject({ ok: true, total: 200 });
    });

    it('ne remise pas les suppléments', () => {
      const r = calculer([{ plat: 'kebab', qte: 1, choix: { ...menu, supplements: ['Cheddar'] } }], carte, MERCREDI);
      expect(r).toMatchObject({ ok: true, total: 500 + 100 });
    });
  });
});
