// Modelo de probabilidad a partir de resultados reales (sin red).
// 1) Fuerza de ataque y defensa de cada equipo, en casa y fuera, con más peso
//    a los partidos recientes.
// 2) Ajuste por forma (puntos en los últimos 5).
// 3) Goles esperados → distribución de Poisson (con corrección Dixon-Coles
//    para marcadores bajos) → probabilidades de cada mercado.

const DECAY = 0.92;   // cada partido más antiguo pesa un 8 % menos
const PRIOR = 3;      // partidos "ficticios" de media de liga (evita extremos con pocos datos)
const FORM_WEIGHT = 0.08; // la forma mueve los goles esperados hasta ±8 %
const RHO = -0.08;    // Dixon-Coles
const MAX_GOALS = 10;

const finished = m => m.status === "FINISHED" && m.score?.fullTime?.home != null;
const byDate = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);

function teamMatches(matches, id) {
  return matches.filter(m => finished(m) && (m.homeTeam.id === id || m.awayTeam.id === id)).sort(byDate);
}

function resultFor(m, id) {
  const { home, away } = m.score.fullTime;
  const isHome = m.homeTeam.id === id;
  const gf = isHome ? home : away, ga = isHome ? away : home;
  return { gf, ga, r: gf > ga ? "W" : gf === ga ? "D" : "L", isHome, m };
}

// Media ponderada (recientes pesan más) con "prior" hacia la media de la liga.
function weighted(list, pick, prior) {
  let sw = 0, sv = 0;
  list.forEach((x, i) => {
    const w = Math.pow(DECAY, list.length - 1 - i);
    sw += w; sv += w * pick(x);
  });
  return (sv + PRIOR * prior) / (sw + PRIOR);
}

export function teamSummary(matches, id) {
  const all = teamMatches(matches, id).map(m => resultFor(m, id));
  const last5 = all.slice(-5);
  const home = all.filter(x => x.isHome), away = all.filter(x => !x.isHome);
  const avg = (l, f) => (l.length ? +(l.reduce((s, x) => s + f(x), 0) / l.length).toFixed(2) : null);
  return {
    played: all.length,
    form: last5.map(x => x.r),                       // más antiguo → más reciente
    formPoints: last5.reduce((s, x) => s + (x.r === "W" ? 3 : x.r === "D" ? 1 : 0), 0),
    wins5: last5.filter(x => x.r === "W").length,
    lastResults: last5.map(x => ({
      date: x.m.utcDate.slice(0, 10),
      rival: x.isHome ? x.m.awayTeam.shortName || x.m.awayTeam.name : x.m.homeTeam.shortName || x.m.homeTeam.name,
      where: x.isHome ? "casa" : "fuera",
      score: `${x.gf}-${x.ga}`,
      r: x.r,
    })).reverse(),
    goalsScored: avg(all, x => x.gf),
    goalsConceded: avg(all, x => x.ga),
    home: { n: home.length, gf: avg(home, x => x.gf), ga: avg(home, x => x.ga), wins: home.filter(x => x.r === "W").length },
    away: { n: away.length, gf: avg(away, x => x.gf), ga: avg(away, x => x.ga), wins: away.filter(x => x.r === "W").length },
    cleanSheets: all.filter(x => x.ga === 0).length,
    bttsRate: all.length ? all.filter(x => x.gf > 0 && x.ga > 0).length / all.length : null,
    _all: all,
  };
}

function leagueAverages(matches) {
  const f = matches.filter(finished);
  if (f.length < 10) return { home: 1.5, away: 1.2 };
  const h = f.reduce((s, m) => s + m.score.fullTime.home, 0) / f.length;
  const a = f.reduce((s, m) => s + m.score.fullTime.away, 0) / f.length;
  return { home: h, away: a };
}

function poisson(k, l) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

function tau(h, a, lh, la) {
  if (h === 0 && a === 0) return 1 - lh * la * RHO;
  if (h === 0 && a === 1) return 1 + lh * RHO;
  if (h === 1 && a === 0) return 1 + la * RHO;
  if (h === 1 && a === 1) return 1 - RHO;
  return 1;
}

