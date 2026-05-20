import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import "./styles.css";

const SUPABASE_URL = "https://pwjatxqtkvwcmzmjjvbi.supabase.co";
const SUPABASE_KEY = "sb_publishable_bUPTDkrOzc0_I3xwNw15aA_lk76gg4w";

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const STATUS_LIST = ["AG CHEGADA", "PATIO", "SEPARANDO", "CARREGANDO", "EM FATURAMENTO", "EXPEDIDO", "NO SHOW", "VEICULO RECUSADO", "MOTORISTA FOI EMBORA"];
const EXPEDIDO_STATUS = ["EXPEDIDO", "NO SHOW", "VEICULO RECUSADO", "MOTORISTA FOI EMBORA"];
const FATURAMENTO_STATUS = ["OK", "CADASTRO OTM", "CUSTO DE FRETE", "PROBLEMAS JSL", "TROCA DE DT", "TNF", "AJUSTE FISCAL", "ERRO DE REMESSA"];

export default function WMS() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("ativas");
  const [filterText, setFilterText] = useState("");
  const [now, setNow] = useState(new Date());
  const wsRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const loadData = async () => {
    const agenda = await supaFetch("/agenda_importada?select=*&order=inicio_agenda.asc");
    const opRows = await supaFetch("/operacional?select=*");
    const sap = await supaFetch("/zles002?select=*");

    const opMap = Object.fromEntries(opRows.map((r) => [r.dt, r]));
    const sapMap = {};
    sap.forEach((s) => {
      if (!sapMap[s.numero_transporte]) sapMap[s.numero_transporte] = [];
      sapMap[s.numero_transporte].push(s);
    });

    setRows(
      agenda.map((a) => {
        const op = opMap[a.dt] || {};
        const sapItems = sapMap[a.dt] || [];
        return {
          dt: a.dt,
          dia: a.inicio_agenda ? new Date(a.inicio_agenda).toLocaleDateString("pt-BR") : "",
          transportadora: a.transportadora || "",
          hora_chegada: a.inicio_agenda ? new Date(a.inicio_agenda).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "",
          status: op.status || "AG CHEGADA",
          faturamento: op.faturamento || "",
          peso_liquido: sapItems.reduce((acc, s) => acc + parseFloat(s.peso || 0), 0),
        };
      })
    );
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const ws = new WebSocket(`wss://pwjatxqtkvwcmzmjjvbi.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ topic: "realtime:public:operacional", event: "phx_join", payload: { config: { broadcast: { self: false }, postgres_changes: [{ event: "*", schema: "public", table: "operacional" }] } }, ref: "1" }));
    ws.onmessage = () => loadData();
    return () => ws.close();
  }, []);

  const displayRows = rows
    .filter((r) => (tab === "ativas" ? !EXPEDIDO_STATUS.includes(r.status) : EXPEDIDO_STATUS.includes(r.status)))
    .filter((r) => !filterText || r.dt.includes(filterText) || r.transportadora.toLowerCase().includes(filterText.toLowerCase()));

  return (
    <div className="app">
      <header className="header">
        <h1>WMS LOGÍSTICA</h1>
        <span>{now.toLocaleString("pt-BR")}</span>
      </header>

      <div className="toolbar">
        <div>
          <button className={tab === "ativas" ? "active" : ""} onClick={() => setTab("ativas")}>ATIVAS</button>
          <button className={tab === "expedidas" ? "active" : ""} onClick={() => setTab("expedidas")}>EXPEDIDAS</button>
        </div>
        <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filtrar DT / Transportadora..." />
      </div>

      <table>
        <thead>
          <tr>
            <th>DIA</th><th>DT</th><th>TRANSPORTADORA</th><th>CHEGADA</th><th>STATUS</th><th>FATURAMENTO</th><th>PESO (kg)</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => (
            <tr key={row.dt}>
              <td>{row.dia}</td><td>{row.dt}</td><td>{row.transportadora}</td><td>{row.hora_chegada}</td>
              <td>
                <select value={row.status} readOnly>
                  {STATUS_LIST.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <select value={row.faturamento} readOnly>
                  <option value="">—</option>
                  {FATURAMENTO_STATUS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
              <td>{row.peso_liquido?.toLocaleString("pt-BR") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
