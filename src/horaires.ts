/* =========================================================
   Est-ce qu'on peut commander, et pour quand ?

   Tout se calcule à l'heure LOCALE du restaurant (Europe/Paris),
   jamais à l'heure du serveur Cloudflare, qui tourne en UTC : un
   Worker à Francfort ne sait pas qu'Aubenas est passé à l'heure d'hiver.

   Une plage peut finir après minuit (`fin` > 1440) : 18h à 2h du
   matin s'écrit { debut: 1080, fin: 1560 } sur le jour où elle commence.
   ========================================================= */

export type Plage = { debut: number; fin: number };
export type Horaire = Plage & { jour: number };
export type Exception = { date: string; debut: number | null; fin: number | null };

export type Planning = {
  fuseau: string;
  delaiMin: number;
  horaires: Horaire[];
  exceptions: Exception[];
  pauseJusqua: number | null;
};

export type Local = { date: string; jour: number; minutes: number };

const JOURS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formats = new Map<string, Intl.DateTimeFormat>();

export function heureLocale(ms: number, fuseau: string): Local {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    formats.set(fuseau, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, jour: JOURS[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const veille = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

/* Les plages d'un jour : l'exception du jour si elle existe, sinon les horaires de la semaine. */
export function plagesDuJour(date: string, jour: number, p: Planning): Plage[] {
  const ex = p.exceptions.filter((e) => e.date === date);
  if (ex.length) return ex.filter((e) => e.debut !== null && e.fin !== null).map((e) => ({ debut: e.debut!, fin: e.fin! }));
  return p.horaires.filter((h) => h.jour === jour).map(({ debut, fin }) => ({ debut, fin }));
}

/* La plage qui contient `l`, ramenée au jour de `l` (une plage de la veille qui déborde après minuit compte). */
function plagesAutour(l: Local, p: Planning): Plage[] {
  const hier = veille(l.date);
  const debordes = plagesDuJour(hier, (l.jour + 6) % 7, p)
    .filter((x) => x.fin > 1440)
    .map((x) => ({ debut: x.debut - 1440, fin: x.fin - 1440 }));
  return [...debordes, ...plagesDuJour(l.date, l.jour, p)];
}

export type Creneau = { ok: true; pour: number | null } | { ok: false; raison: string };

/* Au-delà, une commande programmée est refusée : personne ne commande son kebab trois jours avant. */
const HORIZON_MS = 2 * 86_400_000;
/* Le client a mis du temps à remplir le formulaire : on tolère un créneau un peu juste. */
const TOLERANCE_MS = 5 * 60_000;

/**
 * `pour` null = dès que possible : il faut être ouvert MAINTENANT, et pouvoir
 * préparer la commande avant la fermeture. Sinon, `pour` doit tomber dans une
 * plage, au moins `delaiMin` après son ouverture et après maintenant.
 */
export function verifierCreneau(maintenant: number, pour: number | null, p: Planning): Creneau {
  const delai = p.delaiMin * 60_000;

  if (pour === null) {
    if (p.pauseJusqua && maintenant < p.pauseJusqua) return { ok: false, raison: 'pause' };
    const l = heureLocale(maintenant, p.fuseau);
    const ouvert = plagesAutour(l, p).some((x) => l.minutes >= x.debut && l.minutes + p.delaiMin <= x.fin);
    return ouvert ? { ok: true, pour: null } : { ok: false, raison: 'ferme' };
  }

  if (!Number.isFinite(pour) || pour < maintenant + delai - TOLERANCE_MS) return { ok: false, raison: 'trop_tot' };
  if (pour > maintenant + HORIZON_MS) return { ok: false, raison: 'trop_loin' };
  if (p.pauseJusqua && pour < p.pauseJusqua + delai) return { ok: false, raison: 'pause' };
  const l = heureLocale(pour, p.fuseau);
  const dedans = plagesAutour(l, p).some((x) => l.minutes >= x.debut + p.delaiMin && l.minutes <= x.fin);
  return dedans ? { ok: true, pour } : { ok: false, raison: 'ferme' };
}
