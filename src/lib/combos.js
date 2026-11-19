// Lógica pura (sin red) para construir combinadas a partir de cuotas reales.
// Entrada: eventos con el formato de The Odds API v4 (markets h2h y totals).

const MIN_BOOKMAKERS = 3;
// Córners, tarjetas y demás los ofrecen menos casas.
const MIN_BOOKS_BY_MARKET = { alternate_totals_corners: 2, alternate_totals_cards: 2, btts: 2, double_chance: 2 };
const MARKETS = new Set(["h2h", "totals", "btts", "double_chance", "alternate_totals_corners", "alternate_totals_cards"]);
const LINE_MARKETS = new Set(["totals", "alternate_totals_corners", "alternate_totals_cards"]);

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Quita el margen de la casa: convierte cuotas en probabilidades que suman 1.
// En doble oportunidad (1X, 12, X2) cada resultado cubre 2 de 3: suman 2.
function devig(outcomes, sumTo = 1) {
  const inv = outcomes.map(o => 1 / o.price);
  const total = inv.reduce((a, b) => a + b, 0);
  return outcomes.map((o, i) => ({ ...o, prob: Math.min(0.99, (inv[i] / total) * sumTo) }));
}

function outcomeKey(marketKey, o) {
  return LINE_MARKETS.has(marketKey) ? `${o.name} ${o.point}` : o.name;
}

function labelFor(marketKey, name, point, ev) {
  if (marketKey === "h2h") {
    if (name === "Draw") return "Empate";
    return `Gana ${name}`;
  }
  const line = unit => (name === "Over" ? `Más de ${point} ${unit}` : `Menos de ${point} ${unit}`);
  if (marketKey === "totals") return line("goles");
  if (marketKey === "alternate_totals_corners") return line("córners");
  if (marketKey === "alternate_totals_cards") return line("tarjetas");
  if (marketKey === "btts") return name === "Yes" ? "Ambos marcan: Sí" : "Ambos marcan: No";
  if (marketKey === "double_chance") {
    const t = name.replace(/\bDraw\b/g, "Empate").replace(/\s*(\/|\bor\b)\s*/g, " o ");
    return `Doble oportunidad: ${t}`;
  }
  return name;
}

// Convierte cada evento en una lista de "selecciones" posibles con
// probabilidad de consenso (promedio de casas sin margen) y cuotas.
export function buildCandidates(events, { now = Date.now(), minOdd = 1.3, maxOdd = 2.5, minProb = 0.42 } = {}) {
  const candidates = [];

  for (const ev of events) {
    const start = new Date(ev.commence_time).getTime();
    if (!(start > now + 10 * 60 * 1000)) continue; // ya empezó o empieza en <10 min

    const agg = {}; // key -> { marketKey, name, point, probs:[], prices:[] }
    for (const bm of ev.bookmakers || []) {
      for (const m of bm.markets || []) {
        if (!MARKETS.has(m.key)) continue;
        if (!m.outcomes || m.outcomes.length < 2) continue;
        if (m.outcomes.some(o => !(o.price > 1))) continue;
        // En totales cada casa puede ofrecer varias líneas: agrupar por línea
        // y quedarse con una cuota por resultado (algunas casas lo repiten).
        const groups = {};
        for (const o of m.outcomes) {
          const g = LINE_MARKETS.has(m.key) ? String(o.point) : "x";
          const grp = (groups[g] ||= []);
          if (!grp.some(x => x.name === o.name)) grp.push(o);
        }
        for (const outs of Object.values(groups)) {
          if (outs.length < 2) continue;
          const sumTo = m.key === "double_chance" && outs.length === 3 ? 2 : 1;
          for (const o of devig(outs, sumTo)) {
            const k = `${m.key}|${outcomeKey(m.key, o)}`;
            agg[k] ||= { marketKey: m.key, name: o.name, point: o.point, probs: [], prices: [] };
            agg[k].probs.push(o.prob);
            agg[k].prices.push(o.price);
          }
        }
      }
    }

    for (const a of Object.values(agg)) {
      if (a.probs.length < (MIN_BOOKS_BY_MARKET[a.marketKey] ?? MIN_BOOKMAKERS)) continue;
      const prob = avg(a.probs);
      const odd = avg(a.prices);
      const best = Math.max(...a.prices);
      if (odd < minOdd || odd > maxOdd || prob < minProb) continue;
      candidates.push({
        id: `${ev.id}|${a.marketKey}|${a.name}|${a.point ?? ""}`,
        eventId: ev.id,
        league: ev.sport_title,
        sportKey: ev.sport_key,
        _raw: { market: a.marketKey, name: a.name, point: a.point },
        home: ev.home_team,
        away: ev.away_team,
        start: ev.commence_time,
        market: a.marketKey,
        pick: labelFor(a.marketKey, a.name, a.point, ev),
        prob: +prob.toFixed(4),
        odd: +odd.toFixed(2),
        bestOdd: +best.toFixed(2),
        books: a.probs.length,
      });
    }
  }
  return candidates;
}

