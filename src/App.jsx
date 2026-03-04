import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ═══════════════════════════════════════════════════════════════════
   THE WRIST ROOM — OPERATING SYSTEM v13 (SUPABASE + CATALOG)
   ═══════════════════════════════════════════════════════════════════ */

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || ""
);

/* ═══ UTILS ═══ */
const uid = () => "W" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmxn = (n) => { if (n == null || isNaN(n)) return "—"; const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1000 ? `$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${a}`); };
const td = () => new Date().toISOString().slice(0, 10);
const calcPr = (c) => ({ price_dealer: Math.round(c * 1.08), price_asked: Math.round(c * 1.15), price_trade: Math.round(c * 1.2) });
const genSku = (existing) => { const now = td(); const pfx = "TWR-" + now.slice(2, 4) + now.slice(5, 7) + "-"; const n = (existing || []).filter(p => p.sku?.startsWith(pfx)).length; return pfx + String(n + 1).padStart(4, "0"); };

/* ═══ STORAGE HELPERS ═══ */
const BUCKET_FOTOS = "fotos_piezas";
const BUCKET_DOCS = "documentos";

const stor = {
  async uploadFoto(piezaId, posicion, file) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `piezas/${piezaId}/${posicion}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET_FOTOS).upload(path, file, { cacheControl: "31536000", upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET_FOTOS).getPublicUrl(path);
    return { url: data.publicUrl, storagePath: path };
  },
  async uploadDoc(entType, entId, tipo, file) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const safe = tipo.replace(/[^a-zA-Z0-9]/g, "_");
    const path = `${entType}/${entId}/${safe}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET_DOCS).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
    if (error) throw error;
    const { data } = await sb.storage.from(BUCKET_DOCS).createSignedUrl(path, 43200);
    return { url: data?.signedUrl || "", storagePath: path };
  },
  async refreshUrl(path) { const { data } = await sb.storage.from(BUCKET_DOCS).createSignedUrl(path, 43200); return data?.signedUrl || ""; },
  async delFoto(path) { await sb.storage.from(BUCKET_FOTOS).remove([path]); },
  async delDoc(path) { await sb.storage.from(BUCKET_DOCS).remove([path]); },
};

