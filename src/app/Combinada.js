"use client";
import { useEffect, useState } from "react";

const card = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 20 };
const mono = { fontFamily: "monospace" };

function fmtHora(isoStr) {
  try {
    return new Date(isoStr).toLocaleString("es-EC", {
      weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil",
    });
  } catch { return isoStr; }
}

function Leg({ leg, onAnalyze }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center",
      padding: "10px 0", borderBottom: "1px solid #1e293b",
    }}>
      <div>
        <div style={{ fontSize: 11, color: "#64748b", ...mono }}>{leg.league} · {fmtHora(leg.start)}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
          {leg.home} <span style={{ color: "#475569" }}>vs</span> {leg.away}
        </div>
        <div style={{ fontSize: 13, color: "#3b82f6", marginTop: 2 }}>
          🎯 {leg.pick}
          <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>
            prob. {(leg.prob * 100).toFixed(0)}% · {leg.books} casas
          </span>
        </div>
        {leg.modelProb != null && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, ...mono }}>
            forma {leg.form.home.split("").map(r => ({ W: "G", D: "E", L: "P" })[r]).join("")} vs {leg.form.away.split("").map(r => ({ W: "G", D: "E", L: "P" })[r]).join("")}
            {" · "}modelo {(leg.modelProb * 100).toFixed(0)}% · casas {(leg.marketProb * 100).toFixed(0)}%
            {leg.modelProb > 1 / leg.odd && <span style={{ color: "#00e676" }}> · con valor</span>}
          </div>
        )}
        <button onClick={() => onAnalyze(leg.home, leg.away, leg.sportKey)} style={{
          marginTop: 6, background: "none", border: "1px solid #1e3a5f", color: "#94a3b8",
          borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", ...mono,
        }}>🔍 Analizar partido</button>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#00e676", ...mono }}>{leg.odd.toFixed(2)}</div>
        <div style={{ fontSize: 10, color: "#475569" }}>mejor {leg.bestOdd.toFixed(2)}</div>
      </div>
    </div>
  );
}

export default function Combinada({ onAnalyze }) {
  const [cuota, setCuota] = useState(20);
  const [min, setMin] = useState(5);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load(c = cuota, m = min) {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/combinada?cuota=${c}&min=${m}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error");
      setData(j);
    } catch (e) {
      setError(e.message || "No se pudo cargar la combinada.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 0" }}>
      <div style={{ ...card, border: "1px solid #1e3a5f" }}>
        <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", ...mono }}>
          🧮 Combinada del día {data?.day ? `· ${data.day}` : ""}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Cuota objetivo<br />
            <input type="number" min={5} max={100} value={cuota} onChange={e => setCuota(e.target.value)}
              style={{ marginTop: 4, width: 90, background: "#020817", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 10px", color: "#f1f5f9" }} />
          </label>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Mínimo de partidos<br />
            <input type="number" min={3} max={8} value={min} onChange={e => setMin(e.target.value)}
              style={{ marginTop: 4, width: 90, background: "#020817", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 10px", color: "#f1f5f9" }} />
          </label>
          <button onClick={() => load()} disabled={loading} style={{
            background: loading ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #3b82f6)", border: "none",
            borderRadius: 8, color: "#fff", padding: "10px 16px", fontWeight: 700, cursor: loading ? "wait" : "pointer", ...mono,
          }}>{loading ? "Calculando..." : "⚡ Generar"}</button>
        </div>
        <p style={{ fontSize: 12, color: "#475569", marginTop: 12, lineHeight: 1.6 }}>
          Usa cuotas reales de varias casas para las próximas 36 h (o los próximos días si hoy hay pocos partidos). Les quita el margen para estimar la
          probabilidad de cada resultado y elige la combinación más probable que llegue a la cuota objetivo.
        </p>
      </div>

      {error && (
        <div style={{ marginTop: 12, background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: 12, fontSize: 13, color: "#fca5a5", textAlign: "center" }}>
          {error}
        </div>
      )}

      {!loading && data && data.combos.length === 0 && (
        <div style={{ ...card, marginTop: 16, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Hoy no hay suficientes partidos con cuotas para armar una combinada así
          ({data.eventsAnalyzed} partidos revisados). Prueba con menos partidos o otra cuota.
        </div>
      )}

      {!loading && data?.extended && (
        <div style={{ ...card, marginTop: 16, textAlign: "center", color: "#fbbf24", fontSize: 13 }}>
          Hoy hay pocos partidos: se incluyen partidos de los próximos días.
        </div>
      )}

      {data?.combos.map((c, i) => (
        <div key={i} style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", ...mono }}>OPCIÓN {i + 1} · {c.legs.length} partidos</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#f1f5f9", ...mono }}>@ {c.totalOdd.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: "#475569" }}>con las mejores cuotas: @ {c.totalBestOdd.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#64748b", ...mono }}>PROB. DE ACERTAR</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: "#ffeb3b", ...mono }}>{c.probability}%</div>
              <div style={{ fontSize: 11, color: c.expectedValue < 0 ? "#f87171" : "#00e676" }}>
                Valor esperado: {c.expectedValue > 0 ? "+" : ""}{c.expectedValue}% por apuesta
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {c.legs.map(l => <Leg key={l.id} leg={l} onAnalyze={onAnalyze} />)}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 10, lineHeight: 1.6 }}>
            📚 En 100 días como hoy, esta combinada acertaría unas {Math.round(c.probability)} veces.
          </div>
        </div>
      ))}

      {data && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 14, ...mono }}>
          {data.eventsAnalyzed} partidos · {data.candidates} selecciones posibles
          {data.creditsRemaining != null ? ` · créditos Odds API restantes: ${data.creditsRemaining}` : ""}
        </div>
      )}
    </div>
  );
}