// Goles esperados de cada equipo.
export function expectedGoals(matches, homeId, awayId) {
  const L = leagueAverages(matches);
  const H = teamSummary(matches, homeId), A = teamSummary(matches, awayId);
  const hHome = H._all.filter(x => x.isHome), aAway = A._all.filter(x => !x.isHome);

  const homeAtt = weighted(hHome, x => x.gf, L.home) / L.home;
  const homeDef = weighted(hHome, x => x.ga, L.away) / L.away;
  const awayAtt = weighted(aAway, x => x.gf, L.away) / L.away;
  const awayDef = weighted(aAway, x => x.ga, L.home) / L.home;

  const formAdj = s => 1 + FORM_WEIGHT * ((s.played ? s.formPoints / (3 * Math.min(5, s.played)) : 0.5) - 0.5) * 2;
  const lh = L.home * homeAtt * awayDef * formAdj(H) / Math.sqrt(formAdj(A));
  const la = L.away * awayAtt * homeDef * formAdj(A) / Math.sqrt(formAdj(H));
  return { lh: Math.max(0.15, lh), la: Math.max(0.1, la), H, A, L };
}

export function marketProbabilities(lh, la) {
  const grid = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poisson(h, lh) * poisson(a, la) * tau(h, a, lh, la);
      grid.push({ h, a, p });
      total += p;
    }
  }
  grid.forEach(g => (g.p /= total));
  const sum = f => grid.filter(f).reduce((s, g) => s + g.p, 0);
  const over = line => sum(g => g.h + g.a > line);
  const homeWin = sum(g => g.h > g.a), draw = sum(g => g.h === g.a), awayWin = sum(g => g.h < g.a);
  return {
    homeWin, draw, awayWin,
    homeOrDraw: homeWin + draw, awayOrDraw: awayWin + draw, homeOrAway: homeWin + awayWin,
    over: { 0.5: over(0.5), 1.5: over(1.5), 2.5: over(2.5), 3.5: over(3.5), 4.5: over(4.5) },
    btts: sum(g => g.h > 0 && g.a > 0),
    cleanSheetHome: sum(g => g.a === 0),
    cleanSheetAway: sum(g => g.h === 0),
    homeOver: { 0.5: sum(g => g.h > 0.5), 1.5: sum(g => g.h > 1.5) },
    awayOver: { 0.5: sum(g => g.a > 0.5), 1.5: sum(g => g.a > 1.5) },
    exactScores: [...grid].sort((x, y) => y.p - x.p).slice(0, 6).map(g => ({ score: `${g.h}-${g.a}`, p: g.p })),
  };
}

// Lista de apuestas posibles ordenadas por probabilidad, con su cuota "justa".
export function rankedOptions(P, homeName, awayName) {
  const o = [
    [`Gana ${homeName}`, P.homeWin],
    ["Empate", P.draw],
    [`Gana ${awayName}`, P.awayWin],
    [`Doble oportunidad: ${homeName} o Empate`, P.homeOrDraw],
    [`Doble oportunidad: ${awayName} o Empate`, P.awayOrDraw],
    [`Doble oportunidad: ${homeName} o ${awayName}`, P.homeOrAway],
    ["Ambos marcan: Sí", P.btts],
    ["Ambos marcan: No", 1 - P.btts],
    [`${homeName} marca`, P.homeOver[0.5]],
    [`${awayName} marca`, P.awayOver[0.5]],
    [`${homeName} más de 1.5 goles`, P.homeOver[1.5]],
    [`${awayName} más de 1.5 goles`, P.awayOver[1.5]],
  ];
  for (const l of [1.5, 2.5, 3.5]) {
    o.push([`Más de ${l} goles`, P.over[l]]);
    o.push([`Menos de ${l} goles`, 1 - P.over[l]]);
  }
  return o
    .map(([label, p]) => ({ label, prob: +(p * 100).toFixed(1), fairOdd: +(1 / p).toFixed(2) }))
    .sort((a, b) => b.prob - a.prob);
}

// Probabilidad del modelo para una selección de la combinada (formato de combos.js).
export function modelProbForPick(P, c, homeTeamName, awayTeamName) {
  const { market, name, point } = c._raw || {};
  if (market === "h2h") {
    if (name === "Draw") return P.draw;
    if (name === homeTeamName) return P.homeWin;
    if (name === awayTeamName) return P.awayWin;
  }
  if (market === "totals" && P.over[point] != null) return name === "Over" ? P.over[point] : 1 - P.over[point];
  if (market === "btts") return name === "Yes" ? P.btts : 1 - P.btts;
  if (market === "double_chance") {
    const hasH = name.includes(homeTeamName), hasA = name.includes(awayTeamName), hasD = /\bDraw\b/.test(name);
    if (hasH && hasD) return P.homeOrDraw;
    if (hasA && hasD) return P.awayOrDraw;
    if (hasH && hasA) return P.homeOrAway;
  }
  return null;
}