/* ═══ DB LAYER ═══ */
const db = {
  async loadAll() {
    const [pz, tx, ct, fo, cl, su, st, cr] = await Promise.all([
      sb.from("piezas").select("*").order("created_at", { ascending: false }),
      sb.from("transacciones").select("*").order("fecha", { ascending: false }),
      sb.from("cortes").select("*").order("periodo", { ascending: false }),
      sb.from("pieza_fotos").select("*").is("deleted_at", null),
      sb.from("clientes").select("*"),
      sb.from("proveedores").select("*"),
      sb.from("app_settings").select("*"),
      sb.from("custom_referencias").select("*"),
    ]);
    return {
      pieces: pz.data || [], txs: tx.data || [], cortes: ct.data || [],
      fotos: fo.data || [], clients: cl.data || [], suppliers: su.data || [],
      settings: Object.fromEntries((st.data || []).map(s => [s.key, s.value])),
      customRefs: cr.data || [],
    };
  },
  async loadDocs(entType, entId) {
    const { data } = await sb.from("transaccion_docs").select("*").eq("entidad_tipo", entType).eq("entidad_id", entId);
    return data || [];
  },
  async savePiece(p) { const { error } = await sb.from("piezas").upsert(p); if (error) throw error; },
  async saveTx(t) { const { error } = await sb.from("transacciones").upsert(t); if (error) throw error; },
  async saveCorte(c) { const { error } = await sb.from("cortes").upsert(c); if (error) throw error; },
  async saveClient(c) { const { error } = await sb.from("clientes").upsert(c); if (error) throw error; },
  async saveSupplier(s) { const { error } = await sb.from("proveedores").upsert(s); if (error) throw error; },
  async saveFoto(f) { const { data, error } = await sb.from("pieza_fotos").insert(f).select(); if (error) throw error; return data?.[0]; },
  async softDelFoto(id) { const { error } = await sb.from("pieza_fotos").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
  async saveDoc(d) { const { data, error } = await sb.from("transaccion_docs").insert(d).select(); if (error) throw error; return data?.[0]; },
  async saveSetting(key, value) { const { error } = await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw error; },
  async saveCustomRef(r) { const { data, error } = await sb.from("custom_referencias").upsert(r, { onConflict: "brand,model,ref_number" }).select(); if (error) throw error; return data?.[0]; },
  async loadCatalogPublic() {
    const { data } = await sb.from("piezas").select("*").eq("publish_catalog", true).eq("status", "Disponible").order("catalog_order");
    const { data: fotos } = await sb.from("pieza_fotos").select("*").is("deleted_at", null);
    const { data: stData } = await sb.from("app_settings").select("*").in("key", ["whatsapp_number", "business_name", "catalog_config"]);
    return { pieces: data || [], fotos: fotos || [], settings: Object.fromEntries((stData || []).map(s => [s.key, s.value])) };
  },
};

/* ═══ WATCH DATABASE ═══ */
const WDB = {
  Rolex: { Submariner:["126610LN","126610LV","124060"],  "GMT-Master II":["126710BLRO","126710BLNR","126720VTNR"], Daytona:["126500LN","116500LN","126506"], "Datejust 41":["126334","126300","126331"], "Datejust 36":["126234","126200"], Explorer:["124270","224270"], "Explorer II":["226570"], "Sea-Dweller":["126603","126600"], "Sky-Dweller":["326934","326933"], "Day-Date 40":["228236","228238"], "Oyster Perpetual":["124300","126000"] },
  Omega: { "Seamaster 300M":["210.30.42.20.01.001","210.30.42.20.03.001"], "Speedmaster Moonwatch":["310.30.42.50.01.001"], "Aqua Terra":["220.10.41.21.01.001"], Constellation:["131.10.39.20.01.001"] },
  Cartier: { Santos:["WSSA0018","WSSA0029","WSSA0030"], "Santos Dumont":["WGSA0021"], "Tank Française":["WSTA0065"], Panthère:["WSPN0007"], "Ballon Bleu":["WSBB0025"], "Santos Chronograph":["WSSA0060"] },
  Hublot: { "Classic Fusion":["542.NX.1171.RX","511.NX.1171.RX"], "Big Bang":["301.SB.131.RX"] },
  "Tag Heuer": { Carrera:["CBN2A1B.BA0643","CBS2210.BA0653"], Monaco:["CBL2111.BA0644"], Aquaracer:["WBP201A.BA0632"] },
  "Patek Philippe": { Nautilus:["5711/1A-014","5711/1A-010"], Aquanaut:["5167A-001","5168G-001"], Calatrava:["5227G-001"] },
  "Audemars Piguet": { "Royal Oak":["15500ST.OO.1220ST.01","15510ST.OO.1320ST.01"], "Royal Oak Offshore":["26405CE.OO.A002CA.01"] },
  Bulgari: { Octo:["103534","103297"], "Octo Finissimo":["103431"], Serpenti:["102919"] },
  IWC: { Portugieser:["IW371605","IW371617"], "Pilot Mark XX":["IW328201"], "Big Pilot":["IW329303"] },
  Tudor: { "Black Bay":["M79230N","M79230B"], "Black Bay 58":["M79030N"], Pelagos:["M25600TB"] },
  Panerai: { Luminor:["PAM01312"], Submersible:["PAM01305"] },
  Breitling: { Navitimer:["AB0120","AB0127"], Superocean:["A17376"], Chronomat:["AB0134"] },
  Zenith: { Chronomaster:["03.3200.3600/21.M3200"], Defy:["95.9000.9004/78.R584"] },
};
const BRANDS = Object.keys(WDB);
const getModels = (b) => WDB[b] ? Object.keys(WDB[b]) : [];
const getRefs = (b, m) => WDB[b]?.[m] || [];

/* ═══ CONSTANTS ═══ */
const CONDS = ["Nuevo/Sin uso","Como nuevo","Mint","Excelente","Muy bueno","Bueno","Regular","Vintage","Partes"];
const AUTHS = [{c:"NONE",n:"Sin autenticar",l:0},{c:"VISUAL",n:"Inspección visual",l:1},{c:"SERIAL",n:"Serial verificado",l:2},{c:"MOVEMENT",n:"Movimiento abierto",l:3},{c:"THIRD",n:"Tercero certificado",l:4},{c:"BRAND",n:"Certificado de marca",l:5}];
const PAYS = ["SPEI","Efectivo MXN","Efectivo USD","Wire USD","Trade","Trade+Cash","Escrow","Tarjeta"];
const ETYPES = [{v:"adquisicion",l:"Adquisición"},{v:"trade_in",l:"Trade-in"},{v:"consignacion",l:"Consignación"}];
const XTYPES = [{v:"venta",l:"Venta"},{v:"trade_out",l:"Trade-out"},{v:"retorno_consignacion",l:"Retorno consignación"}];
const FUND_INFO = {
  FIC: { short:"Fondo de Inversión", full:"Fondo de Inversión Compartida", desc:"Fondo común. Fernando 40% · Socio A 30% · Socio B 30%.", icon:"🏦" },
  FP1: { short:"Fondo Personal 1", full:"Fondo Personal 1 — Fernando", desc:"Operaciones independientes de Fernando. 100% utilidad.", icon:"👤" },
  FP2: { short:"Fondo Personal 2", full:"Fondo Personal 2 — La Sociedad", desc:"Operaciones de La Sociedad. 50/50 socios.", icon:"👥" },
};
const FUNDS = Object.keys(FUND_INFO);
const PARTNERS = [{id:"fernando",name:"Fernando Cervantes",short:"Fernando",role:"DPM · Socio Operador",pct:40,color:"#4ADE80"},{id:"socioA",name:"Socio A",short:"Socio A",role:"La Sociedad",pct:30,color:"#60A5FA"},{id:"socioB",name:"Socio B (Externo)",short:"Socio B",role:"Socio Capitalista",pct:30,color:"#C084FC"}];
const PM = Object.fromEntries(PARTNERS.map(p => [p.id, p]));
const pSplit = (t) => PARTNERS.map(p => ({ ...p, share: Math.round(t * (p.pct / 100)) }));

const PHOTO_POSITIONS = [
  { id: "dial", label: "Carátula / Dial", icon: "⌚" },
  { id: "bisel", label: "Bisel", icon: "🔵" },
  { id: "corona", label: "Corona", icon: "👑" },
  { id: "tapa", label: "Tapa trasera", icon: "🔙" },
  { id: "bracelet", label: "Brazalete / Correa", icon: "⛓" },
  { id: "full", label: "Vista completa", icon: "📷" },
];

const DOC_TYPES = [
  { id: "identificacion", label: "Identificación oficial", icon: "🪪" },
  { id: "contrato", label: "Contrato de compra-venta", icon: "📝" },
  { id: "factura", label: "Factura", icon: "🧾" },
  { id: "comprobante_pago", label: "Comprobante de pago/depósito", icon: "💳" },
  { id: "comprobante_deposito", label: "Comprobante de depósito", icon: "🏦" },
  { id: "tarjeta_garantia", label: "Tarjeta de garantía", icon: "🎫" },
  { id: "certificado_autenticidad", label: "Certificado de autenticidad", icon: "✅" },
  { id: "otro", label: "Otro documento", icon: "📄" },
];

const etLabel = v => ETYPES.find(e => e.v === v)?.l || v;
const xtLabel = v => XTYPES.find(e => e.v === v)?.l || v;

/* ═══ GLOBAL STYLES ═══ */
const SID = "twr-css-13";
if (typeof document !== "undefined" && !document.getElementById(SID)) {
  const el = document.createElement("style"); el.id = SID;
  el.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    :root{--nv:#0B1D33;--n2:#122A47;--n3:#1A3A5C;--ns:#0F2440;--gd:#C9A96E;--gl:#D4BA85;--gk:#A08650;--cr:#F5F0E8;--cd:#D6CEBF;--gn:#4ADE80;--rd:#FB7185;--bl:#60A5FA;--pr:#C084FC}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    body{margin:0;background:var(--nv);overflow-x:hidden}
    .fd{font-family:'Playfair Display',Georgia,serif}.fb{font-family:'DM Sans',system-ui,sans-serif}
    .ti{width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid rgba(201,169,110,.2);font-size:14px;background:var(--ns);color:var(--cr);font-family:'DM Sans',system-ui,sans-serif;transition:border-color .2s;outline:none}
    .ti:focus{border-color:var(--gd);box-shadow:0 0 0 3px rgba(201,169,110,.15)}
    .ti::placeholder{color:rgba(245,240,232,.3)}.ti option{background:var(--nv);color:var(--cr)}
    .ti:read-only{opacity:.55;cursor:not-allowed;background:rgba(15,36,64,.5)}
    select.ti{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23C9A96E' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
    .scr::-webkit-scrollbar{width:6px}.scr::-webkit-scrollbar-track{background:transparent}.scr::-webkit-scrollbar-thumb{background:rgba(201,169,110,.3);border-radius:3px}
    @keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fi{from{opacity:0}to{opacity:1}}
    .au{animation:fu .4s ease-out both}.ai{animation:fi .3s ease-out both}
    @media(max-width:768px){.ti{font-size:16px;padding:12px 14px}.hide-mobile{display:none!important}.mobile-col{flex-direction:column!important}.mobile-full{width:100%!important}}
  `;
  document.head.appendChild(el);
}

/* ═══ UI PRIMITIVES ═══ */
function Ico({d,s=18}){return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>}
const IC = {
  dash:"M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4",
  inv:"M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  tx:"M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  cal:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  cat:"M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  rep:"M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  plus:"M12 4v16m8-8H4",chk:"M5 13l4 4L19 7",x:"M6 18L18 6M6 6l12 12",
  edit:"M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  srch:"M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  lock:"M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  out:"M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  swap:"M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4",
  arr:"M13 7l5 5m0 0l-5 5m5-5H6",
  cam:"M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M12 17a4 4 0 100-8 4 4 0 000 8z",
  doc:"M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  globe:"M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
  set:"M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  ai:"M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  wa:"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z",
};

function Cd({children,className="",glow}){return <div className={`rounded-2xl ${className}`} style={{background:"var(--n2)",border:"1px solid rgba(255,255,255,.06)",boxShadow:glow?"0 0 40px rgba(201,169,110,.08)":"0 2px 12px rgba(0,0,0,.2)"}}>{children}</div>}
function St({label,value,sub,accent}){return <Cd className="p-4 md:p-5"><div className="fb text-xs font-medium uppercase tracking-widest" style={{color:"var(--cd)"}}>{label}</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{color:accent||"white"}}>{value}</div>{sub&&<div className="fb text-xs mt-1" style={{color:"rgba(245,240,232,.4)"}}>{sub}</div>}</Cd>}
function Bd({text,v="default"}){const st={default:{background:"rgba(245,240,232,.08)",color:"var(--cd)"},gold:{background:"rgba(201,169,110,.15)",color:"var(--gl)"},green:{background:"rgba(74,222,128,.12)",color:"var(--gn)"},red:{background:"rgba(251,113,133,.12)",color:"var(--rd)"},blue:{background:"rgba(96,165,250,.12)",color:"var(--bl)"},purple:{background:"rgba(168,85,247,.12)",color:"var(--pr)"}};return <span className="fb text-xs px-2.5 py-1 rounded-full font-medium" style={st[v]||st.default}>{text}</span>}
function Fl({label,children,req,hint}){return <div className="mb-3"><label className="fb block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{color:"var(--gk)"}}>{label}{req&&<span style={{color:"var(--rd)"}}> *</span>}</label>{children}{hint&&<div className="fb text-xs mt-1" style={{color:"rgba(245,240,232,.25)"}}>{hint}</div>}</div>}
function Md({open,onClose,title,children,wide}){if(!open)return null;return <div className="fixed inset-0 z-50 ai" style={{isolation:"isolate"}}><div className="absolute inset-0" style={{background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)"}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}/><div className="absolute inset-0 overflow-y-auto scr" style={{pointerEvents:"none"}}><div className="min-h-full flex items-start justify-center pt-4 md:pt-8 px-2 md:px-4 pb-8"><div className={`relative rounded-2xl shadow-2xl ${wide?"w-full max-w-3xl":"w-full max-w-lg"} au`} style={{background:"var(--n2)",border:"1px solid rgba(201,169,110,.15)",pointerEvents:"auto"}} onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><div className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-6 py-3 md:py-4 rounded-t-2xl" style={{background:"var(--n2)",borderBottom:"1px solid rgba(255,255,255,.06)"}}><h2 className="fd font-semibold text-base md:text-lg text-white truncate pr-4">{title}</h2><button type="button" onClick={e=>{e.stopPropagation();onClose()}} className="p-1.5 rounded-lg hover:bg-white/5 shrink-0" style={{color:"var(--cd)"}}><Ico d={IC.x}/></button></div><div className="p-4 md:p-6">{children}</div></div></div></div></div>}

const BtnP=({children,onClick,disabled,full})=><button type="button" onClick={onClick} disabled={disabled} className={`fb px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed ${full?"w-full":""}`} style={{background:"var(--gd)",color:"var(--nv)"}}>{children}</button>;
const BtnS=({children,onClick,full})=><button type="button" onClick={onClick} className={`fb px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-white/10 ${full?"w-full":""}`} style={{background:"rgba(245,240,232,.06)",color:"var(--cd)",border:"1px solid rgba(255,255,255,.08)"}}>{children}</button>;
const BtnG=({children,onClick,disabled})=><button type="button" onClick={onClick} disabled={disabled} className="fb px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-40" style={{background:"#166534",color:"var(--gn)"}}>{children}</button>;
const BtnD=({children,onClick})=><button type="button" onClick={onClick} className="fb px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-900/30" style={{color:"var(--rd)"}}>{children}</button>;

/* ═══ FUND SELECTOR (compact for mobile) ═══ */
function FundSel({value,onChange,label}){return <div>{label&&<label className="fb block text-xs font-semibold uppercase tracking-widest mb-2" style={{color:"var(--gk)"}}>{label} <span style={{color:"var(--rd)"}}>*</span></label>}<div className="space-y-2">{FUNDS.map(fk=>{const fi=FUND_INFO[fk];const s=value===fk;return <button key={fk} type="button" onClick={()=>onChange(fk)} className="w-full text-left p-3 rounded-xl transition-all" style={{background:s?"rgba(201,169,110,.1)":"rgba(255,255,255,.02)",border:s?"1.5px solid var(--gd)":"1.5px solid rgba(255,255,255,.06)"}}><div className="flex items-center gap-2"><span className="text-lg">{fi.icon}</span><span className="fb font-semibold text-sm text-white flex-1">{fi.short}</span>{s&&<span className="fb text-xs font-bold" style={{color:"var(--gd)"}}>✓</span>}</div></button>})}</div></div>}

/* ═══ PHOTO UPLOAD COMPONENT ═══ */
function PhotoUploader({ pieceId, fotos, onUpload, onDelete }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(null);

  const handleUpload = async (pos, file) => {
    if (!file || !pieceId) return;
    setUploading(pos);
    try {
      const { url, storagePath } = await stor.uploadFoto(pieceId, pos, file);
      const saved = await db.saveFoto({ pieza_id: pieceId, posicion: pos, url, storage_path: storagePath });
      if (onUpload) onUpload(saved);
    } catch (e) { console.error("Upload error:", e); alert("Error subiendo foto: " + e.message); }
    setUploading(null);
  };

  const pieceFotos = (fotos || []).filter(f => f.pieza_id === pieceId && !f.deleted_at);

  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
      <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Fotografías del Reloj</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PHOTO_POSITIONS.map(pos => {
          const existing = pieceFotos.find(f => f.posicion === pos.id);
          const isUp = uploading === pos.id;
          return (
            <div key={pos.id} className="relative rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", aspectRatio: "1" }}>
              {existing ? (
                <>
                  <img src={existing.url} alt={pos.label} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => onDelete && onDelete(existing)} className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: "rgba(0,0,0,.7)", color: "var(--rd)" }}>✕</button>
                </>
              ) : (
                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-all">
                  <span className="text-2xl mb-1">{isUp ? "⏳" : pos.icon}</span>
                  <span className="fb text-xs text-center px-2" style={{ color: "var(--cd)" }}>{isUp ? "Subiendo..." : pos.label}</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) handleUpload(pos.id, e.target.files[0]); }} />
                </label>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-center" style={{ background: "rgba(0,0,0,.5)" }}>
                <span className="fb text-xs" style={{ color: "var(--cd)" }}>{pos.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ DOCUMENT UPLOADER ═══ */
function DocUploader({ entityType, entityId, requiredDocs, docs, onUpload }) {
  const [uploading, setUploading] = useState(null);

  const handleUpload = async (tipo, file) => {
    if (!file || !entityId) return;
    setUploading(tipo);
    try {
      const { url, storagePath } = await stor.uploadDoc(entityType, entityId, tipo, file);
      const saved = await db.saveDoc({ entidad_tipo: entityType, entidad_id: entityId, tipo, nombre_archivo: file.name, url, storage_path: storagePath });
      if (onUpload) onUpload(saved);
    } catch (e) { console.error("Doc upload error:", e); alert("Error: " + e.message); }
    setUploading(null);
  };

  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.1)" }}>
      <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--bl)" }}>Documentos Adjuntos</div>
      <div className="space-y-2">
        {DOC_TYPES.map(dt => {
          const existing = (docs || []).find(d => d.tipo === dt.id);
          const isReq = (requiredDocs || []).includes(dt.id);
          const isUp = uploading === dt.id;
          return (
            <div key={dt.id} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: existing ? "rgba(74,222,128,.06)" : "rgba(255,255,255,.02)", border: isReq && !existing ? "1px solid rgba(251,113,133,.2)" : "1px solid rgba(255,255,255,.04)" }}>
              <span className="text-lg shrink-0">{dt.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="fb text-sm font-medium text-white truncate">{dt.label}{isReq && <span className="text-xs ml-1" style={{ color: "var(--rd)" }}>*</span>}</div>
                {existing && <div className="fb text-xs truncate" style={{ color: "var(--gn)" }}>✓ {existing.nombre_archivo}</div>}
              </div>
              {existing ? (
                <a href={existing.url} target="_blank" rel="noopener" className="fb text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(96,165,250,.12)", color: "var(--bl)" }}>Ver</a>
              ) : (
                <label className="fb text-xs px-3 py-1.5 rounded-lg cursor-pointer hover:brightness-125" style={{ background: "rgba(201,169,110,.12)", color: "var(--gd)" }}>
                  {isUp ? "⏳" : "Subir"}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={e => { if (e.target.files?.[0]) handleUpload(dt.id, e.target.files[0]); }} />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ AI REFERENCE VALIDATOR ═══ */
function AiRefValidator({ brand, model, refNum, onResult }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const validate = async () => {
    if (!brand || !refNum) return;
    setLoading(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-ref`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ brand, model, refNum }),
      });
      const parsed = await resp.json();
      setResult(parsed);
      if (onResult) onResult(parsed);
    } catch (e) {
      setResult({ valid: false, notes: "Error de validación: " + e.message });
    }
    setLoading(false);
  };

  return (
    <div>
      <button type="button" onClick={validate} disabled={loading || !brand || !refNum}
        className="fb text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40 flex items-center gap-1.5"
        style={{ background: "rgba(168,85,247,.15)", color: "var(--pr)" }}>
        <Ico d={IC.ai} s={14} />{loading ? "Validando..." : "Validar con IA"}
      </button>
      {result && (
        <div className="mt-2 p-3 rounded-lg fb text-xs space-y-1" style={{ background: result.valid ? "rgba(74,222,128,.06)" : "rgba(251,113,133,.06)", border: result.valid ? "1px solid rgba(74,222,128,.15)" : "1px solid rgba(251,113,133,.15)" }}>
          <div className="font-bold" style={{ color: result.valid ? "var(--gn)" : "var(--rd)" }}>{result.valid ? "✓ Referencia válida" : "✕ Referencia no encontrada"}</div>
          {result.name && <div><span style={{color:"var(--cd)"}}>Nombre:</span> <span className="text-white">{result.name}</span></div>}
          {result.case_mm && <div><span style={{color:"var(--cd)"}}>Caja:</span> <span className="text-white">{result.case_mm}</span></div>}
          {result.movement && <div><span style={{color:"var(--cd)"}}>Calibre:</span> <span className="text-white">{result.movement}</span></div>}
          {result.material && <div><span style={{color:"var(--cd)"}}>Material:</span> <span className="text-white">{result.material}</span></div>}
          {result.retail_usd && <div><span style={{color:"var(--cd)"}}>Retail:</span> <span className="text-white">{result.retail_usd}</span></div>}
          {result.notes && <div style={{color:"var(--cd)"}}>{result.notes}</div>}
        </div>
      )}
    </div>
  );
}

