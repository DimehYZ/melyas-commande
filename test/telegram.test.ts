import { describe, expect, it } from 'vitest';
import { normaliserTel } from '../src/commandes';
import { boutons, preteVers, texteAlerte } from '../src/telegram';

describe('boutons et heure de retrait', () => {
  it('propose des durées pour « dès que possible », un seul Accepter pour une commande programmée', () => {
    const asap = boutons(7, null).inline_keyboard.flat().map((b) => b.callback_data);
    expect(asap).toEqual(['ok:7:10', 'ok:7:20', 'ok:7:30', 'non:7']);
    expect(boutons(7, 123).inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['ok:7', 'non:7']);
  });
  it('calcule l’heure où la commande sera prête', () => {
    const t = Date.parse('2026-11-02T18:00:00Z');
    expect(preteVers(null, 20, t, 15)).toBe(t + 20 * 60_000);
    expect(preteVers(null, null, t, 15)).toBe(t + 15 * 60_000); // vieille alerte sans durée
    expect(preteVers(t + 3_600_000, 10, t, 15)).toBe(t + 3_600_000); // programmée : l'heure du client
  });
});

describe('texteAlerte', () => {
  const maintenant = Date.parse('2026-11-02T18:00:00Z'); // 19h à Paris
  const commande = {
    id: 7, numero: 1042, nom: 'Mehdi <b>', tel: '0612345678', mode: 'emporter', total: 2300,
    pour: Date.parse('2026-11-02T19:30:00Z'),
    lignes: [
      { plat: 'kebab', nom: 'Kebab', qte: 2, unitaire: 1000, montant: 2000,
        options: [{ titre: 'Sauce', v: 'Algérienne' }, { titre: 'Formule', v: 'Menu frites + boisson' }, { titre: 'Boisson', v: 'Coca-Cola' }] },
      { plat: 'hamburger', nom: 'Hamburger', qte: 1, unitaire: 600, montant: 600, options: [{ titre: 'Formule', v: 'Seul' }] },
    ],
  };

  it('donne à la cuisine tout ce qu’il faut, et rien de plus', () => {
    const t = texteAlerte(commande, maintenant, 'Europe/Paris');
    expect(t).toContain('NOUVELLE COMMANDE #1042');
    expect(t).toContain('Téléphone : 06 12 34 56 78');
    expect(t).toContain('<b>2 × Kebab</b>\n   Sauce : Algérienne\n   Formule : Menu frites + boisson\n   Boisson : Coca-Cola');
    expect(t).not.toContain('Seul');
    expect(t).toContain('Total : 23 €');
    expect(t).toContain('Mode : À emporter');
    expect(t).toContain('Heure souhaitée : 20h30');
  });

  it('échappe ce que le client a tapé', () => {
    expect(texteAlerte(commande, maintenant, 'Europe/Paris')).toContain('Client : Mehdi &lt;b&gt;');
  });

  it('écrit « demain » et « dès que possible »', () => {
    expect(texteAlerte({ ...commande, pour: Date.parse('2026-11-03T11:00:00Z') }, maintenant, 'Europe/Paris')).toContain('demain 12h00');
    expect(texteAlerte({ ...commande, pour: null }, maintenant, 'Europe/Paris')).toContain('dès que possible');
  });
});

describe('normaliserTel', () => {
  it('accepte les écritures françaises courantes', () => {
    for (const t of ['06 12 34 56 78', '06.12.34.56.78', '+33 6 12 34 56 78', '0033612345678']) expect(normaliserTel(t)).toBe('0612345678');
  });
  it('refuse le reste', () => {
    for (const t of ['0012345678', '061234567', 'abc', '', 612345678]) expect(normaliserTel(t)).toBeNull();
  });
});
