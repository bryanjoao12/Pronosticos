# ⚽ Match Predictor

Dos herramientas en una página:

- **🧮 Combinada del día**: toma cuotas reales de varias casas (The Odds API) para los partidos de las próximas 36 h, les quita el margen para estimar la probabilidad real de cada resultado y arma la combinada **más probable** de 5+ partidos que llegue a la cuota objetivo (20 por defecto). Muestra 3 opciones, la probabilidad de acertar y el valor esperado.
- **⚡ Analizar partido**: análisis de un partido con Gemini + Google Search (forma, lesionados, H2H, goles, córners, tarjetas).

> Proyecto educativo. Una cuota 20 acierta, como mucho, ~1 de cada 20 veces, y el valor esperado casi siempre es negativo por el margen de las casas. No es asesoría de apuestas.

## 🔑 API keys (ambas gratis)

| Variable | Dónde | Para qué |
|---|---|---|
| `ODDS_API_KEY` | [the-odds-api.com](https://the-odds-api.com) (plan Starter, 500 créditos/mes) | Cuotas reales |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Análisis con IA |

**Consumo de créditos**: cada liga con partidos ese día gasta 2 créditos (goles y 1X2), y la respuesta se guarda en caché 24 h. Además, córners, tarjetas, ambos marcan y doble oportunidad se piden partido a partido: 6 créditos por partido, para los `ODDS_EXTRA_EVENTS` partidos más importantes del día (1 por defecto, pensado para el plan gratis). Con 6 partidos serían ~60 créditos al día (~1.800/mes), solo viable con plan de pago. Para gastar menos, limita las ligas con `ODDS_LEAGUES`. Si quedan menos de 60 créditos, los mercados extra se desactivan solos.

## Desarrollo local

```bash
cp .env.example .env.local   # y pega tus keys
npm install
npm run dev                  # http://localhost:3000
```

## Deploy en Vercel

```bash
git add .
git commit -m "Combinada del día + fixes"
git push
```

En Vercel → tu proyecto → **Settings → Environment Variables**: agrega `ODDS_API_KEY` y `GEMINI_API_KEY`, y vuelve a desplegar.

## Cómo funciona la combinada

1. Para cada partido y mercado (1X2 y más/menos goles) promedia la probabilidad sin margen de 3+ casas.
2. Descarta selecciones con cuota fuera de 1.30–2.50 o probabilidad < 42 %.
3. Busca la combinación de partidos distintos con cuota total entre el 90 % y el 115 % del objetivo que maximiza la probabilidad combinada.
4. Las opciones 2 y 3 comparten como máximo 2 selecciones con las anteriores.
