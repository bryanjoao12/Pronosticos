// Cliente de football-data.org (plan gratis: 10 consultas/min).
// Una consulta por competición trae todos los partidos de la temporada, así
// que con 8 consultas (en caché 6 h) se tiene la forma de todos los equipos.

const BASE = "https://api.football-data.org/v4";

// Claves de The Odds API → código de competición en football-data.org (plan gratis).
export const LEAGUE_TO_FD = {
  soccer_italy_serie_a: "SA",
  soccer_spain_la_liga: "PD",
  soccer_germany_bundesliga: "BL1",
  soccer_epl: "PL",
  soccer_efl_champ: "ELC",
  soccer_france_ligue_one: "FL1",
  soccer_brazil_campeonato: "BSA",
  soccer_uefa_champs_league: "CL",
};
export const FD_COMPETITIONS = Object.values(LEAGUE_TO_FD);

export const hasFootballData = () => Boolean(process.env.FOOTBALL_DATA_API_KEY);

async function fdGet(path, revalidate) {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(BASE + path, { headers: { "X-Auth-Token": key }, next: { revalidate } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Todos los partidos de la temporada actual (jugados y por jugar).
export async function getCompetitionMatches(code) {
  const j = await fdGet(`/competitions/${code}/matches`, 6 * 3600);
  if (!j?.matches) return null;
  return { code, name: j.competition?.name || code, matches: j.matches };
}

export async function getHead2Head(matchId) {
  return fdGet(`/matches/${matchId}/head2head?limit=10`, 24 * 3600);
}

// ---------- Emparejar nombres (The Odds API y football-data no los escriben igual) ----------

const STOP = new Set([
  "fc", "cf", "afc", "ac", "as", "ssc", "sc", "calcio", "club", "cd", "ud", "rcd", "sd", "sv", "vfb",
  "vfl", "tsg", "fsv", "bv", "bsc", "rc", "ogc", "us", "de", "the", "and", "ec", "se", "cr",
  "esporte", "clube", "futebol", "football", "foot", "sport", "sporting", "fk", "sk", "1",
]);

const ALIASES = {
  "athletic bilbao": "athletic club",
  "inter milan": "inter",
  "internazionale": "inter",
  "ac milan": "milan",
  "paris saint germain": "psg",
  "bayern munich": "bayern",
  "wolverhampton wanderers": "wolves",
  "atletico madrid": "atletico",
};

function norm(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s) {
  let n = norm(s);
  n = ALIASES[n] || n;
  return n.split(" ").filter(t => t && !STOP.has(t) && !/^\d{2,4}$/.test(t));
}

function tokMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

function nameScore(query, team) {
  const q = tokens(query);
  if (!q.length) return 0;
  let best = 0;
  for (const cand of [team.name, team.shortName, team.tla]) {
    const t = tokens(cand);
    if (!t.length) continue;
    const hits = q.filter(x => t.some(y => tokMatch(x, y))).length;
    best = Math.max(best, hits / Math.max(q.length, t.length));
  }
  if (team.tla && norm(query) === norm(team.tla)) best = 1;
  return best;
}

export function findTeam(query, matches) {
  const teams = new Map();
  for (const m of matches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id) teams.set(t.id, t);
  let best = null, score = 0;
  for (const t of teams.values()) {
    const s = nameScore(query, t);
    if (s > score) { score = s; best = t; }
  }
  return score >= 0.5 ? best : null;
}

// Busca la competición donde están los dos equipos (prueba primero la indicada).
export async function findMatchup(home, away, preferred) {
  const order = preferred ? [preferred, ...FD_COMPETITIONS.filter(c => c !== preferred)] : FD_COMPETITIONS;
  for (const code of order) {
    const comp = await getCompetitionMatches(code);
    if (!comp) continue;
    const h = findTeam(home, comp.matches), a = findTeam(away, comp.matches);
    if (h && a && h.id !== a.id) return { comp, home: h, away: a };
  }
  return null;
}
