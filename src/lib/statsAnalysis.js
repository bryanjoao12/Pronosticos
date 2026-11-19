// Análisis de un partido con resultados reales (football-data.org) y el modelo
// de model.js. Devuelve el mismo formato que usaba el análisis con IA.
import { findMatchup, getHead2Head } from "./footballData";
import { expectedGoals, marketProbabilities, rankedOptions } from "./model";

const pct = p => Math.round(p * 100);
const RES = { W: "G", D: "E", L: "P" };

function teamBlock(s) {
  return {
    form: s.form,
    goalsScored: s.goalsScored,
    goalsConceded: s.goalsConceded,
    avgCorners: null,
    avgYellowCards: null,
    avgRedCards: null,
    possession: null,
    injuries: [],
    suspensions: [],
    keyPlayers: [],
    lastResults: s.lastResults,
    home: s.home,
    away: s.away,
    played: s.played,
  };
}

// La "mejor apuesta": la más probable que todavía pague algo (cuota justa ≥ 1.30).
function bestBet(options) {
  return options.find(o => o.fairOdd >= 1.3) || options[0];
}

export async function statsAnalysis(homeQuery, awayQuery, preferredComp) {
  const found = await findMatchup(homeQuery, awayQuery, preferredComp);
  if (!found) return null;
  const { comp, home, away } = found;
  const homeName = home.shortName || home.name, awayName = away.shortName || away.name;

  const { lh, la, H, A } = expectedGoals(comp.matches, home.id, away.id);
  if (H.played < 3 || A.played < 3) return null; // muy pocos datos esta temporada
  const P = marketProbabilities(lh, la);
  const options = rankedOptions(P, homeName, awayName);
  const best = bestBet(options);

  // Próximo partido entre ambos (para fecha y H2H).
  const next = comp.matches
    .filter(m => m.status !== "FINISHED" && m.homeTeam.id === home.id && m.awayTeam.id === away.id)
    .sort((x, y) => new Date(x.utcDate) - new Date(y.utcDate))[0];

  let headToHead = { matches: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 0, lastResults: [] };
  if (next) {
    const h2h = await getHead2Head(next.id);
    const ms = (h2h?.matches || []).filter(m => m.status === "FINISHED" && m.score?.fullTime?.home != null);
    if (ms.length) {
      let hw = 0, d = 0, aw = 0, goals = 0;
      for (const m of ms) {
        const { home: gh, away: ga } = m.score.fullTime;
        goals += gh + ga;
        const homeGoals = m.homeTeam.id === home.id ? gh : ga, awayGoals = m.homeTeam.id === home.id ? ga : gh;
        if (homeGoals > awayGoals) hw++; else if (homeGoals === awayGoals) d++; else aw++;
      }
      headToHead = {
        matches: ms.length, homeWins: hw, draws: d, awayWins: aw,
        avgGoals: +(goals / ms.length).toFixed(1),
        lastResults: ms.slice(0, 5).map(m => `${m.homeTeam.shortName || m.homeTeam.name} ${m.score.fullTime.home}-${m.score.fullTime.away} ${m.awayTeam.shortName || m.awayTeam.name}`),
      };
    }
  }

  const r1x2 = [[`Gana ${homeName}`, P.homeWin], ["Empate", P.draw], [`Gana ${awayName}`, P.awayWin]]
    .sort((a, b) => b[1] - a[1])[0];
  const conf = pct(best.prob / 100);
  const risk = conf >= 70 ? "Bajo" : conf >= 55 ? "Medio" : "Alto";

  const formTxt = s => s.form.map(r => RES[r]).join(" ");
  const keyFactors = [
    `${homeName}: ${H.wins5} de ${H.form.length} ganados (${formTxt(H)})`,
    `${awayName}: ${A.wins5} de ${A.form.length} ganados (${formTxt(A)})`,
    `${homeName} en casa: ${H.home.gf ?? "-"} goles a favor y ${H.home.ga ?? "-"} en contra por partido`,
    `${awayName} fuera: ${A.away.gf ?? "-"} goles a favor y ${A.away.ga ?? "-"} en contra por partido`,
    `Goles esperados: ${homeName} ${lh.toFixed(2)} · ${awayName} ${la.toFixed(2)}`,
  ];
  if (headToHead.matches) keyFactors.push(`H2H últimos ${headToHead.matches}: ${headToHead.homeWins}-${headToHead.draws}-${headToHead.awayWins}`);

  const summary =
    `${homeName} llega con ${H.formPoints} de ${3 * H.form.length} puntos en sus últimos ${H.form.length} partidos y ` +
    `${awayName} con ${A.formPoints} de ${3 * A.form.length}. Con lo que marca y recibe cada uno esta temporada ` +
    `(en casa y fuera), el modelo espera ${lh.toFixed(1)} goles de ${homeName} y ${la.toFixed(1)} de ${awayName}. ` +
    `La opción más probable que todavía paga algo es "${best.label}" (${best.prob}%, cuota justa ${best.fairOdd}): ` +
    `si la casa paga más que eso, tiene valor.`;

  return {
    source: "stats",
    matchup: {
      home: homeName, away: awayName, league: comp.name,
      date: next ? new Date(next.utcDate).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }) : "Próximo partido",
    },
    homeTeam: teamBlock(H),
    awayTeam: teamBlock(A),
    headToHead,
    probabilities: {
      homeWin: pct(P.homeWin), draw: pct(P.draw), awayWin: pct(P.awayWin),
      over15Goals: pct(P.over[1.5]), over25Goals: pct(P.over[2.5]), over35Goals: pct(P.over[3.5]),
      btts: pct(P.btts), cleanSheetHome: pct(P.cleanSheetHome), cleanSheetAway: pct(P.cleanSheetAway),
      corners: null, cards: null,
      exactScores: P.exactScores.map(s => ({ score: s.score, prob: pct(s.p) })),
    },
    options,
    expectedGoals: { home: +lh.toFixed(2), away: +la.toFixed(2) },
    verdict: {
      prediction: `${r1x2[0]} (${pct(r1x2[1])}%)`,
      confidence: conf,
      bestBet: `${best.label} · ${best.prob}% · cuota justa ${best.fairOdd}`,
      keyFactors,
      riskLevel: risk,
      summary,
    },
  };
}
