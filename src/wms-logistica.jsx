import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";

// ─── SUPABASE CONFIG ────────────────────────────────────────────────────────
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const STATUS_LIST = [
  "AG CHEGADA","PATIO","SEPARANDO","CARREGANDO",
  "EM FATURAMENTO","EXPEDIDO","NO SHOW","VEICULO RECUSADO","MOTORISTA FOI EMBORA",
];
const EXPEDIDO_STATUS = ["EXPEDIDO","NO SHOW","VEICULO RECUSADO","MOTORISTA FOI EMBORA"];
const FATURAMENTO_STATUS = ["OK","CADASTRO OTM","CUSTO DE FRETE","PROBLEMAS JSL","TROCA DE DT","TNF","AJUSTE FISCAL","ERRO DE REMESSA"];

const roundTon = (kg) => {
  const ton = kg / 1000;
  return Math.round(ton * 10) / 10;
};
const fmt = (n) => (isNaN(n) ? "0" : Math.round(n).toString());

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function WMS() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("ativas");
  const [modal, setModal] = useState(null); // 'import-agenda'|'import-sap'|'manual'|'pdf'|'logs'
  const [logs, setLogs] = useState([]);
  const [preFatura, setPreFatura] = useState("");
  const [now, setNow] = useState(new Date());
  const [importStep, setImportStep] = useState(1);
  const [importing, setImporting] = useState(false);
  const [pdfFiles, setPdfFiles] = useState([]);
  const [pdfName, setPdfName] = useState("merged");
  const [manualDt, setManualDt] = useState("");
  const [manualTransp, setManualTransp] = useState("");
  const [toast, setToast] = useState(null);
  const [filterText, setFilterText] = useState("");
  const wsRef = useRef(null);
  const channelRef = useRef(null);

  // Tick clock every minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === "m") { e.preventDefault(); setModal("manual"); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); setModal("pdf"); }
      if (e.ctrlKey && e.key === "o") { e.preventDefault(); loadLogs(); setModal("logs"); }
      if (e.ctrlKey && e.key === "d") { e.preventDefault(); setImportStep(1); setModal("import-agenda"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load data on mount
  useEffect(() => { loadData(); }, []);

  // Supabase Realtime via WebSocket
  useEffect(() => {
    const wsUrl = `wss://pwjatxqtkvwcmzmjjvbi.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      const join = {
        topic: "realtime:public:operacional",
        event: "phx_join",
        payload: { config: { broadcast: { self: false }, postgres_changes: [{ event: "*", schema: "public", table: "operacional" }] } },
        ref: "1",
      };
      ws.send(JSON.stringify(join));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.event === "postgres_changes" || data.payload?.type === "UPDATE" || data.payload?.type === "INSERT") {
          loadData();
        }
      } catch {}
    };

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
    }, 25000);

    return () => { clearInterval(hb); ws.close(); };
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    try {
      // Join agenda + operacional + zles002
      const agenda = await supaFetch("/agenda_importada?select=*&order=inicio_agenda.asc");
      const opRows = await supaFetch("/operacional?select=*");
      const sap = await supaFetch("/zles002?select=*");

      const opMap = Object.fromEntries(opRows.map((r) => [r.dt, r]));
      const sapMap = {};
      sap.forEach((s) => {
        if (!sapMap[s.numero_transporte]) sapMap[s.numero_transporte] = [];
        sapMap[s.numero_transporte].push(s);
      });

      const combined = agenda.map((a) => {
        const op = opMap[a.dt] || {};
        const sapItems = sapMap[a.dt] || [];
        const peso = sapItems.reduce((acc, s) => acc + parseFloat(s.peso || 0), 0);
        const descDoc = sapItems[0]?.descricao_documento || "";
        const centro = sapItems[0]?.centro || "";
        const tipoCarga = sapItems[0]?.tipo_carga || "";
        return {
          dt: a.dt,
          dia: a.inicio_agenda ? new Date(a.inicio_agenda).toLocaleDateString("pt-BR") : "",
          transportadora: a.transportadora || "",
          hora_chegada: a.inicio_agenda ? new Date(a.inicio_agenda).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "",
          fim_agenda: a.fim_agenda,
          status: op.status || "AG CHEGADA",
          faturamento: op.faturamento || "",
          grade: op.grade_inicio || "",
          fim: op.grade_fim || "",
          portaria: op.portaria || "",
          desc_doc: descDoc,
          peso_liquido: peso,
          centro,
          tipo_carga: tipoCarga,
        };
      });
      setRows(combined);
    } catch (e) {
      console.error(e);
    }
  };

  const loadLogs = async () => {
    try {
      const data = await supaFetch("/logs_operacionais?select=*&order=data_alteracao.desc&limit=200");
      setLogs(data);
    } catch {}
  };

  const writeLog = async (dt, tipo, antigo, novo) => {
    await supaFetch("/logs_operacionais", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ dt, usuario: "operador", tipo_alteracao: tipo, valor_antigo: antigo, valor_novo: novo }),
    });
  };

  const upsertOp = async (dt, field, value, oldValue) => {
    await supaFetch("/operacional", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ dt, [field]: value, updated_at: new Date().toISOString() }),
    });
    await writeLog(dt, field.toUpperCase(), oldValue ?? "", value ?? "");
    loadData();
  };

  // ─── KPI CALCULATIONS ──────────────────────────────────────────────────────
  const hoje = now.toDateString();
  const todayRows = rows.filter((r) => {
    if (!r.fim_agenda) return false;
    return new Date(r.fim_agenda).toDateString() === hoje;
  });

  const janela = todayRows.filter((r) => {
    if (!r.fim_agenda) return false;
    return new Date(r.fim_agenda) <= now;
  });

  const planejado = janela.reduce((a, r) => a + r.peso_liquido, 0);
  const realizado = janela
    .filter((r) => ["EXPEDIDO","EM FATURAMENTO"].includes(r.status))
    .reduce((a, r) => a + r.peso_liquido, 0);

  const grade = todayRows.reduce((a, r) => a + r.peso_liquido, 0);
  const vendaAruja = todayRows.filter((r) => r.desc_doc === "Venda" && r.centro === "1111").reduce((a, r) => a + r.peso_liquido, 0);
  const vendaMogi = todayRows.filter((r) => r.desc_doc === "Venda" && r.centro === "1110").reduce((a, r) => a + r.peso_liquido, 0);
  const transferencia = todayRows.filter((r) => r.desc_doc === "Transferência").reduce((a, r) => a + r.peso_liquido, 0);
  const metaVal = parseFloat(preFatura) || 0;
  const metaDiaria = metaVal - roundTon(grade / 1000) * 1000;

  // Filter rows for display
  const ativasRows = rows.filter((r) => !EXPEDIDO_STATUS.includes(r.status));
  const expedidasRows = rows.filter((r) => EXPEDIDO_STATUS.includes(r.status));
  const displayRows = (tab === "ativas" ? ativasRows : expedidasRows).filter((r) =>
    filterText ? r.dt.includes(filterText) || r.transportadora.toLowerCase().includes(filterText.toLowerCase()) : true
  );

  // ─── IMPORT HANDLERS ──────────────────────────────────────────────────────
  const handleAgendaFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { raw: false });

      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);

      const filtered = raw.filter((row) => {
        const local = (row["LOCAL"] || "").toString();
        if (!local.endsWith("1110") && !local.endsWith("1111")) return false;
        const doca = (row["DOCA"] || "").toString();
        if (doca && !doca.includes("_IFNT") && doca !== "") {
          if (doca.startsWith("DOCA_") && !doca.includes("_IFNT")) return false;
        }
        const dt = new Date(row["DT"] || row["INICIO AGENDA"] || "");
        if (isNaN(dt)) return true;
        return dt >= today && dt < dayAfter;
      });

      const records = filtered.map((row) => ({
        dt: (row["AGENDA TRANSPORTADOR"] || row["DT"] || "").toString().trim(),
        doca: row["DOCA"] || null,
        transportadora: row["NOME TRANSPORTADORA"] || row["TRANSPORTADORA"] || "",
        inicio_agenda: row["DT"] ? new Date(row["DT"]).toISOString() : null,
        fim_agenda: row["FIM AGENDA TRANSPORTADOR"] ? new Date(row["FIM AGENDA TRANSPORTADOR"]).toISOString() : null,
        local: row["LOCAL"] || "",
      })).filter(r => r.dt);

      // Upsert in batches
      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        await supaFetch("/agenda_importada", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(batch),
        });
      }
      showToast(`✅ ${records.length} registros importados da Agenda`);
      setImportStep(2);
    } catch (err) {
      showToast("❌ Erro ao importar: " + err.message, "error");
    }
    setImporting(false);
  };

  const handleSapFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { raw: false });

      const records = raw.map((row) => {
        const infAgenda = (row["Inf. Agenda Entrega"] || "").toString();
        const tipoCarga = infAgenda.includes("PLT") ? "Paletizada" : "Estivada";
        return {
          numero_transporte: (row["Nº transporte"] || row["Nr. Remessa/Recebimento"] || "").toString().trim(),
          material: row["Material"] || "",
          quantidade: parseFloat(row["Qtde Remessa"] || 0),
          peso: parseFloat((row["Peso líquido"] || "0").toString().replace(",", ".")) || 0,
          descricao_documento: row["Descrição de Documento"] || "",
          tipo_carga: tipoCarga,
          centro: (row["Centro"] || "").toString(),
        };
      }).filter(r => r.numero_transporte);

      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        await supaFetch("/zles002", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(batch),
        });
      }
      showToast(`✅ ${records.length} registros SAP importados`);
      setModal(null);
      loadData();
    } catch (err) {
      showToast("❌ Erro SAP: " + err.message, "error");
    }
    setImporting(false);
  };

  // ─── MANUAL DT ────────────────────────────────────────────────────────────
  const handleManualSave = async () => {
    if (!manualDt) return;
    try {
      await supaFetch("/agenda_importada", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ dt: manualDt, transportadora: manualTransp, inicio_agenda: new Date().toISOString(), fim_agenda: new Date().toISOString() }),
      });
      await writeLog(manualDt, "CADASTRO_MANUAL", "", "INSERIDO");
      showToast(`✅ DT ${manualDt} cadastrada`);
      setManualDt(""); setManualTransp(""); setModal(null);
      loadData();
    } catch (e) { showToast("❌ " + e.message, "error"); }
  };

  // ─── PDF MERGE ────────────────────────────────────────────────────────────
  const handlePdfMerge = async () => {
    if (!pdfFiles.length) return;
    try {
      const merged = await PDFDocument.create();
      for (const f of pdfFiles) {
        const buf = await f.arrayBuffer();
        const doc = await PDFDocument.load(buf);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }
      const bytes = await merged.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${pdfName}.pdf`; a.click();
      showToast("✅ PDF gerado com sucesso");
    } catch (e) { showToast("❌ Erro PDF: " + e.message, "error"); }
  };

  // ─── CSV EXPORT ───────────────────────────────────────────────────────────
  const handleExport = () => {
    const headers = ["DIA","DT","TRANSPORTADORA","HORA CHEGADA","STATUS","FATURAMENTO","GRADE","FIM","Nº PORTARIA","DESC. DOCUMENTO","PESO (kg)","TIPO CARGA"];
    const csvRows = [headers, ...rows.map(r => [r.dia, r.dt, r.transportadora, r.hora_chegada, r.status, r.faturamento, r.grade, r.fim, r.portaria, r.desc_doc, r.peso_liquido, r.tipo_carga])];
    const csv = csvRows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `WMS_${new Date().toLocaleDateString("pt-BR").replace(/\//g,"-")}.csv`; a.click();
  };

  // ─── STATUS COLOR ─────────────────────────────────────────────────────────
  const statusColor = (s) => {
    const map = {
      "AG CHEGADA": "#334155", "PATIO": "#1e40af", "SEPARANDO": "#92400e",
      "CARREGANDO": "#065f46", "EM FATURAMENTO": "#6b21a8", "EXPEDIDO": "#14532d",
      "NO SHOW": "#7f1d1d", "VEICULO RECUSADO": "#7c2d12", "MOTORISTA FOI EMBORA": "#713f12",
    };
    return map[s] || "#1e293b";
  };

  const statusBg = (s) => {
    const map = {
      "AG CHEGADA":"#1e293b","PATIO":"#1e3a5f","SEPARANDO":"#451a03","CARREGANDO":"#052e16",
      "EM FATURAMENTO":"#3b0764","EXPEDIDO":"#052e16","NO SHOW":"#450a0a","VEICULO RECUSADO":"#431407","MOTORISTA FOI EMBORA":"#422006",
    };
    return map[s] || "#0f172a";
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#070b14", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        input, select { outline: none; }
        .kpi-card { transition: transform 0.15s, box-shadow 0.15s; }
        .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .btn { cursor: pointer; transition: all 0.15s; border: none; }
        .btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .row-hover:hover { background: #0f172a !important; }
        .modal-overlay { animation: fadeIn 0.15s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal-box { animation: slideUp 0.2s ease; }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; }
        select option { background: #1e293b; color: #e2e8f0; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "linear-gradient(90deg,#0a0f1e,#111827)", borderBottom: "1px solid #1e293b", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 6, height: 36, background: "linear-gradient(180deg,#3b82f6,#06b6d4)", borderRadius: 3 }} />
          <div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "0.1em", color: "#f1f5f9" }}>WMS <span style={{ color: "#3b82f6" }}>LOGÍSTICA</span></div>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.2em" }}>SISTEMA OPERACIONAL DE GESTÃO DE CARGAS</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", fontFamily: "'Rajdhani'" }}>{now.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>{now.toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"}).toUpperCase()}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" onClick={() => { setImportStep(1); setModal("import-agenda"); }} style={{ background: "#1e40af", color: "#fff", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>⬆ IMPORTAR</button>
            <button className="btn" onClick={handleExport} style={{ background: "#065f46", color: "#fff", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>⬇ CSV</button>
            <button className="btn" onClick={() => { loadLogs(); setModal("logs"); }} style={{ background: "#1e293b", color: "#94a3b8", padding: "6px 12px", borderRadius: 6, fontSize: 11, border: "1px solid #334155" }}>⌘ LOGS</button>
          </div>
        </div>
      </div>

      {/* KPI BAR */}
      <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 8 }}>
        {[
          { label: "PLANEJADO", value: fmt(roundTon(planejado/1000)), unit:"t", color:"#3b82f6" },
          { label: "REALIZADO", value: fmt(roundTon(realizado/1000)), unit:"t", color:"#06b6d4" },
          { label: "VENDA ARUJÁ", value: fmt(roundTon(vendaAruja/1000)), unit:"t", color:"#8b5cf6" },
          { label: "VENDA MOGI", value: fmt(roundTon(vendaMogi/1000)), unit:"t", color:"#ec4899" },
          { label: "TRANSFERÊNCIA", value: fmt(roundTon(transferencia/1000)), unit:"t", color:"#f59e0b" },
          { label: "GRADE", value: fmt(roundTon(grade/1000)), unit:"t", color:"#10b981" },
          { label: "PRÉ FATURA", value: preFatura || "—", unit:"t", color:"#f97316", editable:true },
          { label: "META DIÁRIA", value: fmt(roundTon(Math.abs(metaDiaria)/1000)), unit: metaDiaria < 0 ? "t ↓" : "t ↑", color: metaDiaria < 0 ? "#ef4444" : "#22c55e" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ background: "linear-gradient(135deg,#0f172a,#1a2235)", border: `1px solid ${k.color}22`, borderRadius: 8, padding: "10px 12px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: k.color, borderRadius: "8px 0 0 8px" }} />
            <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.12em", marginBottom: 4 }}>{k.label}</div>
            {k.editable ? (
              <input value={preFatura} onChange={e => setPreFatura(e.target.value)} placeholder="0" style={{ background: "transparent", border: "none", color: k.color, fontSize: 20, fontWeight: 700, width: "100%", fontFamily: "inherit" }} />
            ) : (
              <div style={{ fontSize: 20, fontWeight: 700, color: k.color, fontFamily: "'Rajdhani',sans-serif" }}>{k.value}<span style={{ fontSize: 10, marginLeft: 2, color: "#475569" }}>{k.unit}</span></div>
            )}
          </div>
        ))}
      </div>

      {/* TABS + FILTER */}
      <div style={{ padding: "0 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["ativas","expedidas"].map(t => (
            <button key={t} className="btn" onClick={() => setTab(t)} style={{ background: tab===t ? "#1e40af" : "#1e293b", color: tab===t ? "#fff" : "#64748b", padding: "6px 16px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: tab===t?"1px solid #3b82f6":"1px solid #1e293b", letterSpacing:"0.08em" }}>
              {t.toUpperCase()} <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>({t==="ativas"?ativasRows.length:expedidasRows.length})</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filtrar DT / Transportadora..." style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "5px 12px", color: "#e2e8f0", fontSize: 11, width: 220 }} />
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}>
            <span className="pulse" style={{ display: "inline-block", width: 6, height: 6, background: "#22c55e", borderRadius: "50%", marginRight: 4 }} />
            REALTIME ATIVO
          </div>
          <div style={{ fontSize: 9, color: "#334155" }}>CTRL+M MANUAL | CTRL+Y PDF | CTRL+O LOGS | CTRL+D IMPORTAR</div>
        </div>
      </div>

      {/* TABLE */}
      <div style={{ margin: "0 20px 20px", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#0f172a", borderBottom: "1px solid #1e293b" }}>
                {["DIA","DT","TRANSPORTADORA","CHEGADA","STATUS","FATURAMENTO","GRADE","FIM","Nº PORTARIA","DESC. DOC","PESO (kg)","TIPO"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#475569", fontWeight: 600, fontSize: 9, letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: "center", padding: 40, color: "#334155", fontSize: 12 }}>
                  {tab === "ativas" ? "Nenhuma carga ativa. Use IMPORTAR ou CTRL+M para adicionar." : "Nenhuma carga expedida."}
                </td></tr>
              )}
              {displayRows.map((row, i) => (
                <tr key={row.dt} className="row-hover" style={{ background: i % 2 === 0 ? "#0a0f1e" : "#080d1a", borderBottom: "1px solid #0f172a" }}>
                  <td style={{ padding: "6px 10px", color: "#64748b", whiteSpace: "nowrap" }}>{row.dia}</td>
                  <td style={{ padding: "6px 10px", fontWeight: 600, color: "#93c5fd", fontFamily: "'Rajdhani',sans-serif", fontSize: 13 }}>{row.dt}</td>
                  <td style={{ padding: "6px 10px", color: "#cbd5e1", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.transportadora}</td>
                  <td style={{ padding: "6px 10px", color: "#64748b", whiteSpace: "nowrap" }}>{row.hora_chegada}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <select value={row.status} onChange={e => upsertOp(row.dt, "status", e.target.value, row.status)} style={{ background: statusBg(row.status), color: "#e2e8f0", border: `1px solid ${statusColor(row.status)}`, borderRadius: 4, padding: "3px 4px", fontSize: 10, fontFamily: "inherit", width: "100%", cursor: "pointer" }}>
                      {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <select value={row.faturamento} disabled={row.status !== "EM FATURAMENTO"} onChange={e => upsertOp(row.dt, "faturamento", e.target.value, row.faturamento)} style={{ background: row.status==="EM FATURAMENTO" ? "#1e1030" : "#0f172a", color: row.status==="EM FATURAMENTO" ? "#c4b5fd" : "#334155", border: `1px solid ${row.status==="EM FATURAMENTO" ? "#6b21a8" : "#1e293b"}`, borderRadius: 4, padding: "3px 4px", fontSize: 10, fontFamily: "inherit", width: "100%", cursor: row.status==="EM FATURAMENTO" ? "pointer" : "not-allowed" }}>
                      <option value="">—</option>
                      {FATURAMENTO_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.grade} onChange={e => upsertOp(row.dt, "grade_inicio", e.target.value, row.grade)} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "3px 6px", color: "#94a3b8", fontSize: 10, width: 70, fontFamily: "inherit" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.fim} onChange={e => upsertOp(row.dt, "grade_fim", e.target.value, row.fim)} placeholder="HH:MM" style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "3px 6px", color: "#94a3b8", fontSize: 10, width: 60, fontFamily: "inherit" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.portaria} onChange={e => upsertOp(row.dt, "portaria", e.target.value, row.portaria)} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "3px 6px", color: "#94a3b8", fontSize: 10, width: 70, fontFamily: "inherit" }} />
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span className="tag" style={{ background: row.desc_doc==="Venda"?"#1e3a5f":row.desc_doc==="Transferência"?"#1c1917":"#1e293b", color: row.desc_doc==="Venda"?"#93c5fd":row.desc_doc==="Transferência"?"#fbbf24":"#64748b" }}>{row.desc_doc || "—"}</span>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#e2e8f0", fontFamily: "'Rajdhani',sans-serif" }}>{row.peso_liquido > 0 ? row.peso_liquido.toLocaleString("pt-BR") : "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span className="tag" style={{ background: row.tipo_carga==="Paletizada"?"#064e3b":"#1a1a2e", color: row.tipo_carga==="Paletizada"?"#6ee7b7":"#818cf8" }}>{row.tipo_carga || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 24, minWidth: 480, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}>

            {/* IMPORT AGENDA */}
            {(modal === "import-agenda") && (
              <>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#3b82f6" }}>⬆</span> IMPORTAÇÃO DE DADOS
                </div>
                <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
                  {["1 — Agenda","2 — SAP ZLES002"].map((s,i) => (
                    <div key={i} style={{ flex: 1, padding: "6px 12px", borderRadius: 6, background: importStep===i+1?"#1e40af":"#1e293b", color: importStep===i+1?"#fff":"#475569", fontSize: 11, textAlign: "center", fontWeight: 600 }}>{s}</div>
                  ))}
                </div>
                {importStep === 1 && (
                  <>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Selecione o arquivo da Agenda da Transportadora (.xlsx / .xls)</div>
                    <div style={{ fontSize: 10, color: "#334155", marginBottom: 16, padding: "8px 12px", background: "#0a0f1e", borderRadius: 6, border: "1px solid #1e293b" }}>
                      Filtros aplicados: LOCAL → termina em 1110 ou 1111 | DOCA → contém _IFNT ou NULL | DATA → D+0 e D+1
                    </div>
                    <label style={{ display: "block", border: "2px dashed #1e40af", borderRadius: 8, padding: 24, textAlign: "center", cursor: "pointer", color: "#3b82f6", fontSize: 12 }}>
                      {importing ? "⏳ Processando..." : "📂 Clique para selecionar ou arraste o arquivo"}
                      <input type="file" accept=".xlsx,.xls" onChange={handleAgendaFile} style={{ display: "none" }} />
                    </label>
                  </>
                )}
                {importStep === 2 && (
                  <>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Selecione o arquivo SAP ZLES002 (.xlsx / .xls)</div>
                    <div style={{ fontSize: 10, color: "#334155", marginBottom: 16, padding: "8px 12px", background: "#0a0f1e", borderRadius: 6, border: "1px solid #1e293b" }}>
                      Cruzamento por: Nº transporte → DT | Inf. Agenda Entrega → PLT=Paletizada, outro=Estivada
                    </div>
                    <label style={{ display: "block", border: "2px dashed #065f46", borderRadius: 8, padding: 24, textAlign: "center", cursor: "pointer", color: "#10b981", fontSize: 12 }}>
                      {importing ? "⏳ Processando..." : "📂 Clique para selecionar o arquivo SAP"}
                      <input type="file" accept=".xlsx,.xls" onChange={handleSapFile} style={{ display: "none" }} />
                    </label>
                    <button className="btn" onClick={() => { setModal(null); loadData(); }} style={{ marginTop: 12, background: "#065f46", color: "#fff", padding: "8px 16px", borderRadius: 6, fontSize: 11, fontWeight: 600, width: "100%" }}>Pular SAP e fechar</button>
                  </>
                )}
              </>
            )}

            {/* MANUAL DT */}
            {modal === "manual" && (
              <>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>⌨ CADASTRO MANUAL DE DT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>NÚMERO DA DT *</label>
                    <input value={manualDt} onChange={e => setManualDt(e.target.value)} placeholder="Ex: 123456789" style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>TRANSPORTADORA</label>
                    <input value={manualTransp} onChange={e => setManualTransp(e.target.value)} placeholder="Nome da transportadora" style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
                  </div>
                  <button className="btn" onClick={handleManualSave} style={{ background: "#1e40af", color: "#fff", padding: "10px", borderRadius: 6, fontSize: 12, fontWeight: 600, marginTop: 4 }}>✓ SALVAR DT</button>
                </div>
              </>
            )}

            {/* PDF MERGE */}
            {modal === "pdf" && (
              <>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>📄 MERGE DE PDFs</div>
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); setPdfFiles(prev => [...prev, ...Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf")]); }}
                  style={{ border: "2px dashed #334155", borderRadius: 8, padding: 24, textAlign: "center", color: "#475569", fontSize: 12, marginBottom: 12, cursor: "pointer" }}
                >
                  Arraste PDFs aqui ou
                  <label style={{ color: "#3b82f6", cursor: "pointer", marginLeft: 4 }}>
                    clique para selecionar
                    <input type="file" accept=".pdf" multiple onChange={e => setPdfFiles(prev => [...prev, ...Array.from(e.target.files)])} style={{ display: "none" }} />
                  </label>
                </div>
                {pdfFiles.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {pdfFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", background: "#1e293b", borderRadius: 4, marginBottom: 4, fontSize: 11 }}>
                        <span style={{ color: "#94a3b8" }}>📄 {f.name}</span>
                        <button className="btn" onClick={() => setPdfFiles(prev => prev.filter((_,j) => j!==i))} style={{ background: "none", color: "#ef4444", fontSize: 14 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>NOME DO ARQUIVO DE SAÍDA</label>
                  <input value={pdfName} onChange={e => setPdfName(e.target.value)} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={handlePdfMerge} style={{ flex: 1, background: "#1e40af", color: "#fff", padding: "8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>⬇ BAIXAR PDF MERGED</button>
                  <button className="btn" onClick={async () => { await handlePdfMerge(); window.print(); }} style={{ flex: 1, background: "#1e293b", color: "#94a3b8", padding: "8px", borderRadius: 6, fontSize: 11, border: "1px solid #334155" }}>🖨 IMPRIMIR</button>
                </div>
              </>
            )}

            {/* LOGS */}
            {modal === "logs" && (
              <>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>📋 LOGS OPERACIONAIS</div>
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  {logs.length === 0 && <div style={{ color: "#334155", textAlign: "center", padding: 20, fontSize: 12 }}>Nenhum log registrado.</div>}
                  {logs.map((l, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 6, padding: "6px 8px", background: i%2===0?"#0a0f1e":"#0f172a", borderRadius: 4, marginBottom: 2, fontSize: 10, alignItems: "center" }}>
                      <span style={{ color: "#93c5fd", fontWeight: 600 }}>{l.dt}</span>
                      <span style={{ color: "#64748b" }}>{l.usuario}</span>
                      <span style={{ color: "#f59e0b" }}>{l.tipo_alteracao}</span>
                      <span style={{ color: "#ef4444", textDecoration: "line-through" }}>{l.valor_antigo || "—"}</span>
                      <span style={{ color: "#22c55e" }}>→ {l.valor_novo || "—"}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 9, color: "#334155", textAlign: "right" }}>
                  {logs[0]?.data_alteracao ? new Date(logs[0].data_alteracao).toLocaleString("pt-BR") : ""}
                </div>
              </>
            )}

            <button className="btn" onClick={() => setModal(null)} style={{ marginTop: 16, width: "100%", background: "#0a0f1e", color: "#475569", padding: "6px", borderRadius: 6, fontSize: 10, border: "1px solid #1e293b" }}>ESC — FECHAR</button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: toast.type==="error"?"#7f1d1d":"#052e16", border: `1px solid ${toast.type==="error"?"#ef4444":"#22c55e"}`, borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#e2e8f0", zIndex: 2000, maxWidth: 360 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
