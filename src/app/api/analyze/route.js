import { statsAnalysis } from "../../../lib/statsAnalysis";
import { hasFootballData, LEAGUE_TO_FD } from "../../../lib/footballData";

export const maxDuration = 60;

const PROMPT_TEMPLATE = (home, away) => `
Eres un analista deportivo experto. Busca con Google información REAL y ACTUAL sobre el partido ${home} vs ${away}.
Investiga: forma reciente de ambos equipos, lesionados, suspendidos, estadísticas de goles/córners/tarjetas, historial H2H y noticias recientes.

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta (sin texto extra, sin markdown, sin backticks):

{
  "matchup": {
    "home": "${home}",
    "away": "${away}",
    "league": "Liga o competición detectada",
    "date": "Fecha del próximo partido o estimada"
  },
  "homeTeam": {
    "form": ["W","D","L","W","W"],
    "goalsScored": 2.1,
    "goalsConceded": 1.2,
    "avgCorners": 5.4,
    "avgYellowCards": 1.8,
    "avgRedCards": 0.1,
    "possession": 55,
    "injuries": ["Nombre (zona lesionada)"],
    "suspensions": [],
    "keyPlayers": ["Jugador 1", "Jugador 2"],
    "nextImportantMatch": "Descripción del próximo partido relevante",
    "recentNews": "Noticia o contexto importante reciente"
  },
  "awayTeam": {
    "form": ["L","W","W","D","L"],
    "goalsScored": 1.6,
    "goalsConceded": 1.5,
    "avgCorners": 4.7,
    "avgYellowCards": 2.0,
    "avgRedCards": 0.15,
    "possession": 45,
    "injuries": [],
    "suspensions": ["Nombre"],
    "keyPlayers": ["Jugador A"],
    "nextImportantMatch": "Descripción del próximo partido relevante",
    "recentNews": "Noticia o contexto importante reciente"
  },
  "headToHead": {
    "matches": 8,
    "homeWins": 3,
    "draws": 2,
    "awayWins": 3,
    "avgGoals": 2.5,
    "lastResults": ["2-1","0-0","1-2","2-2","1-0"]
  },
  "probabilities": {
    "homeWin": 42,
    "draw": 27,
    "awayWin": 31,
    "over15Goals": 75,
    "over25Goals": 52,
    "over35Goals": 29,
    "btts": 49,
    "cleanSheetHome": 30,
    "cleanSheetAway": 25,
    "corners": { "over85": 60, "over105": 35 },
    "cards": { "over25": 55, "over35": 30 },
    "exactScores": [
      {"score": "1-0", "prob": 13},
      {"score": "1-1", "prob": 12},
      {"score": "2-1", "prob": 11},
      {"score": "2-0", "prob": 9},
      {"score": "0-1", "prob": 8}
    ]
  },
  "verdict": {
    "prediction": "Resultado más probable",
    "confidence": 65,
    "bestBet": "Mercado recomendado",
    "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
    "riskLevel": "Medio",
    "summary": "Análisis narrativo de 2-3 oraciones sobre el partido."
  }
}`;

export async function POST(request) {
  const { home, away, league } = await request.json();
  if (!home || !away) {
    return Response.json({ error: "Missing teams" }, { status: 400 });
  }

  // 1) Resultados reales de football-data.org + modelo de probabilidad.
  if (hasFootballData()) {
    const stats = await statsAnalysis(home, away, LEAGUE_TO_FD[league]);
    if (stats) return Response.json(stats);
  }

  // 2) Si la liga no está en football-data.org, se usa la IA con búsqueda en Google.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "No hay datos de estos equipos (falta FOOTBALL_DATA_API_KEY o GEMINI_API_KEY)." }, { status: 500 });
  }

  // Intentos en orden: con búsqueda web y, si falla por cuota (429) o
  // saturación (503), sin búsqueda y con modelos alternativos.
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash"])];
  const attempts = [
    { model: models[0], search: true },
    ...models.map(model => ({ model, search: false })),
  ];

  let res, lastErr = "", lastStatus = 500;
  for (const { model, search } of attempts) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT_TEMPLATE(home, away) }] }],
          ...(search ? { tools: [{ googleSearch: {} }] } : {}),
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4000,
          }
        })
      }
    );
    if (res.ok) break;
    lastStatus = res.status;
    lastErr = await res.text();
    if (![429, 503, 404].includes(res.status)) break;
  }

  if (!res.ok) {
    let msg = lastErr;
    try { msg = JSON.parse(lastErr).error?.message || lastErr; } catch {}
    return Response.json({ error: `Gemini (${lastStatus}): ${msg}` }, { status: lastStatus });
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts
    ?.filter(p => p.text)
    ?.map(p => p.text)
    ?.join("") || "";

  const clean = rawText.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");

  if (start === -1 || end === -1) {
    return Response.json({ error: "No JSON found in response" }, { status: 500 });
  }

  try {
    const parsed = JSON.parse(clean.slice(start, end + 1));
    return Response.json(parsed);
  } catch {
    return Response.json({ error: "Invalid JSON from AI" }, { status: 500 });
  }
}
