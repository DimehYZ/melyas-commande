import { describe, expect, it } from 'vitest';
import { heureLocale, verifierCreneau, type Planning } from '../src/horaires';

const TOUS_LES_JOURS = [0, 1, 2, 3, 4, 5, 6].map((jour) => ({ jour, debut: 11 * 60, fin: 23 * 60 }));
const kebab = (autre: Partial<Planning> = {}): Planning => ({
  fuseau: 'Europe/Paris', delaiMin: 15, horaires: TOUS_LES_JOURS, exceptions: [], pauseJusqua: null, ...autre,
});
const utc = (iso: string) => Date.parse(iso);

describe('heureLocale', () => {
  it('passe en heure de Paris, été comme hiver', () => {
    expect(heureLocale(utc('2026-07-01T12:00:00Z'), 'Europe/Paris')).toEqual({ date: '2026-07-01', jour: 3, minutes: 14 * 60 });
    expect(heureLocale(utc('2026-11-02T12:00:00Z'), 'Europe/Paris')).toEqual({ date: '2026-11-02', jour: 1, minutes: 13 * 60 });
  });
  it('change de date à minuit heure de Paris, pas à minuit UTC', () => {
    expect(heureLocale(utc('2026-11-02T23:30:00Z'), 'Europe/Paris').date).toBe('2026-11-03');
  });
});

describe('dès que possible', () => {
  it('accepte pendant l’ouverture', () => {
    expect(verifierCreneau(utc('2026-11-02T19:00:00Z'), null, kebab())).toEqual({ ok: true, pour: null }); // 20h
  });
  it('refuse avant 11h et quand il ne reste plus le temps de préparer', () => {
    expect(verifierCreneau(utc('2026-11-02T09:30:00Z'), null, kebab())).toMatchObject({ ok: false, raison: 'ferme' }); // 10h30
    expect(verifierCreneau(utc('2026-11-02T21:50:00Z'), null, kebab())).toMatchObject({ ok: false, raison: 'ferme' }); // 22h50
    expect(verifierCreneau(utc('2026-11-02T21:45:00Z'), null, kebab())).toMatchObject({ ok: true }); // 22h45 + 15 = 23h pile
  });
  it('refuse pendant une pause', () => {
    const m = utc('2026-11-02T19:00:00Z');
    expect(verifierCreneau(m, null, kebab({ pauseJusqua: m + 600_000 }))).toMatchObject({ ok: false, raison: 'pause' });
  });
  it('refuse un jour fermé exceptionnellement, accepte des horaires exceptionnels', () => {
    const m = utc('2026-11-02T19:00:00Z');
    expect(verifierCreneau(m, null, kebab({ exceptions: [{ date: '2026-11-02', debut: null, fin: null }] }))).toMatchObject({ ok: false });
    const soir = kebab({ exceptions: [{ date: '2026-11-02', debut: 18 * 60, fin: 21 * 60 }] });
    expect(verifierCreneau(m, null, soir)).toMatchObject({ ok: true });
    expect(verifierCreneau(utc('2026-11-02T11:00:00Z'), null, soir)).toMatchObject({ ok: false }); // midi, fermé ce jour-là
  });
  it('gère une plage qui finit après minuit', () => {
    const nuit = kebab({ horaires: [{ jour: 1, debut: 18 * 60, fin: 26 * 60 }] }); // lundi 18h à mardi 2h
    expect(verifierCreneau(utc('2026-11-03T00:00:00Z'), null, nuit)).toMatchObject({ ok: true }); // mardi 1h
    expect(verifierCreneau(utc('2026-11-03T01:30:00Z'), null, nuit)).toMatchObject({ ok: false }); // mardi 2h30
  });
});

describe('commande programmée', () => {
  const maintenant = utc('2026-11-02T09:00:00Z'); // lundi 10h, fermé
  it('accepte un créneau dans l’ouverture, même si on est fermé maintenant', () => {
    expect(verifierCreneau(maintenant, utc('2026-11-02T11:30:00Z'), kebab())).toEqual({ ok: true, pour: utc('2026-11-02T11:30:00Z') });
  });
  it('refuse 11h pile : la cuisine ouvre à 11h, la première commande est prête à 11h15', () => {
    expect(verifierCreneau(maintenant, utc('2026-11-02T10:00:00Z'), kebab())).toMatchObject({ ok: false, raison: 'ferme' });
    expect(verifierCreneau(maintenant, utc('2026-11-02T10:15:00Z'), kebab())).toMatchObject({ ok: true });
  });
  it('refuse après la fermeture, dans le passé, et à plus de deux jours', () => {
    expect(verifierCreneau(maintenant, utc('2026-11-02T22:30:00Z'), kebab())).toMatchObject({ ok: false, raison: 'ferme' });
    expect(verifierCreneau(maintenant, maintenant - 60_000, kebab())).toMatchObject({ ok: false, raison: 'trop_tot' });
    expect(verifierCreneau(maintenant, utc('2026-11-05T12:00:00Z'), kebab())).toMatchObject({ ok: false, raison: 'trop_loin' });
  });
  it('refuse un créneau plus proche que le délai de préparation', () => {
    const midi = utc('2026-11-02T11:00:00Z');
    expect(verifierCreneau(midi, midi + 5 * 60_000, kebab())).toMatchObject({ ok: false, raison: 'trop_tot' });
  });
});
