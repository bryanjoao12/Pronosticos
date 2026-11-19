import { buildCandidates, findCombos } from "../../../lib/combos";
import { LEAGUE_TO_FD, getCompetitionMatches, findTeam, hasFootballData } from "../../../lib/footballData";
import { expectedGoals, marketProbabilities, modelProbForPick } from "../../../lib/model";

// Probabilidad final = mezcla de lo que dicen las casas y lo que dice la forma real.
const MODEL_WEIGHT = 0.3; // el backtest muestra que las casas aciertan más; la forma solo matiza

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ligas a consultar (claves de The Odds API). Se pueden cambiar con ODDS_LEAGUES.
const DEFAULT_LEAGUES = [
  "soccer_italy_serie_a",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_epl",
  "soccer_efl_champ",                     // Championship
  "soccer_uefa_nations_league",           // solo cuando hay fecha FIFA
  "soccer_france_ligue_one",
  "soccer_brazil_campeonato",             // Brasileirão Série A
  "soccer_brazil_serie_b",
  "soccer_usa_mls",
  "soccer_mexico_ligamx",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_uefa_europa_conference_league",
  // Liga Ecuatoriana y amistosos internacionales: The Odds API no los ofrece.
];

// Mercados extra (córners, tarjetas, ambos marcan, doble oportunidad) solo se
// pueden pedir partido a partido y cuestan créditos por partido:
//   btts + doble oportunidad (región eu) = 2 créditos
//   córners + tarjetas (regiones uk, us)  = 4 créditos
// Por eso solo se piden para los N partidos más importantes del día.
const EXTRA_EVENTS = Math.max(0, Number(process.env.ODDS_EXTRA_EVENTS ?? 1));
const MIN_CREDITS_FOR_EXTRAS = 60; // por debajo de esto solo se usan goles y 1X2

const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? -5); // Ecuador
const CACHE_SECONDS = 60 * 60 * 24; // 1 consulta real por liga y por día