// Busca combinadas de minLegs..maxLegs partidos distintos cuya cuota total
// quede en [lo, hi], maximizando la probabilidad combinada.
export function findCombos(candidates, {
  target = 20, lo = 18, hi = 23, minLegs = 5, maxLegs = 7, howMany = 3, maxOverlap = 2, poolSize = 26,
} = {}) {
  // Pool: las 3 mejores selecciones (por probabilidad) de cada partido, y de
  // ahí las más probables de cada rango de cuota. Si solo se toman las más
  // probables, todas tienen cuota ~1.3-1.5 y nunca se llega al objetivo.
  const byEvent = {};
  for (const c of candidates) (byEvent[c.eventId] ||= []).push(c);
  let all = [];
  for (const list of Object.values(byEvent)) {
    list.sort((a, b) => b.prob - a.prob);
    all.push(...list.slice(0, 3));
  }
  all.sort((a, b) => b.prob - a.prob);
  const bands = [[0, 1.6], [1.6, 2.0], [2.0, Infinity]];
  const perBand = Math.ceil(poolSize / bands.length);
  let pool = bands.flatMap(([a, b]) => all.filter(c => c.odd >= a && c.odd < b).slice(0, perBand));
  pool.sort((a, b) => a.odd - b.odd); // ascendente para poder podar

  const chosen = [];

  for (let run = 0; run < howMany; run++) {
    let best = null;
    const stack = [];
    const usedEvents = new Set();

    const dfs = (startIdx, product, probProd) => {
      const n = stack.length;
      if (n >= minLegs && product >= lo && product <= hi) {
        const overlapsOk = chosen.every(c => c.legs.filter(l => stack.includes(l)).length <= maxOverlap);
        if (overlapsOk) {
          const score = probProd - Math.abs(Math.log(product / target)) * 0.002;
          if (!best || score > best.score) best = { score, legs: [...stack], product, probProd };
        }
      }
      if (n >= maxLegs) return;
      for (let i = startIdx; i < pool.length; i++) {
        const c = pool[i];
        const next = product * c.odd;
        if (next > hi) break; // pool ordenado: el resto es aún mayor
        // Poda: aunque se completen las patas restantes con la mayor cuota, ¿se llega a lo?
        const remaining = maxLegs - n - 1;
        const maxOdd = pool[pool.length - 1].odd;
        if (next * Math.pow(maxOdd, remaining) < lo) continue;
        if (usedEvents.has(c.eventId)) continue;
        usedEvents.add(c.eventId);
        stack.push(c);
        dfs(i + 1, next, probProd * c.prob);
        stack.pop();
        usedEvents.delete(c.eventId);
      }
    };

    dfs(0, 1, 1);
    if (!best) break;
    chosen.push(best);
  }

  return chosen.map(c => {
    const legs = [...c.legs].sort((a, b) => new Date(a.start) - new Date(b.start));
    const totalOdd = +legs.reduce((p, l) => p * l.odd, 1).toFixed(2);
    const totalBest = +legs.reduce((p, l) => p * l.bestOdd, 1).toFixed(2);
    const prob = legs.reduce((p, l) => p * l.prob, 1);
    return {
      legs,
      totalOdd,
      totalBestOdd: totalBest,
      probability: +(prob * 100).toFixed(2), // %
      expectedValue: +((prob * totalOdd - 1) * 100).toFixed(1), // % por cada apuesta
    };
  });
}