/* ═══ WDB SELECTOR WITH CUSTOM REF ═══ */
function WatchRefSelector({ brand, model, refNum, onChange, customRefs }) {
  const models = getModels(brand);
  const dbRefs = getRefs(brand, model);
  const customRefsForBM = (customRefs || []).filter(cr => cr.brand === brand && cr.model === model).map(cr => cr.ref_number);
  const allRefs = [...new Set([...dbRefs, ...customRefsForBM])];
  const [customMode, setCustomMode] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const handleRefChange = (v) => {
    if (v === "__custom__") { setCustomMode(true); onChange("ref", ""); }
    else { setCustomMode(false); onChange("ref", v); }
  };

  const handleSaveCustom = async () => {
    if (!brand || !refNum) return;
    try {
      await db.saveCustomRef({ brand, model: model || "", ref_number: refNum });
      setShowSaveConfirm(false);
      alert("Referencia guardada en catálogo custom");
    } catch (e) { alert("Error: " + e.message); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Fl label="Marca" req>
        <select className="ti" value={brand} onChange={e => { onChange("brand", e.target.value); onChange("model", ""); onChange("ref", ""); setCustomMode(false); }}>
          <option value="">Seleccionar...</option>{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </Fl>
      <Fl label="Modelo" req>
        {models.length > 0 ? (
          <select className="ti" value={model} onChange={e => { onChange("model", e.target.value); onChange("ref", ""); setCustomMode(false); }}>
            <option value="">Seleccionar...</option>{models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : <input className="ti" value={model} placeholder="Escribir modelo..." onChange={e => onChange("model", e.target.value)} />}
      </Fl>
      <Fl label="Referencia">
        {!customMode && allRefs.length > 0 ? (
          <select className="ti" value={refNum} onChange={e => handleRefChange(e.target.value)}>
            <option value="">Seleccionar...</option>
            {allRefs.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="__custom__">✏ Escribir manualmente...</option>
          </select>
        ) : (
          <div className="flex gap-2">
            <input className="ti flex-1" value={refNum} placeholder="Ref. manual..." onChange={e => onChange("ref", e.target.value)} />
            {allRefs.length > 0 && <button type="button" onClick={() => setCustomMode(false)} className="fb text-xs px-2 rounded-lg" style={{ color: "var(--cd)" }}>Lista</button>}
          </div>
        )}
        {customMode && refNum && (
          <div className="flex items-center gap-2 mt-2">
            <AiRefValidator brand={brand} model={model} refNum={refNum} onResult={() => setShowSaveConfirm(true)} />
            {showSaveConfirm && (
              <button type="button" onClick={handleSaveCustom} className="fb text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>Guardar al catálogo</button>
            )}
          </div>
        )}
      </Fl>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC CATALOG — Mobile-first e-shop
   ═══════════════════════════════════════════════════════════════════ */
function PublicCatalog() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    db.loadCatalogPublic().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--nv)" }}>
      <div className="text-center au">
        <div className="fd text-3xl font-bold text-white mb-2">The Wrist Room</div>
        <div className="fb text-sm" style={{ color: "var(--cd)" }}>Cargando catálogo...</div>
      </div>
    </div>
  );

  const pieces = data?.pieces || [];
  const fotos = data?.fotos || [];
  const waNum = data?.settings?.whatsapp_number?.replace(/"/g, "") || "";
  const bizName = data?.settings?.business_name?.replace(/"/g, "") || "The Wrist Room";
  const catCfg = data?.settings?.catalog_config || {};
  const showPrices = catCfg.show_prices !== false;

  const getFotos = (pid) => fotos.filter(f => f.pieza_id === pid).sort((a, b) => {
    const order = ["dial", "full", "bisel", "corona", "tapa", "bracelet"];
    return order.indexOf(a.posicion) - order.indexOf(b.posicion);
  });

  const waLink = (piece) => {
    const msg = encodeURIComponent(`Hola, me interesa el ${piece.name || ""} (SKU: ${piece.sku || ""}). ¿Está disponible?`);
    return `https://wa.me/${waNum}?text=${msg}`;
  };

  if (selected) {
    const p = selected;
    const pFotos = getFotos(p.id);
    return (
      <div className="min-h-screen pb-24" style={{ background: "var(--nv)" }}>
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3" style={{ background: "rgba(11,29,51,.95)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(201,169,110,.1)" }}>
          <button onClick={() => { setSelected(null); setPhotoIdx(0); }} className="p-2 rounded-xl" style={{ color: "var(--gd)" }}>←</button>
          <div className="flex-1 truncate"><span className="fd text-sm font-semibold text-white">{p.name}</span></div>
        </div>

        {/* Photo Gallery */}
        {pFotos.length > 0 ? (
          <div className="relative" style={{ aspectRatio: "1" }}>
            <img src={pFotos[photoIdx % pFotos.length]?.url} alt="" className="w-full h-full object-cover" />
            {pFotos.length > 1 && (
              <>
                <button onClick={() => setPhotoIdx(i => (i - 1 + pFotos.length) % pFotos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,.5)", color: "white" }}>‹</button>
                <button onClick={() => setPhotoIdx(i => (i + 1) % pFotos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,.5)", color: "white" }}>›</button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {pFotos.map((_, i) => <div key={i} className="w-2 h-2 rounded-full" style={{ background: i === photoIdx % pFotos.length ? "var(--gd)" : "rgba(255,255,255,.3)" }} />)}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center" style={{ aspectRatio: "1", background: "var(--n2)" }}>
            <span className="text-6xl opacity-20">⌚</span>
          </div>
        )}

        {/* Info */}
        <div className="p-4 space-y-4">
          <div>
            <div className="fb text-xs uppercase tracking-widest mb-1" style={{ color: "var(--gk)" }}>{p.brand}</div>
            <h1 className="fd text-2xl font-bold text-white">{p.model || p.name}</h1>
            {p.ref && <div className="fb text-sm mt-1" style={{ color: "var(--cd)" }}>Ref. {p.ref}</div>}
          </div>
          {showPrices && p.price_asked > 0 && (
            <div className="fd text-3xl font-bold" style={{ color: "var(--gd)" }}>{fmxn(p.price_asked)} <span className="text-base font-normal" style={{ color: "var(--cd)" }}>MXN</span></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {p.condition && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Condición</div><div className="fb text-sm font-semibold text-white">{p.condition}</div></div>}
            {p.auth_level && p.auth_level !== "NONE" && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Autenticación</div><div className="fb text-sm font-semibold text-white">{AUTHS.find(a => a.c === p.auth_level)?.n || p.auth_level}</div></div>}
          </div>
          {p.catalog_description && <div className="fb text-sm leading-relaxed" style={{ color: "var(--cd)" }}>{p.catalog_description}</div>}
          {p.sku && <div className="fb text-xs" style={{ color: "rgba(255,255,255,.2)" }}>SKU: {p.sku}</div>}
        </div>

        {/* WhatsApp CTA */}
        {waNum && (
          <div className="fixed bottom-0 left-0 right-0 p-4" style={{ background: "linear-gradient(transparent, rgba(11,29,51,.95) 30%)" }}>
            <a href={waLink(p)} target="_blank" rel="noopener"
              className="fb flex items-center justify-center gap-3 w-full py-4 rounded-2xl text-white font-bold text-base"
              style={{ background: "#25D366" }}>
              <Ico d={IC.wa} s={22} />Consultar por WhatsApp
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8" style={{ background: "var(--nv)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-4" style={{ background: "rgba(11,29,51,.95)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(201,169,110,.1)" }}>
        <div className="text-center">
          <div className="fd text-xl font-bold text-white tracking-tight">{bizName}</div>
          <div className="fb text-xs mt-0.5" style={{ color: "var(--gk)" }}>{pieces.length} pieza{pieces.length !== 1 ? "s" : ""} disponible{pieces.length !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-3 lg:grid-cols-4 md:gap-4 md:p-4">
        {pieces.map(p => {
          const pFotos = getFotos(p.id);
          const mainFoto = pFotos[0];
          return (
            <button key={p.id} onClick={() => setSelected(p)} className="text-left rounded-2xl overflow-hidden transition-all hover:scale-[1.02] active:scale-[.98]" style={{ background: "var(--n2)", border: "1px solid rgba(255,255,255,.06)" }}>
              <div className="relative" style={{ aspectRatio: "1" }}>
                {mainFoto ? <img src={mainFoto.url} alt={p.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--ns)" }}><span className="text-4xl opacity-20">⌚</span></div>}
                {pFotos.length > 1 && <div className="absolute top-2 right-2 fb text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,.6)", color: "white" }}>{pFotos.length} 📷</div>}
              </div>
              <div className="p-3">
                <div className="fb text-xs" style={{ color: "var(--gk)" }}>{p.brand}</div>
                <div className="fb text-sm font-semibold text-white truncate">{p.model || p.name}</div>
                {showPrices && p.price_asked > 0 && <div className="fd text-base font-bold mt-1" style={{ color: "var(--gd)" }}>{fmxn(p.price_asked)}</div>}
              </div>
            </button>
          );
        })}
      </div>

      {pieces.length === 0 && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4 opacity-30">⌚</div>
          <div className="fd text-xl font-semibold text-white">Próximamente</div>
          <div className="fb text-sm mt-2" style={{ color: "var(--cd)" }}>Nuevas piezas en camino</div>
        </div>
      )}

      {/* WhatsApp float */}
      {waNum && (
        <a href={`https://wa.me/${waNum}?text=${encodeURIComponent("Hola, me interesa consultar su catálogo de relojes")}`} target="_blank" rel="noopener"
          className="fixed bottom-4 right-4 w-14 h-14 rounded-full flex items-center justify-center shadow-lg z-30"
          style={{ background: "#25D366", color: "white" }}>
          <Ico d={IC.wa} s={28} />
        </a>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGIN SCREEN (Supabase Auth)
   ═══════════════════════════════════════════════════════════════════ */
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (!email || !pass) return;
    setLoading(true); setErr("");
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      onLogin(data.user);
    } catch (e) { setErr(e.message || "Error de autenticación"); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(145deg,#060E1A,var(--nv),#0A1525)" }}>
      <div className="w-full max-w-sm au">
        <div className="text-center mb-10">
          <div className="fd text-4xl font-bold text-white tracking-tight leading-none">
            <span className="block text-lg font-medium tracking-[.3em] mb-1" style={{ color: "var(--gd)" }}>THE</span>WRIST
            <span className="block text-2xl font-medium tracking-[.15em] mt-0.5" style={{ color: "var(--cd)" }}>ROOM</span>
          </div>
          <div className="fb text-xs mt-4 tracking-widest uppercase" style={{ color: "var(--gk)" }}>Sistema de Administración v13</div>
        </div>
        <div className="rounded-2xl p-6" style={{ background: "var(--n2)", border: "1px solid rgba(201,169,110,.12)", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
          <Fl label="Email"><input type="email" className="ti" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></Fl>
          <Fl label="Contraseña"><input type="password" className="ti" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" onKeyDown={e => { if (e.key === "Enter") go(); }} /></Fl>
          {err && <div className="fb text-xs text-center mb-3" style={{ color: "var(--rd)" }}>{err}</div>}
          <BtnP onClick={go} disabled={loading} full>{loading ? "Ingresando..." : "Ingresar"}</BtnP>
          <div className="text-center mt-4">
            <a href="?catalog" className="fb text-xs hover:underline" style={{ color: "var(--gd)" }}>Ver catálogo público →</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PIECE FORM — Full form with photos, docs, custom refs
   ═══════════════════════════════════════════════════════════════════ */
function PcForm({ piece, onSave, onClose, allPieces, fotos, customRefs }) {
  const autoSku = piece?.sku || genSku(allPieces);
  const blank = { id: uid(), sku: autoSku, name: "", brand: "", model: "", ref: "", serial: "", condition: "Excelente", auth_level: "SERIAL", fondo_id: "FIC", entry_type: "adquisicion", entry_date: td(), cost: 0, price_dealer: 0, price_asked: 0, price_trade: 0, status: "Disponible", stage: "inventario", notes: "", publish_catalog: false, catalog_description: "" };
  const [f, sF] = useState(piece ? { ...blank, ...piece } : blank);
  const u = (k, v) => sF(p => ({ ...p, [k]: v }));
  const autoName = (b, m) => [b, m].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      {/* Watch ID */}
      <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
        <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Identificación del Reloj</div>
        <WatchRefSelector brand={f.brand} model={f.model} refNum={f.ref} customRefs={customRefs}
          onChange={(field, val) => {
            if (field === "brand") sF(p => ({ ...p, brand: val, model: "", ref: "", name: val }));
            else if (field === "model") sF(p => ({ ...p, model: val, ref: getRefs(p.brand, val)[0] || "", name: autoName(p.brand, val) }));
            else u("ref", val);
          }} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Fl label="Nombre (auto)" hint="Marca + Modelo"><input className="ti" value={f.name} onChange={e => u("name", e.target.value)} style={{ fontWeight: 600 }} /></Fl>
          <Fl label="SKU" hint="Auto-asignado"><input className="ti" value={f.sku} readOnly /></Fl>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Fl label="Número de Serie"><input className="ti" value={f.serial || ""} onChange={e => u("serial", e.target.value)} /></Fl>
        <Fl label="Condición"><select className="ti" value={f.condition} onChange={e => u("condition", e.target.value)}>{CONDS.map(c => <option key={c} value={c}>{c}</option>)}</select></Fl>
        <Fl label="Autenticación"><select className="ti" value={f.auth_level} onChange={e => u("auth_level", e.target.value)}>{AUTHS.map(a => <option key={a.c} value={a.c}>Nv.{a.l} — {a.n}</option>)}</select></Fl>
      </div>

      {/* Origen del recurso */}
      <div className="rounded-xl p-4" style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.12)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--bl)" }}>↓ Origen del Recurso</span>
          <span className="fb text-xs" style={{ color: "var(--cd)" }}>— ¿De dónde sale el dinero?</span>
        </div>
        <FundSel value={f.fondo_id} onChange={v => u("fondo_id", v)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Fl label="Motivo de Entrada" req><select className="ti" value={f.entry_type} onChange={e => u("entry_type", e.target.value)}>{ETYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Fl>
        <Fl label="Fecha Entrada" req><input type="date" className="ti" value={f.entry_date} onChange={e => u("entry_date", e.target.value)} /></Fl>
      </div>

      {/* Pricing */}
      <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.12)" }}>
        <Fl label="Precio Costo (MXN)" req>
          <input type="number" className="ti" style={{ fontSize: 18, fontWeight: 700 }} value={f.cost || ""}
            onChange={e => { const n = Number(e.target.value); sF(p => ({ ...p, cost: n, ...calcPr(n) })); }} />
        </Fl>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Fl label="Dealer +8%"><input type="number" className="ti" value={f.price_dealer || ""} onChange={e => u("price_dealer", Number(e.target.value))} /></Fl>
          <Fl label="Lista +15%"><input type="number" className="ti" value={f.price_asked || ""} onChange={e => u("price_asked", Number(e.target.value))} /></Fl>
          <Fl label="Trade +20%"><input type="number" className="ti" value={f.price_trade || ""} onChange={e => u("price_trade", Number(e.target.value))} /></Fl>
        </div>
      </div>

      {/* Photos (only for existing pieces) */}
      {piece && <PhotoUploader pieceId={piece.id} fotos={fotos} onUpload={() => {}} />}

      {/* Catalog toggle */}
      <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={f.publish_catalog || false} onChange={e => u("publish_catalog", e.target.checked)} className="w-4 h-4 rounded" />
          <span className="fb text-sm font-medium text-white">Publicar en catálogo público</span>
        </label>
      </div>
      {f.publish_catalog && <Fl label="Descripción para catálogo"><textarea className="ti" rows={2} value={f.catalog_description || ""} onChange={e => u("catalog_description", e.target.value)} placeholder="Descripción visible en el catálogo público..." /></Fl>}

      <Fl label="Notas internas"><textarea className="ti" rows={2} value={f.notes || ""} onChange={e => u("notes", e.target.value)} /></Fl>
      <div className="flex gap-3 pt-2"><BtnP onClick={() => onSave(f)}>Guardar Pieza</BtnP><BtnS onClick={onClose}>Cancelar</BtnS></div>
    </div>
  );
}

/* ═══ SELL FORM ═══ */
function SellForm({ piece, onSave, onClose, docs }) {
  const [f, sF] = useState({ xPrice: piece.price_asked || 0, xDate: td(), cDate: td(), payOut: "SPEI", xType: "venta", xFund: "FIC" });
  const u = (k, v) => sF(p => ({ ...p, [k]: v }));
  const c = piece.cost || 0;
  const pr = f.xPrice - c;

  return (
    <div className="space-y-4">
      <Cd className="p-4">
        <div className="fd font-semibold text-white">{piece.name}</div>
        <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>SKU: {piece.sku} · CTM: {fmxn(c)} · Origen: {FUND_INFO[piece.fondo_id]?.short || piece.fondo_id}</div>
      </Cd>

      <div className="grid grid-cols-2 gap-3">
        <Fl label="Tipo de Salida"><select className="ti" value={f.xType} onChange={e => u("xType", e.target.value)}><option value="venta">Venta</option><option value="retorno_consignacion">Retorno consignación</option></select></Fl>
        <Fl label="Precio de Venta" req><input type="number" className="ti" value={f.xPrice} onChange={e => u("xPrice", Number(e.target.value))} /></Fl>
      </div>

      {/* Destino del recurso */}
      <div className="rounded-xl p-4" style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.12)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gn)" }}>↑ Destino del Recurso</span>
          <span className="fb text-xs" style={{ color: "var(--cd)" }}>— ¿A qué fondo entra el dinero?</span>
        </div>
        <FundSel value={f.xFund} onChange={v => u("xFund", v)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Fl label="Fecha Venta"><input type="date" className="ti" value={f.xDate} onChange={e => u("xDate", e.target.value)} /></Fl>
        <Fl label="Fecha Cobro"><input type="date" className="ti" value={f.cDate} onChange={e => u("cDate", e.target.value)} /></Fl>
        <Fl label="Método"><select className="ti" value={f.payOut} onChange={e => u("payOut", e.target.value)}>{PAYS.map(m => <option key={m} value={m}>{m}</option>)}</select></Fl>
      </div>

      {/* Profit preview */}
      {f.xPrice > 0 && (
        <div className="rounded-xl p-4" style={{ background: pr >= 0 ? "rgba(74,222,128,.06)" : "rgba(251,113,133,.06)", border: pr >= 0 ? "1px solid rgba(74,222,128,.15)" : "1px solid rgba(251,113,133,.15)" }}>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Utilidad</span><br /><span className="fd font-bold text-lg" style={{ color: pr >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(pr)}</span></div>
            {PARTNERS.map(p => <div key={p.id}><span className="fb text-xs" style={{ color: p.color }}>{p.short} {p.pct}%</span><br /><span className="fd font-bold text-white">{fmxn(Math.round(pr * (p.pct / 100)))}</span></div>)}
          </div>
        </div>
      )}

      {/* Documents */}
      <DocUploader entityType="venta" entityId={piece.id} requiredDocs={["identificacion", "contrato", "comprobante_pago"]} docs={docs} onUpload={() => {}} />

      <div className="flex gap-3 pt-2">
        <BtnG onClick={() => onSave({ ...piece, status: "Vendido", stage: "liquidado", exit_type: f.xType, exit_fund: f.xFund, ...f })}>Registrar Venta</BtnG>
        <BtnS onClick={onClose}>Cancelar</BtnS>
      </div>
    </div>
  );
}

/* ═══ TRADE FORM (multi-piece) ═══ */
function TradeForm({ piece, allPieces, onSave, onClose }) {
  const avail = (allPieces || []).filter(p => p.status === "Disponible" && p.id !== piece.id);
  const [outIds, setOutIds] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [cashDiff, setCashDiff] = useState(0);
  const [date, setDate] = useState(td());

  const addIn = () => setIncoming(p => [...p, { id: uid(), brand: "", model: "", ref: "", value: 0 }]);
  const updIn = (id, k, v) => setIncoming(p => p.map(x => x.id === id ? { ...x, [k]: v } : x));
  const remIn = (id) => setIncoming(p => p.filter(x => x.id !== id));
  const togOut = (pid) => setOutIds(p => p.includes(pid) ? p.filter(x => x !== pid) : [...p, pid]);

  const allOut = [piece, ...avail.filter(p => outIds.includes(p.id))];
  const totalOut = allOut.reduce((s, p) => s + (p.cost || 0), 0);
  const totalIn = incoming.reduce((s, p) => s + (p.value || 0), 0);
  const isValid = incoming.length > 0 && incoming.some(i => i.brand && i.value > 0);

  return (
    <div className="space-y-4">
      {/* Out */}
      <div className="rounded-xl p-4" style={{ background: "rgba(251,113,133,.04)", border: "1px solid rgba(251,113,133,.1)" }}>
        <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--rd)" }}>⬆ Piezas que salen</div>
        <div className="p-2.5 rounded-lg mb-2" style={{ background: "rgba(251,113,133,.08)" }}>
          <div className="flex justify-between"><span className="fb text-sm font-semibold text-white">{piece.name}</span><span className="fb text-sm font-bold" style={{ color: "var(--rd)" }}>{fmxn(piece.cost)}</span></div>
        </div>
        {avail.length > 0 && <div className="space-y-1 max-h-28 overflow-y-auto scr mt-2">
          {avail.map(p => <button key={p.id} type="button" onClick={() => togOut(p.id)} className="w-full flex justify-between p-2 rounded-lg text-left" style={{ background: outIds.includes(p.id) ? "rgba(251,113,133,.1)" : "rgba(255,255,255,.02)" }}><span className="fb text-xs text-white">{p.name}</span><span className="fb text-xs" style={{ color: "var(--cd)" }}>{fmxn(p.cost)}</span></button>)}
        </div>}
        <div className="flex justify-between pt-2 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <span className="fb text-xs font-bold" style={{ color: "var(--rd)" }}>Total ({allOut.length})</span>
          <span className="fd font-bold" style={{ color: "var(--rd)" }}>{fmxn(totalOut)}</span>
        </div>
      </div>

      {/* In */}
      <div className="rounded-xl p-4" style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.1)" }}>
        <div className="flex justify-between items-center mb-3">
          <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gn)" }}>⬇ Piezas que entran</div>
          <button type="button" onClick={addIn} className="fb text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.15)", color: "var(--gn)" }}>+ Agregar</button>
        </div>
        {incoming.length === 0 && <div className="fb text-sm text-center py-4" style={{ color: "var(--cd)" }}>Agrega al menos 1 pieza</div>}
        {incoming.map(item => {
          const ms = getModels(item.brand); const rs = getRefs(item.brand, item.model);
          return (
            <div key={item.id} className="p-3 rounded-lg mb-2" style={{ background: "rgba(74,222,128,.06)" }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.brand} onChange={e => { updIn(item.id, "brand", e.target.value); updIn(item.id, "model", ""); }}>
                  <option value="">Marca...</option>{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {ms.length > 0 ? <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} onChange={e => updIn(item.id, "model", e.target.value)}><option value="">Modelo...</option>{ms.map(m => <option key={m} value={m}>{m}</option>)}</select>
                  : <input className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} placeholder="Modelo" onChange={e => updIn(item.id, "model", e.target.value)} />}
                {rs.length > 0 ? <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} onChange={e => updIn(item.id, "ref", e.target.value)}><option value="">Ref...</option>{rs.map(r => <option key={r} value={r}>{r}</option>)}</select>
                  : <input className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} placeholder="Ref." onChange={e => updIn(item.id, "ref", e.target.value)} />}
                <div className="flex gap-1"><input type="number" className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px", fontWeight: 700 }} placeholder="Valor $" value={item.value || ""} onChange={e => updIn(item.id, "value", Number(e.target.value))} /><BtnD onClick={() => remIn(item.id)}>✕</BtnD></div>
              </div>
            </div>
          );
        })}
        {totalIn > 0 && <div className="flex justify-between pt-2 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}><span className="fb text-xs font-bold" style={{ color: "var(--gn)" }}>Total ({incoming.length})</span><span className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(totalIn)}</span></div>}
      </div>

      {/* Cash + Date */}
      <div className="grid grid-cols-2 gap-3">
        <Fl label="Diferencia en efectivo" hint="+ recibimos / − pagamos"><input type="number" className="ti" value={cashDiff} onChange={e => setCashDiff(Number(e.target.value))} /></Fl>
        <Fl label="Fecha"><input type="date" className="ti" value={date} onChange={e => setDate(e.target.value)} /></Fl>
      </div>

      {/* Balance */}
      <div className="rounded-xl p-4 grid grid-cols-4 gap-2 text-center" style={{ background: "rgba(201,169,110,.08)" }}>
        <div><div className="fb text-xs" style={{ color: "var(--rd)" }}>Sale</div><div className="fd font-bold text-white">{fmxn(totalOut)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--gn)" }}>Entra</div><div className="fd font-bold text-white">{fmxn(totalIn)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Dif $</div><div className="fd font-bold" style={{ color: cashDiff >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(cashDiff)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--gd)" }}>Neto</div><div className="fd font-bold" style={{ color: (totalIn + cashDiff - totalOut) >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(totalIn + cashDiff - totalOut)}</div></div>
      </div>

      {/* Docs */}
      <DocUploader entityType="trade" entityId={piece.id} requiredDocs={["identificacion", "contrato"]} docs={[]} onUpload={() => {}} />

      <div className="flex gap-3 pt-2"><BtnG onClick={() => onSave({ outPieces: allOut, incoming, cashDiff, date })} disabled={!isValid}>Registrar Trade</BtnG><BtnS onClick={onClose}>Cancelar</BtnS></div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN APPLICATION
   ═══════════════════════════════════════════════════════════════════ */
export default function App() {
  // Check if public catalog route
  if (typeof window !== "undefined" && (window.location.search.includes("catalog") || window.location.pathname === "/catalogo")) {
    return <PublicCatalog />;
  }

  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [side, setSide] = useState(window.innerWidth > 768);
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // Auth check
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); loadData(); }
      else setLoading(false);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      if (session?.user) { setUser(session.user); loadData(); }
      else { setUser(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async () => {
    try {
      const d = await db.loadAll();
      setData(d);
    } catch (e) { console.error("Load error:", e); }
    setLoading(false);
  };

  const refresh = useCallback(async () => { await loadData(); }, []);

  const cm = useCallback(() => { setModal(null); setSel(null); setDocs([]); }, []);

  const comp = useMemo(() => {
    if (!data) return {};
    const ps = data.pieces || [];
    const txs = data.txs || [];
    const inv = ps.filter(p => p.status === "Disponible");
    const sold = ps.filter(p => p.status === "Vendido" || p.status === "Liquidado");
    const invC = inv.reduce((s, p) => s + (p.cost || 0), 0);
    let cash = 0; txs.forEach(t => { if (t.fondo_id === "FIC") cash += (t.monto || 0); });
    const rp = sold.reduce((s, p) => { const x = txs.find(t => t.pieza_id === p.id && t.tipo === "SELL"); return x ? s + (x.monto || 0) - (p.cost || 0) : s; }, 0);
    const cap = txs.filter(t => t.tipo === "CAPITAL").reduce((s, t) => s + (t.monto || 0), 0);
    return { inv, sold, invC, cash, rp, cap, nav: cash + invC, moic: cap > 0 ? (cash + invC) / cap : 0 };
  }, [data]);

  const fp = useMemo(() => {
    if (!data) return [];
    const s = q.toLowerCase();
    return (data.pieces || []).filter(p => !s || (p.name || "").toLowerCase().includes(s) || (p.brand || "").toLowerCase().includes(s) || (p.sku || "").toLowerCase().includes(s) || (p.ref || "").toLowerCase().includes(s));
  }, [data, q]);

  /* ═══ HANDLERS ═══ */
  const hAddPc = useCallback(async (p) => {
    try {
      await db.savePiece(p);
      await db.saveTx({ id: uid(), fecha: p.entry_date, tipo: p.entry_type === "trade_in" ? "TRADE" : "BUY", pieza_id: p.id, monto: p.entry_type === "trade_in" ? 0 : -(p.cost || 0), fondo_id: p.fondo_id, descripcion: `${etLabel(p.entry_type)} — ${p.name}`, metodo_pago: "SPEI" });
      showToast(`${p.name} registrada`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm]);

  const hUpdPc = useCallback(async (p) => {
    try { await db.savePiece(p); showToast("Pieza actualizada"); await refresh(); cm(); }
    catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm]);

  const hSell = useCallback(async (p) => {
    try {
      await db.savePiece({ id: p.id, status: "Vendido", stage: "liquidado", exit_type: p.xType, exit_fund: p.xFund });
      await db.saveTx({ id: uid(), fecha: p.xDate, tipo: "SELL", pieza_id: p.id, monto: p.xPrice, fondo_id: p.xFund, descripcion: `Venta ${p.name} → ${FUND_INFO[p.xFund]?.short}`, metodo_pago: p.payOut });
      showToast(`Venta registrada: ${p.name}`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm]);

  const hTrade = useCallback(async (td_) => {
    try {
      const { outPieces, incoming, cashDiff, date } = td_;
      const trRef = "TR-" + Date.now().toString(36).slice(-5).toUpperCase();

      for (const op of outPieces) {
        await db.savePiece({ id: op.id, status: "Vendido", stage: "liquidado", exit_type: "trade_out", trade_ref: trRef });
      }
      for (const item of incoming) {
        const np = { id: uid(), sku: genSku(data.pieces), name: [item.brand, item.model].filter(Boolean).join(" "), brand: item.brand, model: item.model, ref: item.ref, condition: "Excelente", auth_level: "VISUAL", fondo_id: outPieces[0].fondo_id, entry_type: "trade_in", entry_date: date, cost: item.value, ...calcPr(item.value), status: "Disponible", stage: "inventario", notes: `Trade ${trRef}`, trade_ref: trRef };
        await db.savePiece(np);
      }
      await db.saveTx({ id: uid(), fecha: date, tipo: "TRADE", pieza_id: outPieces[0].id, monto: cashDiff, fondo_id: outPieces[0].fondo_id, descripcion: `Trade ${trRef}: ${outPieces.map(p => p.name).join(" + ")} → ${incoming.map(i => [i.brand, i.model].filter(Boolean).join(" ")).join(" + ")}`, metodo_pago: cashDiff !== 0 ? "Trade+Cash" : "Trade", trade_ref: trRef });

      showToast(`Trade ${trRef} registrado`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data]);

  const hCap = useCallback(async (amt, desc, partner) => {
    try {
      await db.saveTx({ id: uid(), fecha: td(), tipo: "CAPITAL", monto: amt, fondo_id: "FIC", descripcion: desc || "Inyección de capital", metodo_pago: "SPEI", partner_id: partner });
      showToast("Capital registrado");
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm]);

  const logout = async () => { await sb.auth.signOut(); setUser(null); setData(null); };

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--nv)" }}><div className="fd text-2xl font-bold text-white animate-pulse">W</div></div>;
  if (!user) return <LoginScreen onLogin={u => { setUser(u); loadData(); }} />;
  if (!data) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--nv)" }}><div className="fd text-xl text-white">Cargando datos...</div></div>;

  const navI = [
    { id: "dashboard", i: IC.dash, l: "Dashboard" },
    { id: "inventory", i: IC.inv, l: "Inventario" },
    { id: "transactions", i: IC.tx, l: "Transacciones" },
    { id: "cortes", i: IC.cal, l: "Cortes" },
    { id: "catalogs", i: IC.cat, l: "Catálogos" },
    { id: "reports", i: IC.rep, l: "Reportes" },
    { id: "settings", i: IC.set, l: "Config" },
  ];

  const TH = ({ children, r }) => <th className={`fb text-xs font-semibold uppercase tracking-wider py-3 px-3 ${r ? "text-right" : "text-left"}`} style={{ color: "var(--gk)", borderBottom: "1px solid rgba(255,255,255,.06)" }}>{children}</th>;
  const TD = ({ children, r, b, a }) => <td className={`fb text-sm py-3 px-3 ${r ? "text-right" : ""} ${b ? "font-semibold" : ""}`} style={{ color: a || "var(--cr)", borderBottom: "1px solid rgba(255,255,255,.04)" }}>{children}</td>;

  return (
    <div className="min-h-screen fb flex" style={{ background: "var(--nv)" }}>
      {/* SIDEBAR */}
      <aside className={`${side ? "w-52" : "w-0 md:w-14"} flex flex-col transition-all duration-300 shrink-0 overflow-hidden`}
        style={{ background: "linear-gradient(180deg,#071525,var(--nv))", borderRight: "1px solid rgba(201,169,110,.08)" }}>
        <div className="p-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(201,169,110,.08)" }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 fd font-bold text-sm" style={{ background: "var(--gd)", color: "var(--nv)" }}>W</div>
          {side && <div><div className="fd text-sm font-bold text-white leading-none">The Wrist</div><div className="fd text-xs" style={{ color: "var(--gk)" }}>Room v13</div></div>}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navI.map(n => <button key={n.id} onClick={() => { setPage(n.id); if (window.innerWidth < 768) setSide(false); }} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition-all ${page === n.id ? "" : "hover:bg-white/[.03]"}`} style={page === n.id ? { background: "rgba(201,169,110,.1)", color: "var(--gd)" } : { color: "var(--cd)" }}><Ico d={n.i} s={16} />{side && <span className="font-medium text-sm">{n.l}</span>}</button>)}
        </nav>
        <div className="p-2" style={{ borderTop: "1px solid rgba(201,169,110,.08)" }}>
          {side && <div className="px-2 mb-2"><div className="text-xs font-semibold text-white truncate">{user.email}</div></div>}
          <div className="flex gap-1">
            <button onClick={() => setSide(!side)} className="flex-1 text-center py-1.5 rounded-lg text-xs hover:bg-white/5" style={{ color: "var(--cd)" }}>{side ? "◂" : "▸"}</button>
            {side && <button onClick={logout} className="flex-1 py-1.5 rounded-lg text-xs hover:bg-white/5" style={{ color: "var(--rd)" }}>Salir</button>}
          </div>
        </div>
      </aside>

      {/* Mobile hamburger */}
      {!side && <button onClick={() => setSide(true)} className="fixed top-3 left-3 z-30 md:hidden w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--n2)", border: "1px solid rgba(201,169,110,.15)" }}><span style={{ color: "var(--gd)" }}>☰</span></button>}

      <main className="flex-1 overflow-y-auto scr"><div className="max-w-6xl mx-auto p-4 md:p-8">

        {/* ═══ DASHBOARD ═══ */}
        {page === "dashboard" && (
          <div className="space-y-5 au">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h1 className="fd text-2xl md:text-3xl font-bold text-white">Dashboard</h1></div>
              <div className="flex gap-2"><BtnP onClick={() => setModal("ap")}><span className="flex items-center gap-1.5"><Ico d={IC.plus} s={14} />Pieza</span></BtnP><BtnS onClick={() => setModal("ac")}>Capital</BtnS></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <St label="Capital" value={fmxn(comp.cap)} />
              <St label="NAV" value={fmxn(comp.nav)} accent="var(--bl)" />
              <St label="Utilidad" value={fmxn(comp.rp)} accent="var(--gn)" />
              <St label="MOIC" value={`${(comp.moic || 0).toFixed(2)}x`} accent="var(--pr)" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {FUNDS.map(fk => <Cd key={fk} className="p-4"><div className="flex items-center gap-2 mb-1"><span>{FUND_INFO[fk].icon}</span><span className="fb font-semibold text-sm text-white">{FUND_INFO[fk].full}</span></div><div className="fb text-xs" style={{ color: "var(--cd)" }}>{FUND_INFO[fk].desc}</div></Cd>)}
            </div>
            <Cd>
              <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                <h3 className="fd font-semibold text-white">Inventario Activo ({comp.inv?.length || 0})</h3>
                <button className="fb text-xs" style={{ color: "var(--gd)" }} onClick={() => setPage("inventory")}>Ver todo →</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full"><thead><tr><TH>Pieza</TH><TH>Origen</TH><TH r>Costo</TH><TH r>Lista</TH><TH>Status</TH></tr></thead>
                  <tbody>{(comp.inv || []).slice(0, 10).map(p => <tr key={p.id} className="hover:bg-white/[.02]"><TD b>{p.name}</TD><TD><Bd text={FUND_INFO[p.fondo_id]?.short || p.fondo_id} v="gold" /></TD><TD r>{fmxn(p.cost)}</TD><TD r a="var(--gd)">{fmxn(p.price_asked)}</TD><TD><Bd text={p.status} v="green" /></TD></tr>)}</tbody>
                </table>
              </div>
            </Cd>
          </div>
        )}

        {/* ═══ INVENTORY ═══ */}
        {page === "inventory" && (
          <div className="space-y-5 au">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="fd text-2xl md:text-3xl font-bold text-white">Inventario</h1>
              <BtnP onClick={() => setModal("ap")}><span className="flex items-center gap-1.5"><Ico d={IC.plus} s={14} />Nueva Pieza</span></BtnP>
            </div>
            <div className="relative"><div className="absolute left-3 top-3" style={{ color: "var(--cd)" }}><Ico d={IC.srch} s={16} /></div><input className="ti" style={{ paddingLeft: 36 }} placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} /></div>
            <Cd>
              <div className="overflow-x-auto">
                <table className="w-full"><thead><tr><TH>SKU</TH><TH>Pieza</TH><TH>Motivo</TH><TH>Origen</TH><TH r>Costo</TH><TH r>Lista</TH><TH>Status</TH><TH></TH></tr></thead>
                  <tbody>{fp.map(p => (
                    <tr key={p.id} className="hover:bg-white/[.02]">
                      <TD><span className="font-mono text-xs" style={{ color: "var(--cd)" }}>{p.sku || "—"}</span></TD>
                      <TD b>{p.name} {p.publish_catalog && <span title="En catálogo público" style={{ color: "var(--gn)" }}>●</span>}</TD>
                      <TD><Bd text={etLabel(p.entry_type)} v={p.entry_type === "trade_in" ? "gold" : "blue"} /></TD>
                      <TD><Bd text={FUND_INFO[p.fondo_id]?.short || p.fondo_id || "—"} v="gold" /></TD>
                      <TD r>{fmxn(p.cost)}</TD><TD r a="var(--gd)">{fmxn(p.price_asked)}</TD>
                      <TD><Bd text={p.status} v={p.status === "Disponible" ? "green" : p.status === "Vendido" ? "purple" : "default"} /></TD>
                      <TD>
                        <div className="flex gap-1">
                          <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--cd)" }} onClick={() => { setSel(p); setModal("ep"); }}><Ico d={IC.edit} s={14} /></button>
                          {p.status === "Disponible" && <>
                            <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--gn)" }} onClick={() => { setSel(p); setModal("sell"); }}><Ico d={IC.chk} s={14} /></button>
                            <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--gd)" }} onClick={() => { setSel(p); setModal("trade"); }}><Ico d={IC.swap} s={14} /></button>
                          </>}
                        </div>
                      </TD>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Cd>
          </div>
        )}

        {/* ═══ TRANSACTIONS ═══ */}
        {page === "transactions" && (
          <div className="space-y-5 au">
            <div className="flex items-center justify-between"><h1 className="fd text-2xl md:text-3xl font-bold text-white">Transacciones</h1><BtnS onClick={() => setModal("ac")}>+ Capital</BtnS></div>
            <Cd>
              <div className="overflow-x-auto">
                <table className="w-full"><thead><tr><TH>Fecha</TH><TH>Tipo</TH><TH>Descripción</TH><TH>Fondo</TH><TH r>Monto</TH></tr></thead>
                  <tbody>{(data.txs || []).map(t => <tr key={t.id} className="hover:bg-white/[.02]"><TD><span className="text-xs" style={{ color: "var(--cd)" }}>{t.fecha}</span></TD><TD><Bd text={t.tipo} v={t.tipo === "SELL" ? "green" : t.tipo === "BUY" ? "red" : t.tipo === "CAPITAL" ? "blue" : "gold"} /></TD><TD>{t.descripcion}</TD><TD><Bd text={FUND_INFO[t.fondo_id]?.short || t.fondo_id || "—"} v="blue" /></TD><TD r a={(t.monto || 0) >= 0 ? "var(--gn)" : "var(--rd)"}>{(t.monto || 0) >= 0 ? "+" : ""}{fmxn(t.monto)}</TD></tr>)}</tbody>
                </table>
              </div>
            </Cd>
          </div>
        )}

        {/* ═══ CORTES ═══ */}
        {page === "cortes" && (
          <div className="space-y-5 au">
            <div className="flex items-center justify-between"><h1 className="fd text-2xl md:text-3xl font-bold text-white">Cortes Mensuales</h1><BtnP onClick={() => setModal("ct")}>+ Corte</BtnP></div>
            <div className="space-y-3">{(data.cortes || []).map(c => <Cd key={c.id} className="p-4"><div className="flex items-center gap-3 mb-2"><span className="fb text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>{c.id}</span><span className="fd font-semibold text-white">{c.periodo}</span><span className="fb text-sm" style={{ color: "var(--cd)" }}>{c.label}</span></div>{c.utilidad > 0 && <div className="grid grid-cols-4 gap-3 text-center py-2 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Utilidad</span><div className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(c.utilidad)}</div></div>{PARTNERS.map(p => <div key={p.id}><span className="fb text-xs" style={{ color: p.color }}>{p.short}</span><div className="fd font-bold text-white">{fmxn(c.splits?.[p.id] || 0)}</div></div>)}</div>}</Cd>)}</div>
          </div>
        )}

        {/* ═══ CATALOGS ═══ */}
        {page === "catalogs" && (
          <div className="space-y-5 au">
            <h1 className="fd text-2xl md:text-3xl font-bold text-white">Catálogos</h1>
            <Cd className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="fd font-semibold text-white">Catálogo Público</h3>
                <a href="?catalog" target="_blank" className="fb text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}><Ico d={IC.globe} s={14} />Ver catálogo</a>
              </div>
              <div className="fb text-sm" style={{ color: "var(--cd)" }}>
                {(data.pieces || []).filter(p => p.publish_catalog).length} piezas publicadas de {(data.pieces || []).filter(p => p.status === "Disponible").length} disponibles
              </div>
            </Cd>
            <Cd className="p-4">
              <h3 className="fd font-semibold text-white mb-3">Marcas y Modelos ({BRANDS.length} marcas)</h3>
              <div className="flex flex-wrap gap-2">{BRANDS.map(b => <span key={b} className="fb text-sm px-3 py-1.5 rounded-lg" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.1)", color: "var(--cr)" }}>{b} <span className="text-xs" style={{ color: "var(--cd)" }}>({getModels(b).length})</span></span>)}</div>
            </Cd>
            {(data.customRefs || []).length > 0 && (
              <Cd className="p-4">
                <h3 className="fd font-semibold text-white mb-3">Referencias Custom ({data.customRefs.length})</h3>
                <div className="space-y-1">{data.customRefs.map(r => <div key={r.id} className="flex items-center gap-3 fb text-sm p-2 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}><span className="text-white font-semibold">{r.brand} {r.model}</span><span style={{ color: "var(--cd)" }}>{r.ref_number}</span>{r.ai_validated && <Bd text="IA ✓" v="green" />}</div>)}</div>
              </Cd>
            )}
          </div>
        )}

        {/* ═══ REPORTS ═══ */}
        {page === "reports" && (
          <div className="space-y-5 au">
            <h1 className="fd text-2xl md:text-3xl font-bold text-white">Reportes</h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <St label="Total Piezas" value={String(data.pieces.length)} />
              <St label="Disponibles" value={String(comp.inv?.length || 0)} accent="var(--gn)" />
              <St label="Vendidas" value={String(comp.sold?.length || 0)} accent="var(--pr)" />
              <St label="ROI" value={comp.cap > 0 ? `${((comp.rp / comp.cap) * 100).toFixed(1)}%` : "—"} accent="var(--bl)" />
            </div>
            <Cd className="p-5">
              <h3 className="fd font-semibold text-white mb-4">Distribución de Utilidades</h3>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Total</span><div className="fd text-xl font-bold" style={{ color: "var(--gn)" }}>{fmxn(comp.rp)}</div></div>
                {pSplit(comp.rp).map(p => <div key={p.id}><span className="fb text-xs" style={{ color: p.color }}>{p.short} {p.pct}%</span><div className="fd text-lg font-bold text-white">{fmxn(p.share)}</div></div>)}
              </div>
            </Cd>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {page === "settings" && (
          <div className="space-y-5 au">
            <h1 className="fd text-2xl md:text-3xl font-bold text-white">Configuración</h1>
            <Cd className="p-5">
              <h3 className="fd font-semibold text-white mb-4">WhatsApp del Catálogo</h3>
              <Fl label="Número (con código de país, ej: 5219991234567)" hint="Se usa para el botón de contacto en el catálogo público">
                <div className="flex gap-2">
                  <input className="ti flex-1" value={data.settings?.whatsapp_number?.replace(/"/g, "") || ""} id="waInput" placeholder="5219991234567" />
                  <BtnP onClick={async () => { const v = document.getElementById("waInput")?.value; if (v) { await db.saveSetting("whatsapp_number", JSON.stringify(v)); showToast("WhatsApp actualizado"); await refresh(); } }}>Guardar</BtnP>
                </div>
              </Fl>
            </Cd>
            <Cd className="p-5">
              <h3 className="fd font-semibold text-white mb-4">Documentos Obligatorios por Operación</h3>
              <div className="fb text-sm" style={{ color: "var(--cd)" }}>
                Los documentos marcados como obligatorios se resaltan en rojo cuando no están subidos.
                Configura los requerimientos por tipo de operación en la tabla <code>app_settings</code> → key: <code>required_docs</code>.
              </div>
            </Cd>
            <Cd className="p-5">
              <h3 className="fd font-semibold text-white mb-3">Catálogo Público</h3>
              <div className="fb text-sm" style={{ color: "var(--cd)" }}>
                URL: <a href="?catalog" target="_blank" className="hover:underline" style={{ color: "var(--gd)" }}>{window.location.origin}?catalog</a>
              </div>
              <div className="fb text-sm mt-2" style={{ color: "var(--cd)" }}>
                Para publicar una pieza, edítala y activa "Publicar en catálogo público".
              </div>
            </Cd>
          </div>
        )}

      </div></main>

      {/* Toast */}
      {toast && <div className="fixed bottom-4 right-4 z-50 fb text-sm px-4 py-3 rounded-xl shadow-lg au" style={{ background: toast.type === "ok" ? "#166534" : "rgba(251,113,133,.2)", color: toast.type === "ok" ? "var(--gn)" : "var(--rd)" }}>{toast.msg}</div>}

      {/* MODALS */}
      <Md open={modal === "ap"} onClose={cm} title="Nueva Pieza — Entrada" wide><PcForm onSave={hAddPc} onClose={cm} allPieces={data.pieces} fotos={data.fotos} customRefs={data.customRefs} /></Md>
      <Md open={modal === "ep"} onClose={cm} title={"Editar — " + (sel?.name || "")} wide>{sel && <PcForm piece={sel} onSave={hUpdPc} onClose={cm} allPieces={data.pieces} fotos={data.fotos} customRefs={data.customRefs} />}</Md>
      <Md open={modal === "sell"} onClose={cm} title={"Venta — " + (sel?.name || "")} wide>{sel && <SellForm piece={sel} onSave={hSell} onClose={cm} docs={docs} />}</Md>
      <Md open={modal === "trade"} onClose={cm} title={"Trade-out — " + (sel?.name || "")} wide>{sel && <TradeForm piece={sel} allPieces={data.pieces} onSave={hTrade} onClose={cm} />}</Md>
      <Md open={modal === "ac"} onClose={cm} title="Inyección de Capital">{<CapitalForm onSave={hCap} onClose={cm} />}</Md>
      <Md open={modal === "ct"} onClose={cm} title="Nuevo Corte Mensual">{<CorteForm onSave={async (c) => { try { await db.saveCorte(c); showToast("Corte registrado"); await refresh(); cm(); } catch (e) { alert(e.message); } }} onClose={cm} />}</Md>
    </div>
  );
}

/* ═══ SMALL FORMS ═══ */
function CapitalForm({ onSave, onClose }) {
  const [amt, setAmt] = useState(""); const [desc, setDesc] = useState(""); const [partner, setPartner] = useState("fernando");
  return <div className="space-y-4">
    <Fl label="¿Quién inyecta?" req><div className="space-y-2">{PARTNERS.map(p => <button key={p.id} type="button" onClick={() => setPartner(p.id)} className="w-full flex items-center gap-3 p-3 rounded-xl" style={{ background: partner === p.id ? "rgba(201,169,110,.1)" : "rgba(255,255,255,.02)", border: partner === p.id ? "1.5px solid var(--gd)" : "1.5px solid rgba(255,255,255,.06)" }}><div className="w-8 h-8 rounded-lg flex items-center justify-center fb text-xs font-bold" style={{ background: `${p.color}20`, color: p.color }}>{p.pct}%</div><div className="text-left"><div className="fb text-sm font-semibold text-white">{p.name}</div></div>{partner === p.id && <div className="ml-auto" style={{ color: "var(--gd)" }}>✓</div>}</button>)}</div></Fl>
    <Fl label="Monto (MXN)" req><input type="number" className="ti" value={amt} onChange={e => setAmt(e.target.value)} /></Fl>
    <Fl label="Descripción"><input className="ti" value={desc} onChange={e => setDesc(e.target.value)} /></Fl>
    <div className="flex gap-3"><BtnP onClick={() => { if (amt) onSave(Number(amt), desc, partner); }}>Registrar</BtnP><BtnS onClick={onClose}>Cancelar</BtnS></div>
  </div>;
}

function CorteForm({ onSave, onClose }) {
  const [period, setP] = useState(td().slice(0, 7)); const [label, setL] = useState(""); const [util, setU] = useState(0);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3"><Fl label="Periodo" req><input type="month" className="ti" value={period} onChange={e => setP(e.target.value)} /></Fl><Fl label="Etiqueta"><input className="ti" value={label} onChange={e => setL(e.target.value)} /></Fl></div>
    <Fl label="Utilidad del periodo (MXN)"><input type="number" className="ti" value={util} onChange={e => setU(Number(e.target.value))} /></Fl>
    {util > 0 && <div className="grid grid-cols-4 gap-3 text-center rounded-xl p-3" style={{ background: "rgba(74,222,128,.06)" }}><div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Total</span><div className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(util)}</div></div>{PARTNERS.map(p => <div key={p.id}><span className="fb text-xs" style={{ color: p.color }}>{p.short}</span><div className="fd font-bold text-white">{fmxn(Math.round(util * (p.pct / 100)))}</div></div>)}</div>}
    <div className="flex gap-3"><BtnP onClick={() => onSave({ id: "C-" + uid().slice(0, 5), periodo: period, label: label || period, utilidad: util, splits: { fernando: Math.round(util * .4), socioA: Math.round(util * .3), socioB: Math.round(util * .3) }, decision: "reinvertir" })}>Cerrar Corte</BtnP><BtnS onClick={onClose}>Cancelar</BtnS></div>
  </div>;
}