function iso(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Ventana fija por día (00:00 hora local → +84 h; se priorizan las primeras 36 h) para que la URL sea la misma
// todo el día y Vercel la sirva desde caché sin gastar créditos.
function dayWindow() {
  const offsetMs = TZ_OFFSET_HOURS * 3600 * 1000;
  const local = new Date(Date.now() + offsetMs);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const from = new Date(startLocal - offsetMs);
  const to = new Date(from.getTime() + 84 * 3600 * 1000);
  const near = from.getTime() + 36 * 3600 * 1000;
  return { from: iso(from), to: iso(to), near, day: new Date(startLocal).toISOString().slice(0, 10) };
}

export async function GET(request) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Falta ODDS_API_KEY en las variables de entorno." }, { status: 500 });
  }

  const url = new URL(request.url);
  const target = Math.min(100, Math.max(5, Number(url.searchParams.get("cuota")) || 20));
  const minLegs = Math.min(8, Math.max(3, Number(url.searchParams.get("min")) || 5));

  const leagues = (process.env.ODDS_LEAGUES || DEFAULT_LEAGUES.join(","))
    .split(",").map(s => s.trim()).filter(Boolean);
  const { from, to, near, day } = dayWindow();

  // /sports no gasta créditos: sirve para saltar ligas fuera de temporada.
  let active = new Set(leagues);
  try {
    const s = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`, {
      next: { revalidate: CACHE_SECONDS },
    });
    if (s.ok) {
      const list = await s.json();
      active = new Set(list.filter(x => x.active).map(x => x.key));
    }
  } catch {}

  const toFetch = leagues.filter(l => active.has(l));
  let remaining = null;
  const results = await Promise.all(toFetch.map(async league => {
    const q = new URLSearchParams({
      apiKey, regions: "eu", markets: "h2h,totals", oddsFormat: "decimal",
      commenceTimeFrom: from, commenceTimeTo: to,
    });
    try {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports/${league}/odds/?${q}`, {
        next: { revalidate: CACHE_SECONDS },
      });
      const rem = r.headers.get("x-requests-remaining");
      if (rem != null) remaining = rem;
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }));

  const events = results.flat();

  // Mercados extra para los partidos más cercanos con más casas (los más importantes).
  let extraEvents = 0;
  if (EXTRA_EVENTS > 0 && !(remaining != null && Number(remaining) < MIN_CREDITS_FOR_EXTRAS)) {
    const nowMs = Date.now();
    const pick = events
      .filter(e => { const t = new Date(e.commence_time).getTime(); return t > nowMs && t <= near; })
      .sort((a, b) => (b.bookmakers?.length || 0) - (a.bookmakers?.length || 0))
      .slice(0, EXTRA_EVENTS);
    const getExtra = async (ev, regions, markets) => {
      const q = new URLSearchParams({ apiKey, regions, markets, oddsFormat: "decimal" });
      try {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/${ev.sport_key}/events/${ev.id}/odds?${q}`, {
          next: { revalidate: CACHE_SECONDS },
        });
        const rem = r.headers.get("x-requests-remaining");
        if (rem != null) remaining = rem;
        if (!r.ok) return [];
        return (await r.json()).bookmakers || [];
      } catch {
        return [];
      }
    };
    await Promise.all(pick.map(async ev => {
      const [a, b] = await Promise.all([
        getExtra(ev, "eu", "btts,double_chance"),
        getExtra(ev, "uk,us", "alternate_totals_corners,alternate_totals_cards"),
      ]);
      if (a.length || b.length) extraEvents++;
      ev.bookmakers = [...(ev.bookmakers || []), ...a, ...b];
    }));
  }
  const candidates = buildCandidates(events);

  // Forma real de los equipos (football-data.org) → probabilidad del modelo.
  let withForm = 0;
  if (hasFootballData()) {
    const codes = [...new Set(events.map(e => LEAGUE_TO_FD[e.sport_key]).filter(Boolean))];
    const comps = {};
    await Promise.all(codes.map(async c => { comps[c] = await getCompetitionMatches(c); }));
    const evModel = {};
    for (const ev of events) {
      const comp = comps[LEAGUE_TO_FD[ev.sport_key]];
      if (!comp) continue;
      const h = findTeam(ev.home_team, comp.matches), a = findTeam(ev.away_team, comp.matches);
      if (!h || !a || h.id === a.id) continue;
      const { lh, la, H, A } = expectedGoals(comp.matches, h.id, a.id);
      if (H.played < 3 || A.played < 3) continue;
      evModel[ev.id] = { P: marketProbabilities(lh, la), form: { home: H.form.join(""), away: A.form.join("") } };
    }
    for (const c of candidates) {
      const m = evModel[c.eventId];
      if (!m) continue;
      const mp = modelProbForPick(m.P, c, c.home, c.away);
      if (mp == null) continue;
      c.marketProb = c.prob;
      c.modelProb = +mp.toFixed(4);
      c.prob = +(c.prob * (1 - MODEL_WEIGHT) + mp * MODEL_WEIGHT).toFixed(4);
      c.form = m.form;
      withForm++;
    }
  }
  const lo = target * 0.9, hi = target * 1.15;
  const opts = { target, lo, hi, minLegs, maxLegs: Math.max(minLegs, 7) };
  // Primero solo partidos de hoy/mañana; si no alcanza, se usan los próximos días.
  const soon = candidates.filter(c => new Date(c.start).getTime() <= near);
  let combos = findCombos(soon, opts);
  let extended = false;
  if (combos.length === 0) {
    combos = findCombos(candidates, opts);
    extended = combos.length > 0;
  }

  return Response.json({
    day,
    target,
    eventsAnalyzed: events.length,
    candidates: candidates.length,
    extraEvents,
    withForm,
    byMarket: candidates.reduce((m, c) => ((m[c.market] = (m[c.market] || 0) + 1), m), {}),
    extended,
    creditsRemaining: remaining,
    combos,
  });
}
