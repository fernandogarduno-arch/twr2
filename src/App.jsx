import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ═══════════════════════════════════════════════════════════════════
   THE WRIST ROOM — OPERATING SYSTEM v22 (SUPABASE + CATALOG + AI + MULTI-FUND)
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
const genSku = (existing) => { const now = td(); const pfx = "TWR-" + now.slice(2, 4) + now.slice(5, 7) + "-"; const nums = (existing || []).filter(p => p.sku?.startsWith(pfx)).map(p => parseInt(p.sku.slice(pfx.length), 10) || 0); const max = nums.length > 0 ? Math.max(...nums) : 0; return pfx + String(max + 1).padStart(4, "0"); };

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
    const [pz, tx, ct, fo, cl, su, st, cr, sc, pr, cp, fn] = await Promise.all([
      sb.from("piezas").select("*").order("created_at", { ascending: false }),
      sb.from("transacciones").select("*").order("fecha", { ascending: false }),
      sb.from("cortes").select("*").order("periodo", { ascending: false }),
      sb.from("pieza_fotos").select("*").is("deleted_at", null),
      sb.from("clientes").select("*"),
      sb.from("proveedores").select("*"),
      sb.from("app_settings").select("*"),
      sb.from("custom_referencias").select("*"),
      sb.from("socios").select("*").order("participacion", { ascending: false }),
      sb.from("profiles").select("*").order("name"),
      sb.from("costos_pieza").select("*"),
      sb.from("fondos").select("*").eq("activo", true),
    ]);
    return {
      pieces: pz.data || [], txs: tx.data || [], cortes: ct.data || [],
      fotos: fo.data || [], clients: cl.data || [], suppliers: su.data || [],
      settings: Object.fromEntries((st.data || []).map(s => [s.key, s.value])),
      customRefs: cr.data || [],
      socios: sc.data || [],
      profiles: pr.data || [],
      costos: cp.data || [],
      fondos: fn.data || [],
    };
  },
  async loadDocs(entType, entId) {
    const { data } = await sb.from("transaccion_docs").select("*").eq("entidad_tipo", entType).eq("entidad_id", entId);
    return data || [];
  },
  async savePiece(p) { const clean = { ...p }; ["supplier_id", "ref_id", "socio_aporta_id", "client_id", "validated_by", "exit_fund", "trade_ref", "devolucion_de"].forEach(k => { if (clean[k] === "" || clean[k] === undefined) clean[k] = null; }); ["cost","price_dealer","price_asked","price_trade","referenciada_comision"].forEach(k => { if (k in clean) clean[k] = Number(clean[k]) || 0; }); if (!clean.fondo_id || clean.fondo_id === "" || clean.fondo_id === "NA") clean.fondo_id = "FIC"; if (clean.inversionista_id && clean.inversionista_id.length < 10) clean.inversionista_id = null; const { error } = await sb.from("piezas").upsert(clean); if (error) throw error; },
  async saveTx(t) { const clean = { ...t }; if (clean.inversionista_id && clean.inversionista_id.length < 10) clean.inversionista_id = null; if (!clean.fondo_id || clean.fondo_id === "") clean.fondo_id = "FIC"; const { error } = await sb.from("transacciones").upsert(clean); if (error) throw error; },
  async saveCorte(c) { const { error } = await sb.from("cortes").upsert(c); if (error) throw error; },
  async saveClient(c) { const { error } = await sb.from("clientes").upsert(c); if (error) throw error; },
  async saveSupplier(s) { const { error } = await sb.from("proveedores").upsert(s); if (error) throw error; },
  async delSupplier(id) { const { error } = await sb.from("proveedores").delete().eq("id", id); if (error) throw error; },
  async delClient(id) { const { error } = await sb.from("clientes").delete().eq("id", id); if (error) throw error; },
  async delProfile(id) { const { error } = await sb.from("profiles").delete().eq("id", id); if (error) throw error; },
  async saveFoto(f) { const { data, error } = await sb.from("pieza_fotos").insert(f).select(); if (error) throw error; return data?.[0]; },
  async softDelFoto(id) { const { error } = await sb.from("pieza_fotos").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
  async saveDoc(d) { const { data, error } = await sb.from("transaccion_docs").insert(d).select(); if (error) throw error; return data?.[0]; },
  async saveSetting(key, value) { const { error } = await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw error; },
  async saveCustomRef(r) { const { data, error } = await sb.from("custom_referencias").upsert(r, { onConflict: "brand,model,ref_number" }).select(); if (error) throw error; return data?.[0]; },
  async loadCatalogPublic() {
    const { data } = await sb.from("piezas").select("*").eq("publish_catalog", true).order("catalog_order");
    const { data: fotos } = await sb.from("pieza_fotos").select("*").is("deleted_at", null);
    const { data: stData } = await sb.from("app_settings").select("*").in("key", ["whatsapp_number", "business_name", "catalog_config"]);
    return { pieces: data || [], fotos: fotos || [], settings: Object.fromEntries((stData || []).map(s => [s.key, s.value])) };
  },
  async trackContact(piezaId, tipo = "whatsapp") {
    try { await sb.from("catalog_contactos").insert({ pieza_id: piezaId, tipo }); } catch(e) { console.warn("Track err:", e); }
  },
  async loadContactStats() {
    const { data } = await sb.from("catalog_contactos").select("pieza_id, tipo, created_at");
    return data || [];
  },
  async loadCostos(piezaId) { const { data } = await sb.from("costos_pieza").select("*").eq("pieza_id", piezaId).order("fecha", { ascending: false }); return data || []; },
  async saveCosto(c) { const { error } = await sb.from("costos_pieza").upsert(c); if (error) throw error; },
  async delCosto(id) { const { error } = await sb.from("costos_pieza").delete().eq("id", id); if (error) throw error; },
  async loadAuditLog(limit = 50) { const { data } = await sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit); return data || []; },
  async loadEdits(piezaId) { const { data } = await sb.from("pieza_edits").select("*").eq("pieza_id", piezaId).order("editado_at", { ascending: false }); return data || []; },
  async saveValidacion(v) { const { data, error } = await sb.from("validaciones_ia").upsert(v).select().single(); if (error) throw error; return data; },
  async loadValidaciones(piezaId) { const { data } = await sb.from("validaciones_ia").select("*").eq("pieza_id", piezaId).order("created_at", { ascending: false }); return data || []; },
};

const CLAUDE_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
async function callClaude(images, prompt) {
  const content = [...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime || "image/jpeg", data: i.base64 } })), { type: "text", text: prompt }];
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [{ role: "user", content }] }) });
  if (!r.ok) throw new Error(`Claude API ${r.status}`);
  return (await r.json()).content?.[0]?.text || "";
}
async function imgToB64(url) { const r = await fetch(url); const b = await r.blob(); return new Promise(res => { const rd = new FileReader(); rd.onloadend = () => res({ base64: rd.result.split(",")[1], mime: b.type || "image/jpeg" }); rd.readAsDataURL(b); }); }

/* ═══ WATCH DATABASE ═══ */
const WDB = {
  Rolex: { Submariner:["126610LN","126610LV","124060"],  "GMT-Master II":["126710BLRO","126710BLNR","126720VTNR"], Daytona:["126500LN","116500LN","126506"], "Datejust 41":["126334","126300","126331"], "Datejust 36":["126234","126200"], Explorer:["124270","224270"], "Explorer II":["226570"], "Sea-Dweller":["126603","126600"], "Sky-Dweller":["326934","326933"], "Day-Date 40":["228236","228238"], "Oyster Perpetual":["124300","126000"] },
  Omega: { "Seamaster 300M":["210.30.42.20.01.001","210.30.42.20.03.001"], "Speedmaster Moonwatch":["310.30.42.50.01.001"], "Aqua Terra":["220.10.41.21.01.001"], Constellation:["131.10.39.20.01.001"] },
  Cartier: { Santos:["WSSA0018","WSSA0029","WSSA0030"], "Santos Dumont":["WGSA0021"], "Tank Française":["WSTA0065"], Panthère:["WSPN0007"], "Ballon Bleu":["WSBB0025"], "Santos Chronograph":["WSSA0060"] },
  Hublot: { "Classic Fusion":["542.NX.1171.RX","511.NX.1171.RX"], "Big Bang":["301.SB.131.RX"] },
  "TAG Heuer": { Carrera:["CBN2A1B.BA0643","CBS2210.BA0653"], Monaco:["CBL2111.BA0644"], Aquaracer:["WBP201A.BA0632"] },
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
const PAYS = ["Efectivo MXN","SPEI","Efectivo USD","Wire USD","Trade","Trade+Cash","Escrow","Tarjeta"];
const ETYPES = [{v:"adquisicion",l:"Adquisición"},{v:"trade_in",l:"Trade-in"},{v:"consignacion",l:"Consignación"}];
const DIAL_COLORS = ["Negro","Blanco","Azul","Verde","Gris","Plata","Champagne","Oro Rosa","Marrón","Burdeo","Rojo","Amarillo","Naranja","Madre Perla","Skeleton","Otro"];
const BEZEL_TYPES = ["Liso","Fluted","Giratorio Uni","Giratorio Bi","Tachymeter","GMT","Diamantes","Cerámico","Count-up","Ninguno","Otro"];
const STRAP_TYPES = ["Acero Oyster","Acero Jubilee","Acero President","Acero Integrado","Caucho","Piel Cocodrilo","Piel Becerro","NATO/Nylon","Titanio","Oro","Cerámica","Otro"];
const CASE_SIZES = ["24","26","28","30","31","33","34","36","37","38","39","40","41","42","43","44","45","46","47","48","50"];
const EXIT_TYPES = [{v:"venta",l:"Venta"},{v:"trade_out",l:"Trade Out"},{v:"retorno_consignacion",l:"Retorno consignación"}];
const ROLE_OPTS = ["superuser","operador","inversionista","readonly"];
const PERMS = {
  superuser:      { dash:true, inv:true, newPc:true, sell:true, tx:true, txEdit:false, cortes:true, cats:true, reports:true, cfgUsers:true, cfgSocios:true, cfgCat:true, del:true },
  director:       { dash:true, inv:true, newPc:true, sell:true, tx:true, txEdit:false, cortes:true, cats:true, reports:true, cfgUsers:false, cfgSocios:false, cfgCat:true, del:false },
  operador:       { dash:true, inv:true, newPc:true, sell:false, tx:true, txEdit:false, cortes:false, cats:true, reports:false, cfgUsers:false, cfgSocios:false, cfgCat:false, del:false },
  inversionista:  { dash:true, inv:true, newPc:false, sell:false, tx:false, txEdit:false, cortes:true, cats:false, reports:true, cfgUsers:false, cfgSocios:false, cfgCat:false, del:false },
  pending:        { dash:false, inv:false, newPc:false, sell:false, tx:false, txEdit:false, cortes:false, cats:false, reports:false, cfgUsers:false, cfgSocios:false, cfgCat:false, del:false },
};
const can = (role, perm) => (PERMS[role] || PERMS.pending)[perm] || false;
const SUPPLIER_TYPES = ["Particular","Dealer","Consignación","Subasta","Trade-in"];
const CLIENT_TIERS = ["Prospecto","Regular","VIP","Mayorista"];
const xtLabel = v => EXIT_TYPES.find(e => e.v === v)?.l || v;
// v22: Investors loaded from DB profiles
const buildInvestorInfo = (profiles) => {
  const info = {};
  (profiles || []).forEach(p => {
    if (p.role === "inversionista" || p.role === "superuser") {
      info[p.id] = { short: p.name, full: p.name, icon: p.role === "superuser" ? "👤" : "💼", color: "#C9A96E", participacion: Number(p.participacion) || 0, participacion_ops: Number(p.participacion_ops) || 0 };
    }
  });
  return info;
};
// Socios loaded from DB (data.socios) — no more hardcoded partners

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

function Cd({children,className="",glow,onClick}){return <div className={`rounded-2xl ${className}`} onClick={onClick} style={{background:"var(--n2)",border:"1px solid rgba(255,255,255,.06)",boxShadow:glow?"0 0 40px rgba(201,169,110,.08)":"0 2px 12px rgba(0,0,0,.2)"}}>{children}</div>}
function St({label,value,sub,accent,onClick}){return <Cd className={`p-4 md:p-5${onClick?" cursor-pointer hover:brightness-110 transition-all":""}`} onClick={onClick}><div className="fb text-xs font-medium uppercase tracking-widest" style={{color:"var(--cd)"}}>{label}</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{color:accent||"white"}}>{value}</div>{sub&&<div className="fb text-xs mt-1" style={{color:"rgba(245,240,232,.4)"}}>{sub}</div>}</Cd>}
function Bd({text,v="default"}){const st={default:{background:"rgba(245,240,232,.08)",color:"var(--cd)"},gold:{background:"rgba(201,169,110,.15)",color:"var(--gl)"},green:{background:"rgba(74,222,128,.12)",color:"var(--gn)"},red:{background:"rgba(251,113,133,.12)",color:"var(--rd)"},blue:{background:"rgba(96,165,250,.12)",color:"var(--bl)"},purple:{background:"rgba(168,85,247,.12)",color:"var(--pr)"}};return <span className="fb text-xs px-2.5 py-1 rounded-full font-medium" style={st[v]||st.default}>{text}</span>}
function Fl({label,children,req,hint}){return <div className="mb-3"><label className="fb block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{color:"var(--gk)"}}>{label}{req&&<span style={{color:"var(--rd)"}}> *</span>}</label>{children}{hint&&<div className="fb text-xs mt-1" style={{color:"rgba(245,240,232,.25)"}}>{hint}</div>}</div>}
function Md({open,onClose,title,children,wide}){if(!open)return null;return <div className="fixed inset-0 z-50 ai" style={{isolation:"isolate"}}><div className="absolute inset-0" style={{background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)"}} /><div className="absolute inset-0 overflow-y-auto scr" style={{pointerEvents:"none"}}><div className="min-h-full flex items-start justify-center pt-4 md:pt-8 px-2 md:px-4 pb-8"><div className={`relative rounded-2xl shadow-2xl ${wide?"w-full max-w-3xl":"w-full max-w-lg"} au`} style={{background:"var(--n2)",border:"1px solid rgba(201,169,110,.15)",pointerEvents:"auto"}} onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><div className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-6 py-3 md:py-4 rounded-t-2xl" style={{background:"var(--n2)",borderBottom:"1px solid rgba(255,255,255,.06)"}}><h2 className="fd font-semibold text-base md:text-lg text-white truncate pr-4">{title}</h2><button type="button" onClick={e=>{e.stopPropagation();onClose()}} className="p-1.5 rounded-lg hover:bg-white/5 shrink-0" style={{color:"var(--cd)"}}><Ico d={IC.x}/></button></div><div className="p-4 md:p-6">{children}</div></div></div></div></div>}

const BtnP=({children,onClick,disabled,full})=><button type="button" onClick={onClick} disabled={disabled} className={`fb px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed ${full?"w-full":""}`} style={{background:"var(--gd)",color:"var(--nv)"}}>{children}</button>;
const BtnS=({children,onClick,full,disabled})=><button type="button" onClick={onClick} disabled={disabled} className={`fb px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed ${full?"w-full":""}`} style={{background:"rgba(245,240,232,.06)",color:"var(--cd)",border:"1px solid rgba(255,255,255,.08)"}}>{children}</button>;
const BtnG=({children,onClick,disabled})=><button type="button" onClick={onClick} disabled={disabled} className="fb px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-40" style={{background:"#166534",color:"var(--gn)"}}>{children}</button>;
const BtnD=({children,onClick})=><button type="button" onClick={onClick} className="fb px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-900/30" style={{color:"var(--rd)"}}>{children}</button>;

/* ═══ FUND SELECTOR (compact for mobile) ═══ */
function InvSel({value,onChange,label,investors,txs}){const cashOf=id=>(txs||[]).reduce((s,t)=>t.inversionista_id===id?s+(t.monto||0):s,0);return <div>{label&&<label className="fb block text-xs font-semibold uppercase tracking-widest mb-2" style={{color:"var(--gk)"}}>{label} <span style={{color:"var(--rd)"}}>*</span></label>}<div className="space-y-2">{(investors||[]).map(inv=>{const s=value===inv.id;const cash=cashOf(inv.id);return <button key={inv.id} type="button" onClick={()=>onChange(inv.id)} className="w-full text-left p-3 rounded-xl transition-all" style={{background:s?"rgba(201,169,110,.1)":"rgba(255,255,255,.02)",border:s?"1.5px solid var(--gd)":"1.5px solid rgba(255,255,255,.06)"}}><div className="flex items-center gap-2"><span className="text-lg">{inv.role==="superuser"?"👤":"💼"}</span><span className="fb font-semibold text-sm text-white flex-1">{inv.name}</span><span className="fb text-xs" style={{color:cash>=0?"var(--gn)":"var(--rd)"}}>{fmxn(cash)}</span>{inv.participacion>0&&<span className="fb text-xs px-1.5 py-0.5 rounded-full" style={{background:"rgba(201,169,110,.1)",color:"var(--gd)"}}>{inv.participacion}%</span>}{s&&<span className="fb text-xs font-bold" style={{color:"var(--gd)"}}>✓</span>}</div></button>})}</div></div>}

/* ═══ PHOTO UPLOAD COMPONENT ═══ */
/* ═══ IMAGE CROPPER ═══ */
function ImageCropper({ file, onCrop, onCancel }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [crop, setCrop] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState(null);
  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = URL.createObjectURL(file); return () => URL.revokeObjectURL(i.src); }, [file]);
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const c = canvasRef.current, sc = Math.min(window.innerWidth - 80, 600) / img.width;
    c.width = img.width * sc; c.height = img.height * sc;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
    if (crop) { ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(0, 0, c.width, crop.y); ctx.fillRect(0, crop.y + crop.h, c.width, c.height - crop.y - crop.h); ctx.fillRect(0, crop.y, crop.x, crop.h); ctx.fillRect(crop.x + crop.w, crop.y, c.width - crop.x - crop.w, crop.h); ctx.strokeStyle = "#C9A96E"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.strokeRect(crop.x, crop.y, crop.w, crop.h); }
  }, [img, crop]);
  const gp = (e) => { const r = canvasRef.current.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const onD = (e) => { e.preventDefault(); setDragging(true); setStart(gp(e)); setCrop(null); };
  const onM = (e) => { if (!dragging || !start) return; e.preventDefault(); const p = gp(e); setCrop({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }); };
  const onU = () => setDragging(false);
  const apply = () => {
    if (!crop || !img || crop.w < 10 || crop.h < 10) { alert("Dibuja un recuadro"); return; }
    const sc = img.width / canvasRef.current.width, o = document.createElement("canvas");
    o.width = crop.w * sc; o.height = crop.h * sc;
    o.getContext("2d").drawImage(img, crop.x * sc, crop.y * sc, crop.w * sc, crop.h * sc, 0, 0, o.width, o.height);
    o.toBlob(b => onCrop(new File([b], file.name || "crop.jpg", { type: "image/jpeg" })), "image/jpeg", 0.92);
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.85)" }} onClick={onCancel}>
    <div className="max-w-[640px] w-full" onClick={e => e.stopPropagation()}>
      <div className="fb text-sm font-bold text-white mb-3 text-center">Arrastra para recortar la imagen</div>
      <canvas ref={canvasRef} className="w-full rounded-xl cursor-crosshair touch-none" onMouseDown={onD} onMouseMove={onM} onMouseUp={onU} onMouseLeave={onU} onTouchStart={onD} onTouchMove={onM} onTouchEnd={onU} />
      <div className="flex gap-3 justify-center mt-4">
        <button onClick={apply} className="fb px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "var(--gd)", color: "#1a1a2e" }}>✂️ Recortar</button>
        <button onClick={() => onCrop(file)} className="fb px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,.1)", color: "white" }}>Usar original</button>
        <button onClick={onCancel} className="fb px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ color: "var(--cd)" }}>Cancelar</button>
      </div>
    </div>
  </div>;
}

/* ═══ PHOTO UPLOADER (with Crop + OCR) ═══ */
function PhotoUploader({ pieceId, fotos, onUpload, onDelete, isNew, onOcrResult }) {
  const [uploading, setUploading] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [cropPos, setCropPos] = useState(null);
  const [cropReplace, setCropReplace] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);

  const doUpload = async (pos, file) => {
    if (!file || !pieceId) return;
    setUploading(pos);
    try {
      const { url, storagePath } = await stor.uploadFoto(pieceId, pos, file);
      if (isNew) { if (onUpload) onUpload({ id: uid(), pieza_id: pieceId, posicion: pos, url, storage_path: storagePath, _pending: true }); }
      else {
        const { data: exists } = await sb.from("piezas").select("id").eq("id", pieceId).single();
        if (!exists) { alert("La pieza no existe."); setUploading(null); return; }
        if (onUpload) onUpload(await db.saveFoto({ pieza_id: pieceId, posicion: pos, url, storage_path: storagePath }));
      }
    } catch (e) { alert("Error: " + e.message); }
    setUploading(null);
  };
  const onFile = (pos, file, existing) => { if (!file) return; setCropFile(file); setCropPos(pos); setCropReplace(existing || null); };
  const onCropDone = async (f) => { setCropFile(null); if (cropReplace && !cropReplace._pending && onDelete) await onDelete(cropReplace); await doUpload(cropPos, f); setCropPos(null); setCropReplace(null); };
  const handleOcr = async (foto) => {
    if (!CLAUDE_KEY) { alert("Falta VITE_ANTHROPIC_API_KEY en Vercel"); return; }
    setOcrLoading(foto.id);
    try {
      const img = await imgToB64(foto.url);
      const text = await callClaude([img], `Analiza esta imagen de un reloj de lujo. Extrae si es visible:\n- Marca (brand)\n- Modelo (model)\n- Número de referencia (ref)\n- Número de serie (serial)\n\nResponde SOLO JSON: {"brand":"","model":"","ref":"","serial":"","notas":"observaciones"}\nCampos no visibles déjalos vacíos.`);
      try { const p = JSON.parse(text.replace(/```json|```/g, "").trim()); setOcrResult({ foto: foto.id, ...p }); if (onOcrResult) onOcrResult(p); } catch { setOcrResult({ foto: foto.id, notas: text }); }
    } catch (e) { alert("Error OCR: " + e.message); }
    setOcrLoading(null);
  };
  const pf = (fotos || []).filter(f => f.pieza_id === pieceId && !f.deleted_at);
  return <>
    {cropFile && <ImageCropper file={cropFile} onCrop={onCropDone} onCancel={() => { setCropFile(null); setCropPos(null); setCropReplace(null); }} />}
    <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
      <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Fotografías del Reloj</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PHOTO_POSITIONS.map(pos => {
          const ex = pf.find(f => f.posicion === pos.id);
          const isUp = uploading === pos.id;
          const isOcr = ocrLoading === ex?.id;
          return <div key={pos.id} className="relative rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", aspectRatio: "1" }}>
            {ex ? <div className="w-full h-full relative">
              <img src={ex.url} alt={pos.label} className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 opacity-0 hover:opacity-100 transition-all" style={{ background: "rgba(0,0,0,.6)" }}>
                <label className="cursor-pointer text-white text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "rgba(255,255,255,.15)" }}>📷 Reemplazar<input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) onFile(pos.id, e.target.files[0], ex); }} /></label>
                <button onClick={() => handleOcr(ex)} disabled={isOcr} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ background: "rgba(96,165,250,.2)", color: "#93C5FD" }}>{isOcr ? "⏳ Analizando..." : "🔍 Reconocer"}</button>
              </div>
            </div> : <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-all">
              <span className="text-2xl mb-1">{isUp ? "⏳" : pos.icon}</span>
              <span className="fb text-xs text-center px-2" style={{ color: "var(--cd)" }}>{isUp ? "Subiendo..." : pos.label}</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) onFile(pos.id, e.target.files[0], null); }} />
            </label>}
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-center" style={{ background: "rgba(0,0,0,.5)" }}><span className="fb text-xs" style={{ color: "var(--cd)" }}>{pos.label}</span></div>
          </div>;
        })}
      </div>
      {ocrResult && <div className="mt-3 rounded-xl p-3" style={{ background: "rgba(96,165,250,.06)", border: "1px solid rgba(96,165,250,.12)" }}>
        <div className="flex items-center justify-between mb-2"><div className="fb text-xs font-bold" style={{ color: "var(--bl)" }}>🔍 Reconocimiento IA</div><button onClick={() => setOcrResult(null)} className="fb text-xs" style={{ color: "var(--cd)" }}>✕</button></div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {ocrResult.brand && <div><span className="fb" style={{ color: "var(--cd)" }}>Marca:</span> <span className="text-white font-semibold">{ocrResult.brand}</span></div>}
          {ocrResult.model && <div><span className="fb" style={{ color: "var(--cd)" }}>Modelo:</span> <span className="text-white font-semibold">{ocrResult.model}</span></div>}
          {ocrResult.ref && <div><span className="fb" style={{ color: "var(--cd)" }}>Ref:</span> <span className="text-white font-semibold">{ocrResult.ref}</span></div>}
          {ocrResult.serial && <div><span className="fb" style={{ color: "var(--cd)" }}>Serial:</span> <span className="text-white font-semibold">{ocrResult.serial}</span></div>}
        </div>
        {ocrResult.notas && <div className="fb text-xs mt-2" style={{ color: "var(--cd)" }}>{ocrResult.notas}</div>}
        {onOcrResult && <button onClick={() => onOcrResult(ocrResult)} className="fb text-xs mt-2 px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>✓ Aplicar datos detectados</button>}
      </div>}
    </div>
  </>;
}

/* ═══ AI VALIDATION ═══ */
function AiValidation({ pieceId, fotos, brand, model, refNum, serial, isNew }) {
  const [vals, setVals] = useState([]); const [loading, setLoading] = useState(false); const [loaded, setLoaded] = useState(false);
  const pf = (fotos || []).filter(f => f.pieza_id === pieceId && !f.deleted_at);
  const ok = pf.length >= 2 && !!(brand && model && refNum) && !isNew;
  useEffect(() => { if (pieceId && !isNew && !loaded) { db.loadValidaciones(pieceId).then(v => { setVals(v); setLoaded(true); }); } }, [pieceId, isNew, loaded]);
  const run = async () => {
    if (!CLAUDE_KEY) { alert("Falta VITE_ANTHROPIC_API_KEY"); return; }
    setLoading(true);
    try {
      const imgs = []; for (const f of pf.slice(0, 4)) imgs.push(await imgToB64(f.url));
      const txt = await callClaude(imgs, `Eres un experto autenticador de relojes de lujo. Analiza las ${imgs.length} fotos:\n\nMarca: ${brand}\nModelo: ${model}\nRef: ${refNum}\nSerial: ${serial || "N/A"}\n\nEvalúa autenticidad (dial, caja, corona, acabados).\n\nResponde SOLO JSON:\n{"score":<1-10>,"resumen":"<2-3 oraciones en español>","positivas":["señales buenas"],"alertas":["señales malas"],"confianza":"<alta|media|baja>"}`);
      const p = JSON.parse(txt.replace(/```json|```/g, "").trim());
      const v = { id: uid(), pieza_id: pieceId, version: vals.length + 1, tipo: "autenticidad", score: p.score, resumen: p.resumen, detalles: { positivas: p.positivas, alertas: p.alertas, confianza: p.confianza }, fotos_usadas: pf.slice(0, 4).map(f => f.id), modelo_ia: "claude-sonnet-4-20250514" };
      await db.saveValidacion(v); setVals(prev => [v, ...prev]);
    } catch (e) { alert("Error: " + e.message); }
    setLoading(false);
  };
  const sc = s => s >= 8 ? "var(--gn)" : s >= 5 ? "#F59E0B" : "var(--rd)";
  const sl = s => s >= 8 ? "Alta probabilidad de autenticidad" : s >= 5 ? "Requiere revisión" : "Señales de alerta";
  return <div className="rounded-xl p-4" style={{ background: "rgba(147,51,234,.04)", border: "1px solid rgba(147,51,234,.1)" }}>
    <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--pr)" }}>🤖 Validación IA de Autenticidad</div>
    <div className="flex gap-3 mb-3">
      <div className="fb text-xs" style={{ color: pf.length >= 2 ? "var(--gn)" : "var(--cd)" }}>{pf.length >= 2 ? "✓" : "○"} ≥2 fotos</div>
      <div className="fb text-xs" style={{ color: brand && refNum ? "var(--gn)" : "var(--cd)" }}>{brand && refNum ? "✓" : "○"} Referencia</div>
      <div className="fb text-xs" style={{ color: !isNew ? "var(--gn)" : "var(--cd)" }}>{!isNew ? "✓" : "○"} Guardada</div>
    </div>
    <button onClick={run} disabled={!ok || loading} className="fb w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-30" style={{ background: ok ? "rgba(147,51,234,.15)" : "rgba(255,255,255,.03)", color: "var(--pr)", border: "1px solid rgba(147,51,234,.15)" }}>
      {loading ? "⏳ Analizando..." : `🤖 Validar Autenticidad (${pf.length} fotos)`}
    </button>
    {!ok && !loading && <div className="fb text-xs mt-2 text-center" style={{ color: "var(--cd)" }}>{pf.length < 2 ? "Sube ≥2 fotos. " : ""}{!brand || !refNum ? "Completa marca y ref. " : ""}{isNew ? "Guarda primero." : ""}</div>}
    {vals.length > 0 && <div className="mt-4 space-y-3">
      <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--cd)" }}>Historial ({vals.length})</div>
      {vals.map(v => <div key={v.id} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center fd text-lg font-bold" style={{ background: `${sc(v.score)}15`, color: sc(v.score) }}>{v.score}</div>
            <div><div className="fb text-xs font-semibold" style={{ color: sc(v.score) }}>{sl(v.score)}</div><div className="fb text-xs" style={{ color: "var(--cd)" }}>v{v.version} · {new Date(v.created_at).toLocaleDateString("es-MX")}</div></div>
          </div>
          {v.detalles?.confianza && <span className="fb text-xs px-2 py-0.5 rounded-full" style={{ background: v.detalles.confianza === "alta" ? "rgba(74,222,128,.12)" : "rgba(245,158,11,.12)", color: v.detalles.confianza === "alta" ? "var(--gn)" : "#F59E0B" }}>{v.detalles.confianza}</span>}
        </div>
        <p className="fb text-xs leading-relaxed" style={{ color: "var(--cd)" }}>{v.resumen}</p>
        {v.detalles?.positivas?.length > 0 && <div className="mt-2 fb text-xs" style={{ color: "var(--gn)" }}>✓ {v.detalles.positivas.join(" · ")}</div>}
        {v.detalles?.alertas?.length > 0 && <div className="mt-1 fb text-xs" style={{ color: "var(--rd)" }}>⚠ {v.detalles.alertas.join(" · ")}</div>}
      </div>)}
    </div>}
  </div>;
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
    if (!brand) return;
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
      <button type="button" onClick={validate} disabled={loading || !brand}
        className="fb text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40 flex items-center gap-1.5"
        style={{ background: "rgba(168,85,247,.15)", color: "var(--pr)" }}>
        <Ico d={IC.ai} s={14} />{loading ? "Buscando en web..." : "Validar con IA"}
      </button>
      {result && <AiResultCard result={result} />}
    </div>
  );
}

function AiResultCard({ result }) {
  if (!result) return null;
  const fields = [
    { k: "name", l: "Nombre completo", icon: "⌚" },
    { k: "case_mm", l: "Caja", icon: "📐" },
    { k: "movement", l: "Calibre", icon: "⚙️" },
    { k: "material", l: "Material", icon: "🪨" },
    { k: "dial", l: "Dial", icon: "🎨" },
    { k: "water_resistance", l: "WR", icon: "💧" },
    { k: "year_range", l: "Producción", icon: "📅" },
    { k: "retail_usd", l: "Retail USD", icon: "🏷️" },
    { k: "market_usd", l: "Mercado USD", icon: "💰" },
  ].filter(f => result[f.k]);
  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: result.valid ? "1px solid rgba(74,222,128,.2)" : "1px solid rgba(251,113,133,.2)" }}>
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: result.valid ? "rgba(74,222,128,.08)" : "rgba(251,113,133,.08)" }}>
        <span className="fb text-sm font-bold" style={{ color: result.valid ? "var(--gn)" : "var(--rd)" }}>{result.valid ? "✓ Referencia válida" : "✕ No encontrada"}</span>
        {result.name && <span className="fb text-xs" style={{ color: "var(--cd)" }}>— {result.name}</span>}
      </div>
      {fields.length > 0 && (
        <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2" style={{ background: "rgba(255,255,255,.02)" }}>
          {fields.map(f => (
            <div key={f.k} className="flex items-center gap-2">
              <span className="text-sm">{f.icon}</span>
              <div>
                <div className="fb text-xs" style={{ color: "var(--cd)" }}>{f.l}</div>
                <div className="fb text-sm text-white font-medium">{result[f.k]}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {result.sources && <div className="px-4 py-2 fb text-xs" style={{ background: "rgba(255,255,255,.01)", color: "var(--cd)", borderTop: "1px solid rgba(255,255,255,.04)" }}>📎 {result.sources}</div>}
      {result.notes && <div className="px-4 py-2 fb text-xs" style={{ background: "rgba(255,255,255,.01)", color: "var(--cd)", borderTop: "1px solid rgba(255,255,255,.04)" }}>{result.notes}</div>}
    </div>
  );
}

/* ═══ COMBOBOX — select from list OR type custom ═══ */
function ComboSelect({ value, options, placeholder, onChange, allowCustom = true }) {
  const [typing, setTyping] = useState(false);
  const [search, setSearch] = useState("");
  const hasMatch = options.some(o => o === value);

  // If value doesn't match any option, show input mode
  const isCustom = typing || (value && !hasMatch && allowCustom);

  if (isCustom) {
    return (
      <div className="flex gap-1.5">
        <input className="ti flex-1" value={value} placeholder={placeholder || "Escribir..."} onChange={e => onChange(e.target.value)} autoFocus />
        {options.length > 0 && <button type="button" onClick={() => { setTyping(false); if (!hasMatch) onChange(""); }} className="fb text-xs px-2 rounded-lg shrink-0" style={{ color: "var(--cd)", background: "rgba(255,255,255,.04)" }} title="Ver lista">▼</button>}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <select className="ti flex-1" value={value} onChange={e => { if (e.target.value === "__custom__") { setTyping(true); onChange(""); } else onChange(e.target.value); }}>
        <option value="">{placeholder || "Seleccionar..."}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        {allowCustom && <option value="__custom__">✏ Escribir manualmente...</option>}
      </select>
    </div>
  );
}

/* ═══ WDB SELECTOR WITH CUSTOM REF ═══ */
function WatchRefSelector({ brand, model, refNum, onChange, customRefs, onAiResult }) {
  const models = getModels(brand);
  const dbRefs = getRefs(brand, model);
  const customRefsForBM = (customRefs || []).filter(cr => cr.brand === brand && cr.model === model).map(cr => cr.ref_number);
  const allRefs = [...new Set([...dbRefs, ...customRefsForBM])];
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Fl label="Marca" req>
          <ComboSelect value={brand} options={BRANDS} placeholder="Seleccionar marca..."
            onChange={v => { onChange("brand", v); onChange("model", ""); onChange("ref", ""); }} />
        </Fl>
        <Fl label="Modelo" req>
          <ComboSelect value={model} options={models} placeholder={models.length ? "Seleccionar modelo..." : "Escribir modelo..."}
            onChange={v => { onChange("model", v); onChange("ref", ""); }} />
        </Fl>
        <Fl label="Referencia">
          <ComboSelect value={refNum} options={allRefs} placeholder={allRefs.length ? "Seleccionar ref..." : "Ref. manual..."}
            onChange={v => onChange("ref", v)} />
        </Fl>
      </div>

      {/* AI + Save custom ref */}
      {brand && (
        <div className="flex items-center gap-2 flex-wrap">
          <AiRefValidator brand={brand} model={model} refNum={refNum} onResult={(r) => { setAiResult(r); setShowSaveConfirm(true); if (onAiResult) onAiResult(r); }} />
          {showSaveConfirm && refNum && (
            <button type="button" onClick={async () => {
              if (!brand || !refNum) return;
              try { await db.saveCustomRef({ brand, model: model || "", ref_number: refNum, ai_validated: aiResult?.valid || false, ai_response: aiResult || null }); setShowSaveConfirm(false); alert("Referencia guardada en catálogo custom"); } catch (e) { alert("Error: " + e.message); }
            }} className="fb text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>💾 Guardar al catálogo</button>
          )}
        </div>
      )}
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
  const [brandFilter, setBrandFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("");

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
  const brands = [...new Set(pieces.map(p => p.brand).filter(Boolean))].sort();

  const getFotos = (pid) => fotos.filter(f => f.pieza_id === pid).sort((a, b) => {
    const order = ["dial", "full", "bisel", "corona", "tapa", "bracelet"];
    return order.indexOf(a.posicion) - order.indexOf(b.posicion);
  });

  const getWa = (piece) => piece.whatsapp_pieza || waNum;

  const trackAndOpen = (piece, url) => {
    db.trackContact(piece.id, "whatsapp");
    window.open(url, "_blank");
  };

  const waLink = (piece) => {
    const wa = getWa(piece);
    const ref = piece.es_referenciada ? " (Pieza Referenciada)" : "";
    const msg = encodeURIComponent(`Hola, me interesa el ${piece.name || ""} (SKU: ${piece.sku || ""})${ref}. ¿Está disponible?`);
    return `https://wa.me/${wa}?text=${msg}`;
  };

  const filtered = pieces.filter(p => {
    if (brandFilter && p.brand !== brandFilter) return false;
    if (statusFilter === "available" && p.status !== "Disponible") return false;
    if (statusFilter === "sold" && p.status === "Disponible") return false;
    if (sizeFilter && p.case_size !== sizeFilter) return false;
    return true;
  }).sort((a, b) => (a.status === "Disponible" ? 0 : 1) - (b.status === "Disponible" ? 0 : 1));

  const availCount = pieces.filter(p => p.status === "Disponible").length;
  const soldCount = pieces.filter(p => p.status !== "Disponible").length;
  const sizes = [...new Set(pieces.map(p => p.case_size).filter(Boolean))].sort((a, b) => Number(a) - Number(b));

  /* ═══ DETAIL VIEW ═══ */
  if (selected) {
    const p = selected;
    const pFotos = getFotos(p.id);
    const wa = getWa(p);
    return (
      <div className="min-h-screen pb-24" style={{ background: "var(--nv)" }}>
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3" style={{ background: "rgba(11,29,51,.95)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(201,169,110,.1)" }}>
          <button onClick={() => { setSelected(null); setPhotoIdx(0); }} className="p-2 rounded-xl" style={{ color: "var(--gd)" }}>←</button>
          <div className="flex-1 truncate"><span className="fd text-sm font-semibold text-white">{p.name}</span></div>
          {p.es_referenciada && <span className="fb text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(201,169,110,.15)", color: "var(--gd)" }}>🤝 Referenciada</span>}
        </div>

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

        <div className="p-4 space-y-4">
          <div>
            <div className="fb text-xs uppercase tracking-widest mb-1" style={{ color: "var(--gk)" }}>{p.brand}</div>
            <h1 className="fd text-2xl font-bold text-white">{p.model || p.name}</h1>
            {p.ref && <div className="fb text-sm mt-1" style={{ color: "var(--cd)" }}>Ref. {p.ref}</div>}
          </div>
          {showPrices && p.price_asked > 0 && p.status === "Disponible" && (
            <div className="fd text-3xl font-bold" style={{ color: "var(--gd)" }}>{fmxn(p.price_asked)} <span className="text-base font-normal" style={{ color: "var(--cd)" }}>MXN</span></div>
          )}
          {p.status !== "Disponible" && (
            <div className="rounded-xl p-3" style={{ background: "rgba(251,113,133,.08)", border: "1px solid rgba(251,113,133,.15)" }}>
              <div className="fb text-sm font-bold uppercase tracking-widest" style={{ color: "#FB7185" }}>Vendido</div>
              {showPrices && p.price_dealer > 0 && <div className="fd text-lg font-bold mt-1" style={{ color: "#FB7185" }}>{fmxn(p.price_dealer)} <span className="text-sm font-normal line-through opacity-50" style={{ color: "var(--cd)" }}>{fmxn(p.price_asked)}</span></div>}
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Esta pieza ya no está disponible</div>
            </div>
          )}
          {p.es_referenciada && (
            <div className="rounded-xl p-3" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.12)" }}>
              <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gd)" }}>🤝 Pieza Referenciada</div>
              {p.referenciada_por && <div className="fb text-sm mt-1 text-white">Comercializado por: <strong>{p.referenciada_por}</strong></div>}
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Esta pieza se encuentra en resguardo del comercializador. TWR facilita la vinculación.</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {p.condition && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Condición</div><div className="fb text-sm font-semibold text-white">{p.condition}</div></div>}
            {p.auth_level && p.auth_level !== "NONE" && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Autenticación</div><div className="fb text-sm font-semibold text-white">{AUTHS.find(a => a.c === p.auth_level)?.n || p.auth_level}</div></div>}
            {p.case_size && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Caja</div><div className="fb text-sm font-semibold text-white">{p.case_size}mm</div></div>}
            {p.dial_color && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Dial</div><div className="fb text-sm font-semibold text-white">{p.dial_color}</div></div>}
            {p.bezel_type && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Bisel</div><div className="fb text-sm font-semibold text-white">{p.bezel_type}</div></div>}
            {p.strap_type && <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}><div className="fb text-xs" style={{ color: "var(--cd)" }}>Brazalete</div><div className="fb text-sm font-semibold text-white">{p.strap_type}</div></div>}
          </div>
          {p.catalog_description && <div className="fb text-sm leading-relaxed" style={{ color: "var(--cd)" }}>{p.catalog_description}</div>}
          {p.sku && <div className="fb text-xs" style={{ color: "rgba(255,255,255,.2)" }}>SKU: {p.sku}</div>}
        </div>

        {wa && (
          <div className="fixed bottom-0 left-0 right-0 p-4" style={{ background: "linear-gradient(transparent, rgba(11,29,51,.95) 30%)" }}>
            {p.status === "Disponible" ? (
              <button onClick={() => trackAndOpen(p, waLink(p))}
                className="fb flex items-center justify-center gap-3 w-full py-4 rounded-2xl text-white font-bold text-base"
                style={{ background: "#25D366" }}>
                <Ico d={IC.wa} s={22} />Consultar por WhatsApp
              </button>
            ) : (
              <button onClick={() => trackAndOpen(p, `https://wa.me/${waNum}?text=${encodeURIComponent(`Hola, vi que el ${p.name} (SKU: ${p.sku}) ya fue vendido. ¿Tienen algo similar disponible?`)}`)}
                className="fb flex items-center justify-center gap-3 w-full py-4 rounded-2xl text-white font-bold text-base"
                style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)" }}>
                <Ico d={IC.wa} s={22} />¿Algo similar disponible?
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ═══ GRID VIEW ═══ */
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--nv)" }}>
      {/* ═══ HERO HEADER ═══ */}
      <div className="text-center px-4 pt-8 pb-4" style={{ background: "linear-gradient(180deg, rgba(201,169,110,.08) 0%, transparent 100%)" }}>
        <div className="fd text-3xl md:text-4xl font-bold text-white tracking-tight">{bizName}</div>
        <div className="fb text-sm mt-2" style={{ color: "var(--cd)", maxWidth: 480, margin: "0 auto" }}>
          Relojes de lujo autenticados. Cada pieza verificada, documentada y respaldada.
        </div>
        <div className="flex items-center justify-center gap-4 mt-3">
          <div className="fb text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(74,222,128,.1)", color: "var(--gn)" }}>{availCount} disponible{availCount !== 1 ? "s" : ""}</div>
          {soldCount > 0 && <div className="fb text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(251,113,133,.08)", color: "#FB7185" }}>{soldCount} vendida{soldCount !== 1 ? "s" : ""}</div>}
        </div>
      </div>

      {/* ═══ FILTERS ═══ */}
      <div className="sticky top-0 z-20 px-3 py-3" style={{ background: "rgba(11,29,51,.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(201,169,110,.08)" }}>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          <select className="fb text-xs px-3 py-2 rounded-xl shrink-0" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
            style={{ background: brandFilter ? "rgba(201,169,110,.15)" : "rgba(255,255,255,.06)", color: brandFilter ? "var(--cr)" : "var(--cd)", border: "1px solid rgba(255,255,255,.08)" }}>
            <option value="">Todas las marcas</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="fb text-xs px-3 py-2 rounded-xl shrink-0" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ background: statusFilter !== "all" ? "rgba(201,169,110,.15)" : "rgba(255,255,255,.06)", color: statusFilter !== "all" ? "var(--cr)" : "var(--cd)", border: "1px solid rgba(255,255,255,.08)" }}>
            <option value="all">Todas</option>
            <option value="available">Disponibles</option>
            <option value="sold">Vendidas</option>
          </select>
          {sizes.length > 1 && <select className="fb text-xs px-3 py-2 rounded-xl shrink-0" value={sizeFilter} onChange={e => setSizeFilter(e.target.value)}
            style={{ background: sizeFilter ? "rgba(201,169,110,.15)" : "rgba(255,255,255,.06)", color: sizeFilter ? "var(--cr)" : "var(--cd)", border: "1px solid rgba(255,255,255,.08)" }}>
            <option value="">Todos los tamaños</option>
            {sizes.map(s => <option key={s} value={s}>{s}mm</option>)}
          </select>}
          {(brandFilter || statusFilter !== "all" || sizeFilter) && (
            <button onClick={() => { setBrandFilter(""); setStatusFilter("all"); setSizeFilter(""); }} className="fb text-xs px-3 py-2 rounded-xl shrink-0" style={{ color: "var(--rd)", background: "rgba(251,113,133,.08)" }}>✕ Limpiar</button>
          )}
        </div>
        {filtered.length !== pieces.length && <div className="fb text-xs mt-1 text-center" style={{ color: "var(--cd)" }}>{filtered.length} de {pieces.length} piezas</div>}
      </div>

      {/* ═══ GRID ═══ */}
      <div className="flex-1">
        <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-3 lg:grid-cols-4 md:gap-4 md:p-4">
          {filtered.map(p => {
            const pFotos = getFotos(p.id);
            const mainFoto = pFotos[0];
            const sold = p.status !== "Disponible";
            return (
              <button key={p.id} onClick={() => setSelected(p)} className="text-left rounded-2xl overflow-hidden transition-all hover:scale-[1.02] active:scale-[.98]" style={{ background: "var(--n2)", border: "1px solid rgba(255,255,255,.06)", opacity: sold ? .7 : 1 }}>
                <div className="relative" style={{ aspectRatio: "1" }}>
                  {mainFoto ? <img src={mainFoto.url} alt={p.name} className="w-full h-full object-cover" style={sold ? { filter: "grayscale(.4)" } : {}} /> : <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--ns)" }}><span className="text-4xl opacity-20">⌚</span></div>}
                  {sold && <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,.45)" }}><span className="fb text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg" style={{ background: "rgba(251,113,133,.2)", color: "#FB7185", border: "1px solid rgba(251,113,133,.3)" }}>Vendido</span></div>}
                  {!sold && pFotos.length > 1 && <div className="absolute top-2 right-2 fb text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,.6)", color: "white" }}>{pFotos.length} 📷</div>}
                  {p.es_referenciada && !sold && <div className="absolute top-2 left-2 fb text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(201,169,110,.85)", color: "var(--nv)" }}>🤝</div>}
                </div>
                <div className="p-3">
                  <div className="fb text-xs" style={{ color: "var(--gk)" }}>{p.brand}{p.case_size ? ` · ${p.case_size}mm` : ""}</div>
                  <div className="fb text-sm font-semibold text-white truncate">{p.model || p.name}</div>
                  {showPrices && !sold && p.price_asked > 0 && <div className="fd text-base font-bold mt-1" style={{ color: "var(--gd)" }}>{fmxn(p.price_asked)}</div>}
                  {sold && showPrices && p.price_dealer > 0 && <div className="fd text-base font-bold mt-1" style={{ color: "#FB7185" }}><span className="line-through opacity-60">{fmxn(p.price_asked)}</span> {fmxn(p.price_dealer)}</div>}
                  {sold && !(showPrices && p.price_dealer > 0) && <div className="fb text-xs font-bold mt-1" style={{ color: "#FB7185" }}>VENDIDO</div>}
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-30">⌚</div>
            <div className="fd text-xl font-semibold text-white">{pieces.length === 0 ? "Próximamente" : "Sin resultados"}</div>
            <div className="fb text-sm mt-2" style={{ color: "var(--cd)" }}>{pieces.length === 0 ? "Nuevas piezas en camino" : "Intenta con otros filtros"}</div>
          </div>
        )}
      </div>

      {/* ═══ FOOTER ═══ */}
      <footer className="mt-8 px-4 pb-6 pt-6" style={{ borderTop: "1px solid rgba(201,169,110,.08)" }}>
        <div className="max-w-lg mx-auto text-center space-y-4">
          <div className="fd text-lg font-bold" style={{ color: "var(--gd)" }}>{bizName}</div>
          <div className="fb text-xs leading-relaxed" style={{ color: "var(--cd)" }}>
            Todas las piezas publicadas han sido inspeccionadas y documentadas. Las piezas marcadas como
            <span style={{ color: "var(--gd)" }}> "Referenciadas" </span>
            se encuentran en resguardo de su comercializador original. {bizName} actúa únicamente como intermediario
            facilitando la vinculación entre compradores y vendedores, sin asumir responsabilidad sobre el estado,
            autenticidad o condiciones de dichas piezas más allá de su labor de intermediación.
          </div>
          <div className="flex items-center justify-center gap-4 fb text-xs" style={{ color: "rgba(255,255,255,.25)" }}>
            <span>Términos y Condiciones</span>
            <span>·</span>
            <span>Aviso de Privacidad</span>
          </div>
          <div className="fb text-xs" style={{ color: "rgba(255,255,255,.15)" }}>© {new Date().getFullYear()} {bizName}. Todos los derechos reservados. Mérida, Yucatán, México.</div>
        </div>
      </footer>

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
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [msg, setMsg] = useState("");

  const goLogin = async () => {
    if (!email || !pass) return;
    setLoading(true); setErr(""); setMsg("");
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      onLogin(data.user);
    } catch (e) { setErr(e.message || "Error de autenticación"); }
    setLoading(false);
  };

  const goRegister = async () => {
    if (!email || !pass) return;
    if (pass.length < 6) return setErr("La contraseña debe tener al menos 6 caracteres");
    setLoading(true); setErr(""); setMsg("");
    try {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name: name || email } } });
      if (error) throw error;
      // Create profile
      if (data.user) {
        await sb.from("profiles").upsert({ id: data.user.id, email, name: name || email, role: "pending", active: false });
      }
      setMsg("Cuenta creada. Un administrador debe activar tu perfil antes de que puedas ingresar.");
      setMode("login");
    } catch (e) { setErr(e.message || "Error al registrar"); }
    setLoading(false);
  };

  const goForgot = async () => {
    if (!email) return setErr("Ingresa tu email");
    setLoading(true); setErr(""); setMsg("");
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      setMsg("Se envió un link de recuperación a tu email.");
    } catch (e) { setErr(e.message || "Error"); }
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
          <div className="fb text-xs mt-4 tracking-widest uppercase" style={{ color: "var(--gk)" }}>Sistema de Administración v22</div>
        </div>
        <div className="rounded-2xl p-6" style={{ background: "var(--n2)", border: "1px solid rgba(201,169,110,.12)", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
          {mode === "login" && <>
            <Fl label="Email"><input type="email" className="ti" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></Fl>
            <Fl label="Contraseña"><input type="password" className="ti" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" onKeyDown={e => { if (e.key === "Enter") goLogin(); }} /></Fl>
            {err && <div className="fb text-xs text-center mb-3" style={{ color: "var(--rd)" }}>{err}</div>}
            {msg && <div className="fb text-xs text-center mb-3 p-2 rounded-lg" style={{ color: "var(--gn)", background: "rgba(74,222,128,.08)" }}>{msg}</div>}
            <BtnP onClick={goLogin} disabled={loading} full>{loading ? "Ingresando..." : "Ingresar"}</BtnP>
            <div className="flex justify-between mt-4">
              <button onClick={() => { setMode("forgot"); setErr(""); setMsg(""); }} className="fb text-xs hover:underline" style={{ color: "var(--cd)" }}>¿Olvidaste tu contraseña?</button>
              <button onClick={() => { setMode("register"); setErr(""); setMsg(""); }} className="fb text-xs hover:underline" style={{ color: "var(--gd)" }}>Crear cuenta →</button>
            </div>
          </>}

          {mode === "register" && <>
            <div className="fb text-sm font-semibold text-white mb-4">Crear Cuenta</div>
            <Fl label="Nombre"><input className="ti" value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" /></Fl>
            <Fl label="Email"><input type="email" className="ti" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></Fl>
            <Fl label="Contraseña"><input type="password" className="ti" value={pass} onChange={e => setPass(e.target.value)} placeholder="Mínimo 6 caracteres" /></Fl>
            {err && <div className="fb text-xs text-center mb-3" style={{ color: "var(--rd)" }}>{err}</div>}
            <BtnP onClick={goRegister} disabled={loading} full>{loading ? "Registrando..." : "Crear Cuenta"}</BtnP>
            <div className="text-center mt-3 fb text-xs p-2 rounded-lg" style={{ color: "var(--cd)", background: "rgba(255,255,255,.03)" }}>Nota: Un administrador debe activar tu cuenta después del registro.</div>
            <div className="text-center mt-3">
              <button onClick={() => { setMode("login"); setErr(""); }} className="fb text-xs hover:underline" style={{ color: "var(--gd)" }}>← Regresar al login</button>
            </div>
          </>}

          {mode === "forgot" && <>
            <div className="fb text-sm font-semibold text-white mb-4">Recuperar Contraseña</div>
            <Fl label="Email"><input type="email" className="ti" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></Fl>
            {err && <div className="fb text-xs text-center mb-3" style={{ color: "var(--rd)" }}>{err}</div>}
            {msg && <div className="fb text-xs text-center mb-3 p-2 rounded-lg" style={{ color: "var(--gn)", background: "rgba(74,222,128,.08)" }}>{msg}</div>}
            <BtnP onClick={goForgot} disabled={loading} full>{loading ? "Enviando..." : "Enviar link de recuperación"}</BtnP>
            <div className="text-center mt-3">
              <button onClick={() => { setMode("login"); setErr(""); setMsg(""); }} className="fb text-xs hover:underline" style={{ color: "var(--gd)" }}>← Regresar al login</button>
            </div>
          </>}

          <div className="text-center mt-4" style={{ borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 12 }}>
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
function PcForm({ piece, onSave, onClose, allPieces, fotos: fotosProp, customRefs, userId, suppliers, onSaveSupplier, userRole, invInfo: fi, myInvs, defaultFund, txs: txsProp, investors: investorsProp }) {
  const invInfo = fi || {};
  const autoSku = piece?.sku || genSku(allPieces);
  const blank = { id: uid(), sku: autoSku, name: "", brand: "", model: "", ref: "", serial: "", condition: "Excelente", auth_level: "SERIAL", fondo_id: "FIC", inversionista_id: defaultFund || null, entry_type: "adquisicion", entry_date: td(), cost: 0, price_dealer: 0, price_asked: 0, price_trade: 0, status: "Disponible", stage: "inventario", notes: "", publish_catalog: false, catalog_description: "", dial_color: "", bezel_type: "", case_size: "", strap_type: "", supplier_id: "", metodo_pago: "Efectivo MXN", whatsapp_pieza: "", es_referenciada: false, referenciada_por: "", referenciada_comision: 0 };
  const [f, sF] = useState(piece ? { ...blank, ...piece } : blank);
  const [localFotos, setLocalFotos] = useState(fotosProp || []);
  const [combinedFin, setCombinedFin] = useState(false);
  const [newCapital, setNewCapital] = useState(0);
  const [newSupplier, setNewSupplier] = useState(null);
  const [tab, setTab] = useState("id");
  const [aiResult, setAiResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const fromFund = Math.max(0, (f.cost || 0) - newCapital);
  const invId = f.inversionista_id || defaultFund;
  const cashInFund = invId ? (txsProp || []).reduce((s, t) => (t.inversionista_id === invId || t.fondo_id === invId) ? s + (Number(t.monto) || 0) : s, 0) : 0;
  const cashAfter = combinedFin ? cashInFund : cashInFund - (f.cost || 0);
  const u = (k, v) => sF(p => ({ ...p, [k]: v }));
  const autoName = (b, m) => [b, m].filter(Boolean).join(" ");

  const [costosData, setCostosData] = useState([]);
  const [newCosto, setNewCosto] = useState(null);
  useEffect(() => { if (piece?.id) db.loadCostos(piece.id).then(setCostosData); }, [piece?.id]);
  const tiposCosto = [
    { id: "TC01", n: "Envío / Flete de Entrada", i: "📦", cat: "pre" },
    { id: "TC02", n: "Autenticación", i: "🔍", cat: "pre" },
    { id: "TC03", n: "Reparación / Servicio", i: "🔧", cat: "pre" },
    { id: "TC04", n: "Mantenimiento / Pulido", i: "⚙️", cat: "pre" },
    { id: "TC05", n: "Seguro de Transporte", i: "🛡️", cat: "pre" },
    { id: "TC06", n: "Almacenaje / Bóveda", i: "🏪", cat: "pre" },
    { id: "TC07", n: "Fotografía Profesional", i: "📸", cat: "pre" },
    { id: "TC10", n: "Envío / Flete de Salida", i: "🚚", cat: "venta" },
    { id: "TC11", n: "Comisión de Venta", i: "💼", cat: "venta" },
    { id: "TC12", n: "Comisión Plataforma / Referido", i: "🤝", cat: "venta" },
    { id: "TC13", n: "Empaque / Presentación", i: "🎁", cat: "venta" },
    { id: "TC14", n: "Gastos Notariales / Legales", i: "⚖️", cat: "venta" },
    { id: "TC15", n: "Comisión Bancaria", i: "🏦", cat: "venta" },
    { id: "TC16", n: "Descuento / Ajuste", i: "🏷️", cat: "venta" },
    { id: "TC20", n: "Viaje / Traslado", i: "✈️", cat: "gral" },
    { id: "TC21", n: "Certificado de Garantía", i: "📜", cat: "gral" },
    { id: "TC22", n: "Impuestos / Aranceles", i: "🏛️", cat: "gral" },
    { id: "TC99", n: "Otros", i: "📋", cat: "gral" },
  ];
  const totalCostos = costosData.reduce((s, c) => s + (Number(c.monto) || 0), 0);

  const TABS = [
    { id: "id", l: "Reloj", icon: "🔍" },
    { id: "detail", l: "Detalles", icon: "📋" },
    { id: "photos", l: "Fotos", icon: "📸", count: localFotos.filter(ft => !ft.deleted_at).length },
    { id: "money", l: "Adquisición", icon: "💰" },
    ...(piece ? [{ id: "costos", l: "Gastos", icon: "🧾", count: costosData.length }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,.03)" }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className="flex-1 fb text-xs font-semibold px-2 py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
            style={tab === t.id ? { background: "rgba(201,169,110,.15)", color: "var(--cr)" } : { color: "var(--cd)" }}>
            <span>{t.icon}</span><span className="hidden md:inline">{t.l}</span>
            {t.count > 0 && <span className="fb text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,.15)", color: "var(--gn)", fontSize: 10 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ═══ TAB: IDENTIFICACIÓN ═══ */}
      {tab === "id" && (
        <div className="space-y-4 au">
          <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
            <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Identificación del Reloj</div>
            <WatchRefSelector brand={f.brand} model={f.model} refNum={f.ref} customRefs={customRefs}
              onChange={(field, val) => {
                if (field === "brand") sF(p => ({ ...p, brand: val, model: "", ref: "", name: val }));
                else if (field === "model") sF(p => ({ ...p, model: val, ref: getRefs(p.brand, val)[0] || "", name: autoName(p.brand, val) }));
                else u("ref", val);
              }}
              onAiResult={(r) => { setAiResult(r); if (r?.valid && r?.name) sF(p => ({ ...p, name: r.name })); if (r?.valid && r?.case_mm) u("case_size", r.case_mm.replace(/[^\d.]/g, "")); if (r?.valid && r?.dial) u("dial_color", r.dial); }} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Fl label="Nombre (auto)" hint="Marca + Modelo"><input className="ti" value={f.name} onChange={e => u("name", e.target.value)} style={{ fontWeight: 600 }} /></Fl>
            <Fl label="SKU" hint="Auto-asignado"><input className="ti" value={f.sku} readOnly /></Fl>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Fl label="Número de Serie"><input className="ti" value={f.serial || ""} onChange={e => u("serial", e.target.value)} /></Fl>
            <Fl label="Condición"><select className="ti" value={f.condition} onChange={e => u("condition", e.target.value)}>{CONDS.map(c => <option key={c} value={c}>{c}</option>)}</select></Fl>
            <Fl label="Autenticación"><select className="ti" value={f.auth_level} onChange={e => u("auth_level", e.target.value)}>{AUTHS.map(a => <option key={a.c} value={a.c}>Nv.{a.l} — {a.n}</option>)}</select></Fl>
          </div>

          {/* AI Result Card — inline in ID tab */}
          {aiResult && <AiResultCard result={aiResult} />}
        </div>
      )}

      {/* ═══ TAB: DETALLES ═══ */}
      {tab === "detail" && (
        <div className="space-y-4 au">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Fl label="Color Dial"><select className="ti" value={f.dial_color || ""} onChange={e => u("dial_color", e.target.value)}><option value="">—</option>{DIAL_COLORS.map(c => <option key={c} value={c}>{c}</option>)}</select></Fl>
            <Fl label="Bisel"><select className="ti" value={f.bezel_type || ""} onChange={e => u("bezel_type", e.target.value)}><option value="">—</option>{BEZEL_TYPES.map(b => <option key={b} value={b}>{b}</option>)}</select></Fl>
            <Fl label="Caja (mm)"><select className="ti" value={f.case_size || ""} onChange={e => u("case_size", e.target.value)}><option value="">—</option>{CASE_SIZES.map(s => <option key={s} value={s}>{s}mm</option>)}</select></Fl>
            <Fl label="Correa / Brazalete"><select className="ti" value={f.strap_type || ""} onChange={e => u("strap_type", e.target.value)}><option value="">—</option>{STRAP_TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select></Fl>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 p-3 rounded-xl cursor-pointer" style={{ background: f.full_set !== false ? "rgba(74,222,128,.06)" : "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <input type="checkbox" checked={f.full_set !== false} onChange={e => u("full_set", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="fb text-sm text-white">Full Set</span>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-xl cursor-pointer" style={{ background: f.papers !== false ? "rgba(74,222,128,.06)" : "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <input type="checkbox" checked={f.papers !== false} onChange={e => u("papers", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="fb text-sm text-white">Papers</span>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-xl cursor-pointer" style={{ background: f.box !== false ? "rgba(74,222,128,.06)" : "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <input type="checkbox" checked={f.box !== false} onChange={e => u("box", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="fb text-sm text-white">Caja</span>
            </label>
          </div>

          {/* Catalog + Referenciada */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={f.publish_catalog || false} onChange={e => u("publish_catalog", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="fb text-sm font-medium text-white">Publicar en catálogo público</span>
            </label>
            {f.publish_catalog && <Fl label="Descripción para catálogo"><textarea className="ti" rows={2} value={f.catalog_description || ""} onChange={e => u("catalog_description", e.target.value)} placeholder="Descripción visible en el catálogo público..." /></Fl>}
            {f.publish_catalog && <Fl label="WhatsApp de contacto (esta pieza)" hint="Si se deja vacío, se usa el número general de TWR">
              <input className="ti" value={f.whatsapp_pieza || ""} onChange={e => u("whatsapp_pieza", e.target.value)} placeholder="5219991234567" />
            </Fl>}

            {/* Referenciada — solo superuser / director */}
            {(userRole === "superuser" || userRole === "director") && (
              <>
                <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", margin: "12px 0" }} />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={f.es_referenciada || false} onChange={e => { u("es_referenciada", e.target.checked); if (!e.target.checked) { u("referenciada_por", ""); u("referenciada_comision", 0); } }} className="w-4 h-4 rounded" />
                  <span className="fb text-sm font-medium" style={{ color: "var(--gd)" }}>🤝 Pieza Referenciada</span>
                  <span className="fb text-xs" style={{ color: "var(--cd)" }}>— En resguardo de un tercero</span>
                </label>
                {f.es_referenciada && (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <Fl label="Comercializado por" req><input className="ti" value={f.referenciada_por || ""} onChange={e => u("referenciada_por", e.target.value)} placeholder="Nombre del colaborador" /></Fl>
                    <Fl label="Comisión TWR %" hint="Porcentaje que TWR cobra por vinculación"><input type="number" className="ti" value={f.referenciada_comision || ""} onChange={e => u("referenciada_comision", Number(e.target.value))} placeholder="5" /></Fl>
                  </div>
                )}
              </>
            )}
          </div>

          <Fl label="Notas internas"><textarea className="ti" rows={2} value={f.notes || ""} onChange={e => u("notes", e.target.value)} /></Fl>
        </div>
      )}

      {/* ═══ TAB: FOTOS ═══ */}
      {tab === "photos" && (
        <div className="space-y-4 au">
          <PhotoUploader pieceId={f.id} fotos={localFotos} isNew={!piece}
            onUpload={(saved) => { if (saved) setLocalFotos(prev => [...prev.filter(ft => ft.posicion !== saved.posicion), saved]); }}
            onDelete={async (foto) => { try { await db.softDelFoto(foto.id); setLocalFotos(prev => prev.filter(ft => ft.id !== foto.id)); } catch(e) { alert("Error: " + e.message); } }}
            onOcrResult={(r) => { if (r.brand && !f.brand) u("brand", r.brand); if (r.model && !f.model) u("model", r.model); if (r.ref && !f.ref) u("ref", r.ref); if (r.serial && !f.serial) u("serial", r.serial); if (!f.name && r.brand && r.model) u("name", `${r.brand} ${r.model}`); }} />
          <AiValidation pieceId={f.id} fotos={localFotos} brand={f.brand} model={f.model} refNum={f.ref} serial={f.serial} isNew={!piece} />
        </div>
      )}

      {/* ═══ TAB: ADQUISICIÓN ═══ */}
      {tab === "money" && (
        <div className="space-y-4 au">
          {/* Proveedor */}
          <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
            <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Proveedor / Vendedor</div>
            {!newSupplier ? (
              <div className="flex gap-2">
                <select className="ti flex-1" value={f.supplier_id || ""} onChange={e => u("supplier_id", e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name} ({s.type || "Particular"}) {s.phone ? `· ${s.phone}` : ""}</option>)}
                </select>
                <button type="button" onClick={() => setNewSupplier({ name: "", phone: "", email: "", ine: "", type: "Particular", notes: "" })} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap" style={{ background: "rgba(201,169,110,.12)", color: "var(--cr)" }}>+ Nuevo</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="ti" placeholder="Nombre *" value={newSupplier.name} onChange={e => setNewSupplier(p => ({ ...p, name: e.target.value }))} />
                  <select className="ti" value={newSupplier.type} onChange={e => setNewSupplier(p => ({ ...p, type: e.target.value }))}>{SUPPLIER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                  <input className="ti" placeholder="Teléfono / WhatsApp" value={newSupplier.phone} onChange={e => setNewSupplier(p => ({ ...p, phone: e.target.value }))} />
                  <input className="ti" placeholder="Email" value={newSupplier.email} onChange={e => setNewSupplier(p => ({ ...p, email: e.target.value }))} />
                  <input className="ti" placeholder="INE / Identificación" value={newSupplier.ine} onChange={e => setNewSupplier(p => ({ ...p, ine: e.target.value }))} />
                  <input className="ti" placeholder="Notas" value={newSupplier.notes} onChange={e => setNewSupplier(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={async () => {
                    if (!newSupplier.name) return alert("Nombre requerido");
                    const s = { id: "Pid_" + uid().slice(0, 8), ...newSupplier };
                    try { if (onSaveSupplier) await onSaveSupplier(s); u("supplier_id", s.id); setNewSupplier(null); } catch(e) { alert("Error: " + e.message); }
                  }} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.15)", color: "var(--gn)" }}>Guardar Proveedor</button>
                  <button type="button" onClick={() => setNewSupplier(null)} className="fb text-xs px-3 py-1.5 rounded-lg" style={{ color: "var(--cd)" }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>

          {/* Origen del recurso — v22 simplified */}
          {((!piece && f.cost > 0) || (piece && Number(piece.cost) === 0 && f.cost > 0)) && f.entry_type !== "trade_in" && (
          <div className="rounded-xl p-4" style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.12)" }}>
            <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--bl)" }}>↓ Origen del Recurso</div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" onClick={() => { setCombinedFin(false); setNewCapital(0); }} className="p-3 rounded-xl text-center transition-all" style={{ background: !combinedFin ? "rgba(96,165,250,.12)" : "rgba(255,255,255,.03)", border: !combinedFin ? "1.5px solid rgba(96,165,250,.3)" : "1.5px solid rgba(255,255,255,.06)" }}>
                <div className="text-lg mb-1">🏦</div>
                <div className="fb text-xs font-semibold" style={{ color: !combinedFin ? "var(--bl)" : "var(--cd)" }}>Del Fondo</div>
                <div className="fd text-sm font-bold mt-1" style={{ color: !combinedFin ? "white" : "var(--cd)" }}>{fmxn(cashInFund)}</div>
              </button>
              <button type="button" onClick={() => { setCombinedFin(true); setNewCapital(f.cost); }} className="p-3 rounded-xl text-center transition-all" style={{ background: combinedFin ? "rgba(74,222,128,.12)" : "rgba(255,255,255,.03)", border: combinedFin ? "1.5px solid rgba(74,222,128,.3)" : "1.5px solid rgba(255,255,255,.06)" }}>
                <div className="text-lg mb-1">💰</div>
                <div className="fb text-xs font-semibold" style={{ color: combinedFin ? "var(--gn)" : "var(--cd)" }}>Nueva Aportación</div>
                <div className="fd text-xs mt-1" style={{ color: combinedFin ? "var(--gn)" : "var(--cd)" }}>Se inyecta capital</div>
              </button>
            </div>
            {combinedFin && (
              <div className="p-3 rounded-lg mb-2" style={{ background: "rgba(74,222,128,.06)" }}>
                <div className="fb text-xs" style={{ color: "var(--gn)" }}>Se registrará una inyección de capital de <strong>{fmxn(f.cost)}</strong> al fondo del inversionista</div>
              </div>
            )}
            {!combinedFin && cashAfter < 0 && (
              <div className="p-3 rounded-lg" style={{ background: "rgba(251,113,133,.06)" }}>
                <div className="fb text-xs mb-2" style={{ color: "var(--rd)" }}>⚠️ Faltan {fmxn(Math.abs(cashAfter))} en el fondo</div>
                <button type="button" onClick={() => { setCombinedFin(true); setNewCapital(f.cost); }} className="fb text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>
                  💰 Registrar como nueva aportación
                </button>
              </div>
            )}
            {!combinedFin && cashAfter >= 0 && <div className="fb text-xs text-center p-2 rounded-lg" style={{ background: "rgba(74,222,128,.04)", color: "var(--gn)" }}>✓ El fondo cubre esta compra — Cash después: {fmxn(cashAfter)}</div>}
          </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Fl label="Motivo de Entrada" req><select className="ti" value={f.entry_type} onChange={e => u("entry_type", e.target.value)}>{ETYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Fl>
            <Fl label="Fecha Entrada" req><input type="date" className="ti" value={f.entry_date} onChange={e => u("entry_date", e.target.value)} /></Fl>
            <Fl label="Método de Pago"><select className="ti" value={f.metodo_pago || "Efectivo MXN"} onChange={e => u("metodo_pago", e.target.value)}>{PAYS.filter(p => p !== "Trade" && p !== "Trade+Cash").map(p => <option key={p} value={p}>{p}</option>)}</select></Fl>
          </div>

          {/* Pricing */}
          <div className="rounded-xl p-4" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.12)" }}>
            <Fl label="Precio Costo (MXN)" req>
              <input type="number" className="ti" style={{ fontSize: 18, fontWeight: 700 }} value={f.cost || ""}
                onChange={e => { const n = Number(e.target.value); sF(p => ({ ...p, cost: n, ...calcPr(n) })); }} />
            </Fl>
            {/* Live cash indicator */}
            {f.cost > 0 && !combinedFin && f.entry_type !== "trade_in" && ((!piece) || (piece && Number(piece.cost) === 0)) && (
              <div className="mt-2 rounded-xl p-3" style={{ background: cashAfter >= 0 ? "rgba(74,222,128,.04)" : "rgba(251,113,133,.06)", border: `1px solid ${cashAfter >= 0 ? "rgba(74,222,128,.1)" : "rgba(251,113,133,.15)"}` }}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Cash actual</div><div className="fd font-bold" style={{ color: "var(--bl)" }}>{fmxn(cashInFund)}</div></div>
                  <div><div className="fb text-xs" style={{ color: "var(--rd)" }}>Costo pieza</div><div className="fd font-bold" style={{ color: "var(--rd)" }}>-{fmxn(f.cost)}</div></div>
                  <div><div className="fb text-xs" style={{ color: cashAfter >= 0 ? "var(--gn)" : "var(--rd)" }}>Después</div><div className="fd font-bold" style={{ color: cashAfter >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(cashAfter)}</div></div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Fl label="Dealer +8%"><input type="number" className="ti" value={f.price_dealer || ""} onChange={e => u("price_dealer", Number(e.target.value))} /></Fl>
              <Fl label="Lista +15%"><input type="number" className="ti" value={f.price_asked || ""} onChange={e => u("price_asked", Number(e.target.value))} /></Fl>
              <Fl label="Trade +20%"><input type="number" className="ti" value={f.price_trade || ""} onChange={e => u("price_trade", Number(e.target.value))} /></Fl>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: GASTOS OPERATIVOS ═══ */}
      {tab === "costos" && piece && (
        <div className="space-y-4 au">
          <div className="flex items-center justify-between">
            <div>
              <span className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gk)" }}>Gastos de {piece.name}</span>
              {totalCostos > 0 && <div className="fb text-xs mt-1" style={{ color: "var(--rd)" }}>Total gastos: {fmxn(totalCostos)} · Costo real: {fmxn((f.cost || 0) + totalCostos)}</div>}
            </div>
            {!newCosto && <button type="button" onClick={() => setNewCosto({ tipo: "TC1", monto: "", fecha: td(), descripcion: "" })} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(201,169,110,.12)", color: "var(--cr)" }}>+ Agregar Gasto</button>}
          </div>
          {newCosto && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.12)" }}>
              <div className="grid grid-cols-2 gap-3">
                <Fl label="Tipo de Gasto" req>
                  <select className="ti" value={newCosto.tipo} onChange={e => setNewCosto(p => ({ ...p, tipo: e.target.value }))}>
                    <optgroup label="── Pre-venta / Operación ──">
                      {tiposCosto.filter(t => t.cat === "pre").map(t => <option key={t.id} value={t.id}>{t.i} {t.n}</option>)}
                    </optgroup>
                    <optgroup label="── Gastos de Venta ──">
                      {tiposCosto.filter(t => t.cat === "venta").map(t => <option key={t.id} value={t.id}>{t.i} {t.n}</option>)}
                    </optgroup>
                    <optgroup label="── Generales ──">
                      {tiposCosto.filter(t => t.cat === "gral").map(t => <option key={t.id} value={t.id}>{t.i} {t.n}</option>)}
                    </optgroup>
                  </select>
                </Fl>
                <Fl label="Monto (MXN)" req><input type="number" className="ti" value={newCosto.monto} onChange={e => setNewCosto(p => ({ ...p, monto: e.target.value }))} /></Fl>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fl label="Fecha"><input type="date" className="ti" value={newCosto.fecha} onChange={e => setNewCosto(p => ({ ...p, fecha: e.target.value }))} /></Fl>
                <Fl label="Descripción"><input className="ti" value={newCosto.descripcion} onChange={e => setNewCosto(p => ({ ...p, descripcion: e.target.value }))} placeholder="Detalle opcional" /></Fl>
              </div>
              <div className="flex gap-2">
                <BtnP onClick={async () => {
                  if (!newCosto.monto) return alert("Monto requerido");
                  try {
                    await db.saveCosto({ id: "CX-" + uid().slice(0, 8), pieza_id: piece.id, tipo: newCosto.tipo, fecha: newCosto.fecha, monto: Number(newCosto.monto), descripcion: newCosto.descripcion });
                    setCostosData(await db.loadCostos(piece.id));
                    setNewCosto(null);
                  } catch (e) { alert("Error: " + e.message); }
                }}>Guardar Gasto</BtnP>
                <BtnS onClick={() => setNewCosto(null)}>Cancelar</BtnS>
              </div>
            </div>
          )}
          {costosData.length > 0 ? (
            <div className="space-y-2">
              {costosData.map(c => {
                const tc = tiposCosto.find(t => t.id === c.tipo);
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                    <span className="text-lg">{tc?.i || "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="fb text-sm font-semibold text-white">{tc?.n || c.tipo}</div>
                      <div className="fb text-xs" style={{ color: "var(--cd)" }}>{c.fecha}{c.descripcion ? ` — ${c.descripcion}` : ""}</div>
                    </div>
                    <div className="fd font-bold text-sm" style={{ color: "var(--rd)" }}>{fmxn(c.monto)}</div>
                    <button type="button" onClick={async () => {
                      if (!confirm("¿Eliminar este gasto?")) return;
                      try { await db.delCosto(c.id); setCostosData(await db.loadCostos(piece.id)); } catch (e) { alert("Error: " + e.message); }
                    }} className="fb text-xs" style={{ color: "var(--rd)" }}>🗑</button>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(251,113,133,.06)", border: "1px solid rgba(251,113,133,.1)" }}>
                <span className="text-lg">💸</span>
                <div className="flex-1"><span className="fb text-sm font-semibold text-white">Total Gastos Operativos</span></div>
                <div className="fd font-bold" style={{ color: "var(--rd)" }}>{fmxn(totalCostos)}</div>
              </div>
              {(() => {
                const preCostos = costosData.filter(c => tiposCosto.find(t => t.id === c.tipo)?.cat === "pre").reduce((s, c) => s + (Number(c.monto) || 0), 0);
                const ventaCostos = costosData.filter(c => tiposCosto.find(t => t.id === c.tipo)?.cat === "venta").reduce((s, c) => s + (Number(c.monto) || 0), 0);
                return (<div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(96,165,250,.06)" }}>
                    <span className="fb text-xs" style={{ color: "var(--bl)" }}>Pre-venta</span>
                    <span className="fb text-xs font-bold ml-auto" style={{ color: "var(--bl)" }}>{fmxn(preCostos)}</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(251,113,133,.06)" }}>
                    <span className="fb text-xs" style={{ color: "#FB7185" }}>De venta</span>
                    <span className="fb text-xs font-bold ml-auto" style={{ color: "#FB7185" }}>{fmxn(ventaCostos)}</span>
                  </div>
                </div>);
              })()}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.1)" }}>
                <span className="text-lg">📊</span>
                <div className="flex-1"><span className="fb text-sm font-semibold text-white">Costo Real Total</span><br /><span className="fb text-xs" style={{ color: "var(--cd)" }}>Adquisición + todos los gastos</span></div>
                <div className="fd font-bold" style={{ color: "var(--gd)" }}>{fmxn((f.cost || 0) + totalCostos)}</div>
              </div>
            </div>
          ) : !newCosto && (
            <div className="text-center py-8">
              <div className="text-3xl mb-2 opacity-30">🧾</div>
              <div className="fb text-sm" style={{ color: "var(--cd)" }}>Sin gastos operativos registrados</div>
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Envíos, autenticaciones, reparaciones, seguros...</div>
            </div>
          )}
        </div>
      )}

      {/* ═══ SUMMARY BAR + ACTIONS (always visible) ═══ */}
      <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          {f.brand && <span className="fb text-xs px-2 py-1 rounded-full" style={{ background: "rgba(201,169,110,.1)", color: "var(--cr)" }}>{f.brand} {f.model}</span>}
          {f.ref && <span className="fb text-xs" style={{ color: "var(--cd)" }}>Ref: {f.ref}</span>}
          {f.cost > 0 && <span className="fb text-xs font-bold" style={{ color: "var(--gn)" }}>{fmxn(f.cost)}{totalCostos > 0 ? ` (+${fmxn(totalCostos)} gastos)` : ""}</span>}
          {f.serial && <span className="fb text-xs" style={{ color: "var(--cd)" }}>S/N: {f.serial}</span>}
          <span className="fb text-xs" style={{ color: "var(--cd)" }}>SKU: {f.sku}</span>
        </div>
        <div className="flex gap-3">
          <BtnP onClick={async () => {
            if (saving) return;
            if (!piece && f.entry_type !== "trade_in" && (!f.cost || Number(f.cost) <= 0)) { alert("Debes poner el precio de costo antes de guardar"); return; }
            if (!piece && !f.brand) { alert("Selecciona una marca"); return; }
            setSaving(true);
            try { await onSave({ ...f, _newCapital: combinedFin ? (Number(f.cost) || 0) : 0, _pendingFotos: localFotos.filter(ft => ft._pending) }); } catch(e) { alert("Error: " + e.message); } finally { setSaving(false); }
          }} disabled={saving}>{saving ? "Guardando..." : "Guardar Pieza"}</BtnP>
          <BtnS onClick={onClose}>Cancelar</BtnS>
        </div>
      </div>
    </div>
  );
}

/* ═══ SELL FORM ═══ */
function SellForm({ piece, onSave, onClose, docs, socios, allPieces, clients, onSaveClient, costos, invInfo: fi, myInvs, txs: txsProp }) {
  const invInfo = fi || {};
  const [f, sF] = useState({ xPrice: piece.price_asked || 0, xDate: td(), cDate: td(), payOut: "Efectivo MXN", xType: "venta", xFund: piece.fondo_id || "FIC", client_id: "" });
  const u = (k, v) => sF(p => ({ ...p, [k]: v }));
  const c = piece.cost || 0;
  const pieceCostos = (costos || []).filter(cx => cx.pieza_id === piece.id);
  const totalGastos = pieceCostos.reduce((s, cx) => s + (Number(cx.monto) || 0), 0);
  const costoReal = c + totalGastos;
  const pr = f.xPrice - costoReal;
  const isTrade = f.xType === "trade_out";
  const [newClient, setNewClient] = useState(null);
  const [saving, setSaving] = useState(false);

  // Trade-out state
  const [incoming, setIncoming] = useState([]);
  const [cashOut, setCashOut] = useState(0);
  const [cashIn, setCashIn] = useState(0);
  const addIn = () => {
    // Auto-set value: remaining balance after cash and other pieces
    const otherPiecesVal = incoming.reduce((s, p) => s + (p.value || 0), 0);
    const autoVal = Math.max(0, c + cashOut - cashIn - otherPiecesVal);
    setIncoming(p => [...p, { id: uid(), brand: "", model: "", ref: "", value: autoVal }]);
  };
  const updIn = (id, k, v) => setIncoming(p => p.map(x => x.id === id ? { ...x, [k]: v } : x));
  const remIn = (id) => setIncoming(p => p.filter(x => x.id !== id));
  const totalIn = incoming.reduce((s, p) => s + (p.value || 0), 0);

  // Auto-recalc: when cash changes and there's exactly 1 incoming piece, update its value
  const autoRecalcSingle = (newCashIn, newCashOut) => {
    if (incoming.length === 1) {
      const autoVal = Math.max(0, c + newCashOut - newCashIn);
      setIncoming(prev => prev.map(x => ({ ...x, value: autoVal })));
    }
  };
  const handleCashIn = (v) => { setCashIn(v); autoRecalcSingle(v, cashOut); };
  const handleCashOut = (v) => { setCashOut(v); autoRecalcSingle(cashIn, v); };

  // Balance: outgoing cost should equal incoming pieces + cashIn - cashOut
  const expectedIn = c + cashOut - cashIn;
  const balanceDiff = totalIn - expectedIn;

  return (
    <div className="space-y-4">
      <Cd className="p-4">
        <div className="fd font-semibold text-white">{piece.name}</div>
        <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>SKU: {piece.sku} · Costo: {fmxn(c)}{totalGastos > 0 ? ` + Gastos: ${fmxn(totalGastos)} = Real: ${fmxn(costoReal)}` : ""} · {invInfo[piece.fondo_id]?.short || piece.fondo_id}</div>
      </Cd>

      <div className="grid grid-cols-2 gap-3">
        <Fl label="Tipo de Salida" req><select className="ti" value={f.xType} onChange={e => u("xType", e.target.value)}>{EXIT_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Fl>
        {!isTrade && <Fl label="Precio de Venta" req><input type="number" className="ti" value={f.xPrice} onChange={e => u("xPrice", Number(e.target.value))} /></Fl>}
        {isTrade && <Fl label="Valor de salida"><div className="fd font-bold text-lg text-white pt-1">{fmxn(c)}</div></Fl>}
      </div>

      {/* Cliente / Contraparte */}
      <div className="rounded-xl p-3" style={{ background: "rgba(201,169,110,.04)", border: "1px solid rgba(201,169,110,.08)" }}>
        <div className="fb text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--gd)" }}>{isTrade ? "Contraparte del Trade" : "Cliente / Comprador"}</div>
        {!newClient ? (
          <div className="flex gap-2">
            <select className="ti flex-1" value={f.client_id || ""} onChange={e => u("client_id", e.target.value)}>
              <option value="">— Sin asignar —</option>
              {(clients || []).map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `· ${c.phone}` : ""}</option>)}
            </select>
            <button type="button" onClick={() => setNewClient({ name: "", phone: "", email: "", ine: "", notes: "" })} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap" style={{ background: "rgba(201,169,110,.12)", color: "var(--cr)" }}>+ Nuevo</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="ti" placeholder="Nombre *" value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} />
              <input className="ti" placeholder="Teléfono / WhatsApp" value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))} />
              <input className="ti" placeholder="Email" value={newClient.email} onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))} />
              <input className="ti" placeholder="INE / Identificación" value={newClient.ine} onChange={e => setNewClient(p => ({ ...p, ine: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={async () => {
                if (!newClient.name) return alert("Nombre requerido");
                const cl = { id: "Cid_" + uid().slice(0, 8), ...newClient, tier: "Regular" };
                try { if (onSaveClient) await onSaveClient(cl); u("client_id", cl.id); setNewClient(null); } catch(e) { alert("Error: " + e.message); }
              }} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.15)", color: "var(--gn)" }}>Guardar Cliente</button>
              <button type="button" onClick={() => setNewClient(null)} className="fb text-xs px-3 py-1.5 rounded-lg" style={{ color: "var(--cd)" }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ TRADE OUT SECTION ═══ */}
      {isTrade && (
        <>
          {/* Incoming pieces */}
          <div className="rounded-xl p-4" style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.1)" }}>
            <div className="flex justify-between items-center mb-3">
              <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gn)" }}>⬇ Piezas que entran</div>
              <button type="button" onClick={addIn} className="fb text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.15)", color: "var(--gn)" }}>+ Agregar</button>
            </div>
            {incoming.length === 0 && <div className="fb text-sm text-center py-4" style={{ color: "var(--cd)" }}>Agrega al menos 1 pieza que recibes a cambio</div>}
            {incoming.map(item => {
              const knownBrand = BRANDS.includes(item.brand);
              const ms = knownBrand ? getModels(item.brand) : [];
              const knownModel = ms.includes(item.model);
              const rs = knownBrand && knownModel ? getRefs(item.brand, item.model) : [];
              return (
                <div key={item.id} className="p-3 rounded-lg mb-2" style={{ background: "rgba(74,222,128,.06)" }}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {/* Brand: select or manual */}
                    {!item._manualBrand ? (
                      <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.brand} onChange={e => {
                        if (e.target.value === "__OTHER__") { updIn(item.id, "_manualBrand", true); updIn(item.id, "brand", ""); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                        else { updIn(item.id, "brand", e.target.value); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                      }}>
                        <option value="">Marca...</option>{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                        <option value="__OTHER__">✏️ Otra marca...</option>
                      </select>
                    ) : (
                      <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.brand} placeholder="Marca manual" onChange={e => updIn(item.id, "brand", e.target.value)} /><button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualBrand", false); updIn(item.id, "brand", ""); }}>↩</button></div>
                    )}
                    {/* Model: select or manual */}
                    {ms.length > 0 && !item._manualModel ? (
                      <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} onChange={e => {
                        if (e.target.value === "__OTHER__") { updIn(item.id, "_manualModel", true); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                        else { updIn(item.id, "model", e.target.value); updIn(item.id, "ref", ""); }
                      }}>
                        <option value="">Modelo...</option>{ms.map(m => <option key={m} value={m}>{m}</option>)}
                        <option value="__OTHER__">✏️ Otro modelo...</option>
                      </select>
                    ) : (
                      <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} placeholder="Modelo" onChange={e => updIn(item.id, "model", e.target.value)} />{ms.length > 0 && <button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualModel", false); updIn(item.id, "model", ""); }}>↩</button>}</div>
                    )}
                    {/* Ref: select or manual */}
                    {rs.length > 0 && !item._manualRef ? (
                      <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} onChange={e => {
                        if (e.target.value === "__OTHER__") { updIn(item.id, "_manualRef", true); updIn(item.id, "ref", ""); }
                        else updIn(item.id, "ref", e.target.value);
                      }}>
                        <option value="">Ref...</option>{rs.map(r => <option key={r} value={r}>{r}</option>)}
                        <option value="__OTHER__">✏️ Otra ref...</option>
                      </select>
                    ) : (
                      <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} placeholder="Ref." onChange={e => updIn(item.id, "ref", e.target.value)} />{rs.length > 0 && <button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualRef", false); updIn(item.id, "ref", ""); }}>↩</button>}</div>
                    )}
                    <div className="flex gap-1"><input type="number" className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px", fontWeight: 700 }} placeholder="Valor $" value={item.value || ""} onChange={e => updIn(item.id, "value", Number(e.target.value))} /><BtnD onClick={() => remIn(item.id)}>✕</BtnD></div>
                  </div>
                </div>
              );
            })}
            {totalIn > 0 && <div className="flex justify-between pt-2 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}><span className="fb text-xs font-bold" style={{ color: "var(--gn)" }}>Total ({incoming.length})</span><span className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(totalIn)}</span></div>}
          </div>

          {/* Cash difference */}
          <div className="rounded-xl p-4" style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.1)" }}>
            <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--bl)" }}>💰 Diferencia en Efectivo</div>
            <div className="grid grid-cols-2 gap-3">
              <Fl label="Nosotros pagamos" hint="Sale del fondo"><input type="number" className="ti" value={cashOut} onChange={e => handleCashOut(Number(e.target.value))} placeholder="0" /></Fl>
              <Fl label="Nosotros recibimos" hint="Entra al fondo"><input type="number" className="ti" value={cashIn} onChange={e => handleCashIn(Number(e.target.value))} placeholder="0" /></Fl>
            </div>
            {(cashOut > 0 || cashIn > 0) && <div className="mt-2 fb text-xs p-2 rounded-lg" style={{ background: "rgba(96,165,250,.08)", color: "var(--bl)" }}>
              {cashOut > 0 && <span>↑ {fmxn(cashOut)} sale del fondo</span>}
              {cashOut > 0 && cashIn > 0 && <span> · </span>}
              {cashIn > 0 && <span>↓ {fmxn(cashIn)} entra al fondo</span>}
            </div>}
          </div>

          {/* Trade balance */}
          <div className="rounded-xl p-3 text-center" style={{ background: balanceDiff === 0 ? "rgba(74,222,128,.08)" : "rgba(251,191,36,.08)", border: balanceDiff === 0 ? "1px solid rgba(74,222,128,.15)" : "1px solid rgba(251,191,36,.15)" }}>
            <div className="grid grid-cols-4 gap-2">
              <div><div className="fb text-xs" style={{ color: "var(--rd)" }}>Sale</div><div className="fd font-bold text-white">{fmxn(c)}</div></div>
              <div><div className="fb text-xs" style={{ color: "var(--gn)" }}>Piezas In</div><div className="fd font-bold text-white">{fmxn(totalIn)}</div></div>
              <div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Cash Neto</div><div className="fd font-bold" style={{ color: (cashIn - cashOut) >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(cashIn - cashOut)}</div></div>
              <div><div className="fb text-xs" style={{ color: balanceDiff === 0 ? "var(--gn)" : "#FBBF24" }}>{balanceDiff === 0 ? "✓ Cuadra" : "⚠ Descuadre"}</div><div className="fd font-bold" style={{ color: balanceDiff === 0 ? "var(--gn)" : "#FBBF24" }}>{balanceDiff === 0 ? "$0" : fmxn(balanceDiff)}</div></div>
            </div>
            {balanceDiff !== 0 && <div className="fb text-xs mt-2" style={{ color: "#FBBF24" }}>Piezas ({fmxn(totalIn)}) + Cash recibido ({fmxn(cashIn)}) - Cash pagado ({fmxn(cashOut)}) debe = Costo salida ({fmxn(c)})</div>}
          </div>
        </>
      )}

      {/* Destino del recurso — only for sales */}
      {!isTrade && (
        <div className="rounded-xl p-4" style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.12)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gn)" }}>↑ Destino del Recurso</span>
            <span className="fb text-xs" style={{ color: "var(--cd)" }}>— ¿A qué fondo entra el dinero?</span>
          </div>
          <InvSel value={f.xFund} onChange={v => u("xFund", v)} funds={myInvs || ["FIC"]} invInfo={invInfo} txs={txsProp} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Fl label={isTrade ? "Fecha Trade" : "Fecha Venta"}><input type="date" className="ti" value={f.xDate} onChange={e => u("xDate", e.target.value)} /></Fl>
        {!isTrade && <Fl label="Fecha Cobro"><input type="date" className="ti" value={f.cDate} onChange={e => u("cDate", e.target.value)} /></Fl>}
        <Fl label="Método"><select className="ti" value={f.payOut} onChange={e => u("payOut", e.target.value)}>{PAYS.map(m => <option key={m} value={m}>{m}</option>)}</select></Fl>
      </div>

      {/* Profit preview — only for sales */}
      {!isTrade && f.xPrice > 0 && (
        <div className="rounded-xl p-4" style={{ background: pr >= 0 ? "rgba(74,222,128,.06)" : "rgba(251,113,133,.06)", border: pr >= 0 ? "1px solid rgba(74,222,128,.15)" : "1px solid rgba(251,113,133,.15)" }}>
          {totalGastos > 0 && (
            <div className="fb text-xs mb-3 p-2 rounded-lg space-y-1" style={{ background: "rgba(255,255,255,.03)" }}>
              <div className="flex justify-between"><span style={{ color: "var(--cd)" }}>Venta</span><span className="font-bold text-white">{fmxn(f.xPrice)}</span></div>
              <div className="flex justify-between"><span style={{ color: "var(--cd)" }}>- Costo adquisición</span><span style={{ color: "var(--rd)" }}>-{fmxn(c)}</span></div>
              <div className="flex justify-between"><span style={{ color: "var(--cd)" }}>- Gastos operativos ({pieceCostos.length})</span><span style={{ color: "var(--rd)" }}>-{fmxn(totalGastos)}</span></div>
              <div className="flex justify-between pt-1" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}><span className="font-bold" style={{ color: "var(--gd)" }}>= Utilidad Real</span><span className="font-bold" style={{ color: pr >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(pr)}</span></div>
            </div>
          )}
          <div className={`grid gap-3 text-center`} style={{ gridTemplateColumns: `repeat(${(socios?.length || 0) + 1}, 1fr)` }}>
            <div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Utilidad{totalGastos > 0 ? " Real" : ""}</span><br /><span className="fd font-bold text-lg" style={{ color: pr >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(pr)}</span></div>
            {(socios || []).map(s => <div key={s.id}><span className="fb text-xs" style={{ color: s.color }}>{s.name} {s.participacion}%</span><br /><span className="fd font-bold text-white">{fmxn(Math.round(pr * (Number(s.participacion) / 100)))}</span></div>)}
          </div>
        </div>
      )}

      {/* Documents */}
      <DocUploader entityType={isTrade ? "trade" : "venta"} entityId={piece.id} requiredDocs={isTrade ? ["identificacion", "contrato"] : ["identificacion", "contrato", "comprobante_pago"]} docs={docs} onUpload={() => {}} />

      <div className="flex gap-3 pt-2">
        {isTrade ? (
          <BtnG disabled={saving} onClick={async () => {
            if (saving) return;
            if (incoming.length === 0 || !incoming.some(i => i.brand && i.value > 0)) return alert("Agrega al menos 1 pieza que recibes");
            const bd = totalIn + cashIn - cashOut - c;
            if (bd !== 0 && !confirm(`El trade está descuadrado por ${fmxn(bd)}. ¿Registrar de todos modos?`)) return;
            setSaving(true);
            try { await onSave({ ...piece, status: "Vendido", stage: "liquidado", exit_type: "trade_out", exit_fund: piece.fondo_id, ...f, _tradeIncoming: incoming, _cashOut: cashOut, _cashIn: cashIn }); } catch(e) { alert("Error: " + e.message); } finally { setSaving(false); }
          }}>{saving ? "Guardando..." : "Registrar Trade Out"}</BtnG>
        ) : (
          <BtnG disabled={saving} onClick={async () => { if (saving) return; setSaving(true); try { await onSave({ ...piece, status: "Vendido", stage: "liquidado", exit_type: f.xType, exit_fund: f.xFund, ...f }); } catch(e) { alert("Error: " + e.message); } finally { setSaving(false); } }}>{saving ? "Guardando..." : "Registrar Venta"}</BtnG>
        )}
        <BtnS onClick={onClose} disabled={saving}>Cancelar</BtnS>
      </div>
    </div>
  );
}

/* ═══ TRADE FORM (multi-piece) ═══ */
function TradeForm({ piece, allPieces, onSave, onClose }) {
  const avail = (allPieces || []).filter(p => p.status === "Disponible" && p.id !== piece.id);
  const [outIds, setOutIds] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [cashOut, setCashOut] = useState(0);
  const [cashIn, setCashIn] = useState(0);
  const [date, setDate] = useState(td());
  const cashDiff = cashIn - cashOut;

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
          const knownBrand = BRANDS.includes(item.brand);
          const ms = knownBrand ? getModels(item.brand) : [];
          const knownModel = ms.includes(item.model);
          const rs = knownBrand && knownModel ? getRefs(item.brand, item.model) : [];
          return (
            <div key={item.id} className="p-3 rounded-lg mb-2" style={{ background: "rgba(74,222,128,.06)" }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {!item._manualBrand ? (
                  <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.brand} onChange={e => {
                    if (e.target.value === "__OTHER__") { updIn(item.id, "_manualBrand", true); updIn(item.id, "brand", ""); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                    else { updIn(item.id, "brand", e.target.value); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                  }}>
                    <option value="">Marca...</option>{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                    <option value="__OTHER__">✏️ Otra marca...</option>
                  </select>
                ) : (
                  <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.brand} placeholder="Marca manual" onChange={e => updIn(item.id, "brand", e.target.value)} /><button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualBrand", false); updIn(item.id, "brand", ""); }}>↩</button></div>
                )}
                {ms.length > 0 && !item._manualModel ? (
                  <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} onChange={e => {
                    if (e.target.value === "__OTHER__") { updIn(item.id, "_manualModel", true); updIn(item.id, "model", ""); updIn(item.id, "ref", ""); }
                    else { updIn(item.id, "model", e.target.value); updIn(item.id, "ref", ""); }
                  }}>
                    <option value="">Modelo...</option>{ms.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="__OTHER__">✏️ Otro modelo...</option>
                  </select>
                ) : (
                  <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.model} placeholder="Modelo" onChange={e => updIn(item.id, "model", e.target.value)} />{ms.length > 0 && <button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualModel", false); updIn(item.id, "model", ""); }}>↩</button>}</div>
                )}
                {rs.length > 0 && !item._manualRef ? (
                  <select className="ti" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} onChange={e => {
                    if (e.target.value === "__OTHER__") { updIn(item.id, "_manualRef", true); updIn(item.id, "ref", ""); }
                    else updIn(item.id, "ref", e.target.value);
                  }}>
                    <option value="">Ref...</option>{rs.map(r => <option key={r} value={r}>{r}</option>)}
                    <option value="__OTHER__">✏️ Otra ref...</option>
                  </select>
                ) : (
                  <div className="flex gap-1"><input className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px" }} value={item.ref} placeholder="Ref." onChange={e => updIn(item.id, "ref", e.target.value)} />{rs.length > 0 && <button type="button" className="fb text-xs px-1.5 rounded" style={{ color: "var(--cd)" }} onClick={() => { updIn(item.id, "_manualRef", false); updIn(item.id, "ref", ""); }}>↩</button>}</div>
                )}
                <div className="flex gap-1"><input type="number" className="ti flex-1" style={{ fontSize: 12, padding: "6px 10px", fontWeight: 700 }} placeholder="Valor $" value={item.value || ""} onChange={e => updIn(item.id, "value", Number(e.target.value))} /><BtnD onClick={() => remIn(item.id)}>✕</BtnD></div>
              </div>
            </div>
          );
        })}
        {totalIn > 0 && <div className="flex justify-between pt-2 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}><span className="fb text-xs font-bold" style={{ color: "var(--gn)" }}>Total ({incoming.length})</span><span className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(totalIn)}</span></div>}
      </div>

      {/* Cash Direction + Date */}
      <div className="rounded-xl p-4" style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.1)" }}>
        <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--bl)" }}>💰 Diferencia en Efectivo</div>
        <div className="grid grid-cols-2 gap-3">
          <Fl label="Nosotros pagamos" hint="Sale del fondo FIC"><input type="number" className="ti" value={cashOut} onChange={e => setCashOut(Number(e.target.value))} placeholder="0" /></Fl>
          <Fl label="Nosotros recibimos" hint="Entra al fondo FIC"><input type="number" className="ti" value={cashIn} onChange={e => setCashIn(Number(e.target.value))} placeholder="0" /></Fl>
        </div>
        {(cashOut > 0 || cashIn > 0) && <div className="mt-2 fb text-xs p-2 rounded-lg" style={{ background: "rgba(96,165,250,.08)", color: "var(--bl)" }}>
          {cashOut > 0 && <span>↑ {fmxn(cashOut)} sale del FIC (pagamos diferencia)</span>}
          {cashOut > 0 && cashIn > 0 && <span> · </span>}
          {cashIn > 0 && <span>↓ {fmxn(cashIn)} entra al FIC (recibimos diferencia)</span>}
        </div>}
      </div>
      <Fl label="Fecha"><input type="date" className="ti" value={date} onChange={e => setDate(e.target.value)} /></Fl>

      {/* Balance */}
      <div className="rounded-xl p-4 grid grid-cols-4 gap-2 text-center" style={{ background: "rgba(201,169,110,.08)" }}>
        <div><div className="fb text-xs" style={{ color: "var(--rd)" }}>Sale</div><div className="fd font-bold text-white">{fmxn(totalOut)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--gn)" }}>Entra</div><div className="fd font-bold text-white">{fmxn(totalIn)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Dif $</div><div className="fd font-bold" style={{ color: cashDiff >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(cashDiff)}</div></div>
        <div><div className="fb text-xs" style={{ color: "var(--gd)" }}>Neto</div><div className="fd font-bold" style={{ color: (totalIn + cashDiff - totalOut) >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(totalIn + cashDiff - totalOut)}</div></div>
      </div>

      {/* Docs */}
      <DocUploader entityType="trade" entityId={piece.id} requiredDocs={["identificacion", "contrato"]} docs={[]} onUpload={() => {}} />

      <div className="flex gap-3 pt-2"><BtnG onClick={() => onSave({ outPieces: allOut, incoming, cashDiff, cashOut, cashIn, date })} disabled={!isValid}>Registrar Trade</BtnG><BtnS onClick={onClose}>Cancelar</BtnS></div>
    </div>
  );
}

/* ═══ SETTINGS PAGE (with proper React state) ═══ */
function SettingsPage({ data, showToast, refresh, currentUser }) {
  const socios = data?.socios || [];
  const profiles = data?.profiles || [];
  const myProfile = profiles.find(p => p.id === currentUser?.id);
  const isSuperuser = myProfile?.role === "superuser";
  const [socioNames, setSocioNames] = useState(Object.fromEntries(socios.map(s => [s.id, s.name])));
  const [waNum, setWaNum] = useState((data?.settings?.whatsapp_number || "").replace(/"/g, ""));
  const [newUser, setNewUser] = useState({ email: "", pass: "", name: "" });
  const [creating, setCreating] = useState(false);
  const [profileEdits, setProfileEdits] = useState(Object.fromEntries(profiles.map(p => [p.id, { name: p.name || "", role: p.role || "operador" }])));
  const ROLES = ROLE_OPTS;

  return (
    <div className="space-y-5 au">
      <h1 className="fd text-2xl md:text-3xl font-bold text-white">Configuración</h1>

      {/* SOCIOS */}
      <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-4">👥 Socios / Capitalistas</h3>
        <div className="space-y-3">
          {socios.map(s => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
              <span className="fb text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${s.color}22`, color: s.color }}>{s.participacion}%</span>
              <input className="ti flex-1" value={socioNames[s.id] || ""} onChange={e => setSocioNames(p => ({ ...p, [s.id]: e.target.value }))} />
              <BtnS onClick={async () => {
                try {
                  await sb.from("socios").update({ name: socioNames[s.id] }).eq("id", s.id);
                  showToast(`"${socioNames[s.id]}" actualizado`);
                  await refresh();
                } catch (e) { alert("Error: " + e.message); }
              }}>Guardar</BtnS>
            </div>
          ))}
        </div>
        {socios.length === 0 && <div className="fb text-sm py-4 text-center" style={{ color: "var(--cd)" }}>No hay socios en la tabla.</div>}
      </Cd>

      {/* EXISTING USERS — only superuser */}
      {isSuperuser && <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-4">👤 Usuarios Registrados ({profiles.length})</h3>
        <div className="space-y-2">
          {profiles.map(p => {
            const ed = profileEdits[p.id] || { name: p.name, role: p.role };
            const changed = ed.name !== p.name || ed.role !== p.role;
            return (
              <div key={p.id} className="flex items-center gap-2 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.03)", border: changed ? "1px solid rgba(201,169,110,.3)" : "1px solid rgba(255,255,255,.06)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 fb text-xs font-bold" style={{ background: p.active ? "rgba(74,222,128,.15)" : "rgba(251,113,133,.15)", color: p.active ? "var(--gn)" : "var(--rd)" }}>
                  {(ed.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <input className="ti w-full" style={{ fontSize: 13 }} value={ed.name} placeholder="Nombre"
                    onChange={e => setProfileEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], name: e.target.value } }))} />
                  <div className="fb text-xs mt-0.5 truncate" style={{ color: "var(--cd)" }}>{p.email}</div>
                </div>
                <select className="ti" style={{ fontSize: 12, width: 130, padding: "6px 8px" }} value={ed.role}
                  onChange={e => setProfileEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], role: e.target.value } }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {changed && <BtnP onClick={async () => {
                  try {
                    await sb.from("profiles").update({ name: ed.name, role: ed.role }).eq("id", p.id);
                    showToast(`${ed.name} actualizado`);
                    await refresh();
                  } catch (e) { alert("Error: " + e.message); }
                }}>Guardar</BtnP>}
                {!changed && <div className="fb text-xs px-2" style={{ color: "var(--cd)", minWidth: 60 }}>{p.role}</div>}
                <button onClick={async () => {
                  if (p.id === currentUser?.id) return alert("No puedes eliminarte a ti mismo");
                  if (!confirm(`¿Eliminar usuario ${p.name} (${p.email})?\n\nEsta acción solo elimina el perfil de la app, no la cuenta de autenticación.`)) return;
                  try { await db.delProfile(p.id); showToast(`${p.name} eliminado`); await refresh(); } catch(e) { alert("Error: " + e.message); }
                }} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--rd)" }} title="Eliminar usuario">🗑</button>
                {p.id !== currentUser?.id && <button onClick={async () => {
                  if (!confirm(`¿Enviar link de reset de contraseña a ${p.email}?`)) return;
                  try {
                    const { error } = await sb.auth.resetPasswordForEmail(p.email, { redirectTo: window.location.origin });
                    if (error) throw error;
                    showToast(`Email de reset enviado a ${p.email}`);
                  } catch(e) { alert("Error: " + e.message); }
                }} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--bl)" }} title="Resetear contraseña">🔑</button>}
              </div>
            );
          })}
        </div>
      </Cd>}

      {/* CREATE NEW USER — only superuser */}
      {isSuperuser && <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-4">➕ Crear Nuevo Usuario</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Fl label="Email"><input className="ti" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="correo@ejemplo.com" /></Fl>
          <Fl label="Contraseña"><input className="ti" type="password" value={newUser.pass} onChange={e => setNewUser(p => ({ ...p, pass: e.target.value }))} placeholder="Mínimo 6 caracteres" /></Fl>
          <Fl label="Nombre"><input className="ti" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="Nombre completo" /></Fl>
        </div>
        <div className="flex gap-3 mt-3">
          <BtnP onClick={async () => {
            if (!newUser.email || !newUser.pass) return alert("Email y contraseña son obligatorios");
            if (newUser.pass.length < 6) return alert("Mínimo 6 caracteres");
            if (profiles.some(p => p.name === newUser.email || profileEdits[p.id]?.name === newUser.email)) return alert("Ese email ya tiene cuenta.");
            setCreating(true);
            try {
              const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
                body: JSON.stringify({ email: newUser.email, password: newUser.pass, name: newUser.name || newUser.email }),
              });
              const result = await res.json();
              if (result.error) throw new Error(result.error);
              showToast(`Usuario ${newUser.email} creado`);
              setNewUser({ email: "", pass: "", name: "" });
              await refresh();
            } catch (e) { alert("Error: " + e.message); }
            setCreating(false);
          }} disabled={creating}>{creating ? "Creando..." : "Crear Usuario"}</BtnP>
        </div>
      </Cd>}

      {/* WHATSAPP */}
      <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-4">WhatsApp del Catálogo</h3>
        <Fl label="Número (con código de país, ej: 5219991234567)" hint="Se usa para el botón de contacto en el catálogo público">
          <div className="flex gap-2">
            <input className="ti flex-1" value={waNum} onChange={e => setWaNum(e.target.value)} placeholder="5219991234567" />
            <BtnP onClick={async () => {
              if (!waNum) return;
              try {
                await db.saveSetting("whatsapp_number", JSON.stringify(waNum));
                showToast("WhatsApp actualizado");
                await refresh();
              } catch (e) { alert("Error: " + e.message); }
            }}>Guardar</BtnP>
          </div>
        </Fl>
      </Cd>

      {/* DOCS */}
      <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-4">Documentos Obligatorios</h3>
        <div className="fb text-sm" style={{ color: "var(--cd)" }}>
          Los documentos marcados como obligatorios se resaltan en rojo cuando no están subidos.
          Configura los requerimientos en la tabla <code>app_settings</code> → key: <code>required_docs</code>.
        </div>
      </Cd>

      {/* CATALOG URL */}
      <Cd className="p-5">
        <h3 className="fd font-semibold text-white mb-3">Catálogo Público</h3>
        <div className="fb text-sm" style={{ color: "var(--cd)" }}>
          URL: <a href="?catalog" target="_blank" className="hover:underline" style={{ color: "var(--gd)" }}>{window.location.origin}?catalog</a>
        </div>
        <div className="fb text-sm mt-2" style={{ color: "var(--cd)" }}>
          Para publicar una pieza, edítala y activa "Publicar en catálogo público".
        </div>
      </Cd>

      {/* AUDIT LOG — only superuser */}
      {isSuperuser && <AuditLogViewer />}
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
  const [activeInv, setActiveInv] = useState("ALL");
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  const [invSort, setInvSort] = useState({ col: "status", dir: "asc" });

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

  // v22: Investor model — profiles as bolsas
  const myProfile = useMemo(() => data ? (data.profiles || []).find(p => p.id === user?.id) : null, [data, user]);
  const investors = useMemo(() => data ? (data.profiles || []).filter(p => p.role === "inversionista" || p.role === "superuser") : [], [data]);
  const invInfo = useMemo(() => {
    const info = {};
    investors.forEach(p => { info[p.id] = { short: p.name, full: p.name, icon: p.role === "superuser" ? "👤" : "💼", color: "#C9A96E", participacion: Number(p.participacion) || 0, participacion_ops: Number(p.participacion_ops) || 0 }; });
    return info;
  }, [investors]);
  const myInvs = useMemo(() => {
    if (!myProfile || !data) return [];
    if (myProfile.role === "superuser") return investors.map(i => i.id);
    if (myProfile.role === "operador") return investors.map(i => i.id);
    return [myProfile.id]; // inversionista only sees own
  }, [myProfile, data, investors]);

  // Set default active investor
  useEffect(() => {
    if (myProfile && activeInv === "ALL") {
      if (myProfile.role === "superuser" || myProfile.role === "operador") setActiveInv("ALL");
      else setActiveInv(myProfile.id); // inversionista sees own
    }
  }, [myProfile]);

  const comp = useMemo(() => {
    if (!data) return {};
    const ps = data.pieces || [];
    const txs = data.txs || [];
    const af = activeInv;

    // v22: Filter by inversionista_id
    const fPs = af === "ALL" ? ps : ps.filter(p => p.inversionista_id === af);
    const fTxs = af === "ALL" ? txs : txs.filter(t => t.inversionista_id === af);

    const inv = fPs.filter(p => p.status === "Disponible");
    const sold = fPs.filter(p => p.status === "Vendido" || p.status === "Liquidado");
    const invC = inv.reduce((s, p) => s + (Number(p.cost) || 0), 0);
    let cash = fTxs.reduce((s, t) => s + (Number(t.monto) || 0), 0);

    const allCostos = data.costos || [];
    const gastosOf = (pid) => allCostos.filter(c => c.pieza_id === pid).reduce((s, c) => s + (Number(c.monto) || 0), 0);

    const rp = sold.reduce((s, p) => {
      const sellTx = fTxs.find(t => t.pieza_id === p.id && t.tipo === "SELL");
      if (!sellTx) return s;
      return s + ((sellTx.monto || 0) - (Number(p.cost) || 0) - gastosOf(p.id));
    }, 0);

    const cap = fTxs.filter(t => t.tipo === "CAPITAL").reduce((s, t) => s + (t.monto || 0), 0);
    const retCapital = Math.abs(fTxs.filter(t => t.tipo === "RETIRO_CAPITAL").reduce((s, t) => s + (t.monto || 0), 0));
    const distributions = retCapital;
    const capNeto = cap - retCapital;

    // v22: Splits from investor profile, not socios table
    const activeProfile = af !== "ALL" ? (data.profiles || []).find(p => p.id === af) : null;
    const invPart = activeProfile ? Number(activeProfile.participacion) || 0 : 0;
    const opsPart = activeProfile ? Number(activeProfile.participacion_ops) || 0 : 0;

    return {
      inv, sold, invC, cash, rp, cap, capNeto, retCapital, distributions, gastosOf,
      activeInvName: invInfo[af]?.short || "Todos",
      nav: cash + invC,
      moic: cap > 0 ? (cash + invC + distributions) / cap : 0,
      invPart, opsPart,
      splits: af === "ALL" ? [] : [
        { id: "inv", name: activeProfile?.name || "Inversionista", participacion: invPart, color: "#4ADE80", share: Math.round(rp * invPart / 100) },
        { id: "ops", name: "Operadores TWR", participacion: opsPart, color: "#C9A96E", share: Math.round(rp * opsPart / 100) },
      ],
    };
  }, [data, activeInv, invInfo]);

  const fp = useMemo(() => {
    if (!data) return [];
    const s = q.toLowerCase();
    const filtered = (data.pieces || []).filter(p => {
      if (activeInv !== "ALL" && p.inversionista_id !== activeInv) return false;
      return !s || (p.name || "").toLowerCase().includes(s) || (p.brand || "").toLowerCase().includes(s) || (p.sku || "").toLowerCase().includes(s) || (p.ref || "").toLowerCase().includes(s);
    });
    const statusOrder = { "Disponible": 0, "Vendido": 1, "Devuelto": 2, "Corregido": 3 };
    return filtered.sort((a, b) => {
      const c = invSort.col;
      let va, vb;
      if (c === "status") { va = statusOrder[a.status] ?? 9; vb = statusOrder[b.status] ?? 9; }
      else if (c === "cost" || c === "price_asked") { va = Number(a[c]) || 0; vb = Number(b[c]) || 0; }
      else if (c === "brand") { va = (a.brand || "").toLowerCase(); vb = (b.brand || "").toLowerCase(); }
      else if (c === "name") { va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase(); }
      else if (c === "sku") { va = a.sku || ""; vb = b.sku || ""; }
      else if (c === "entry_type") { va = a.entry_type || ""; vb = b.entry_type || ""; }
      else { va = a[c] ?? ""; vb = b[c] ?? ""; }
      if (va < vb) return invSort.dir === "asc" ? -1 : 1;
      if (va > vb) return invSort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, q, activeInv, invSort]);

  /* ═══ HANDLERS ═══ */
  const hAddPc = useCallback(async (p) => {
    try {
      const newCap = p._newCapital || 0;
      const pendingFotos = p._pendingFotos || [];
      const cleanP = { ...p }; delete cleanP._newCapital; delete cleanP._pendingFotos; delete cleanP.metodo_pago;
      // Trim text fields
      ["brand","model","ref","serial","name","sku","catalog_description","notes"].forEach(k => { if (typeof cleanP[k] === "string") cleanP[k] = cleanP[k].trim(); });
      // Clean FK fields (empty string → null)
      ["supplier_id","ref_id","socio_aporta_id","client_id","validated_by","exit_fund","trade_ref","devolucion_de"].forEach(k => { if (cleanP[k] === "" || cleanP[k] === undefined) cleanP[k] = null; });
      // Force numeric on money fields
      ["cost","price_dealer","price_asked","price_trade","referenciada_comision"].forEach(k => { cleanP[k] = Number(cleanP[k]) || 0; });
      const payMethod = p.metodo_pago || "Efectivo MXN";
      const targetInv = cleanP.inversionista_id || (activeInv !== "ALL" && activeInv?.length > 10 ? activeInv : null) || user?.id;
      cleanP.inversionista_id = targetInv;
      if (!cleanP.fondo_id || cleanP.fondo_id === "NA") cleanP.fondo_id = "FIC";

      // Cash validation (warning, not blocking)
      if (newCap === 0 && cleanP.entry_type !== "trade_in" && cleanP.cost > 0) {
        const txs = data?.txs || [];
        const currentCash = txs.reduce((s, t) => (t.inversionista_id === targetInv || t.fondo_id === targetInv) ? s + (Number(t.monto) || 0) : s, 0);
        if (cleanP.cost > currentCash && !confirm(`⚠️ El fondo tiene ${fmxn(currentCash)} pero la pieza cuesta ${fmxn(cleanP.cost)}.\n\nEsto dejará el cash en negativo (${fmxn(currentCash - cleanP.cost)}).\n\n¿Continuar de todos modos?`)) return;
      }

      // Nueva Aportación: register full cost as capital
      if (newCap > 0) {
        await db.saveTx({ id: uid(), fecha: cleanP.entry_date, tipo: "CAPITAL", monto: newCap, fondo_id: cleanP.fondo_id, inversionista_id: targetInv, descripcion: `Nueva aportación para ${cleanP.name}`, metodo_pago: payMethod, partner_id: user?.id });
      }

      // Save piece FIRST (so FK constraint is satisfied)
      await db.savePiece(cleanP);

      // Now save pending photos (piece exists in DB)
      for (const foto of pendingFotos) {
        try { await db.saveFoto({ pieza_id: foto.pieza_id, posicion: foto.posicion, url: foto.url, storage_path: foto.storage_path }); }
        catch (fe) { console.error("Foto save error:", fe); }
      }

      await db.saveTx({ id: uid(), fecha: cleanP.entry_date, tipo: cleanP.entry_type === "trade_in" ? "TRADE" : "BUY", pieza_id: cleanP.id, monto: cleanP.entry_type === "trade_in" ? 0 : -(Number(cleanP.cost) || 0), fondo_id: cleanP.fondo_id, inversionista_id: targetInv, descripcion: `${etLabel(cleanP.entry_type)} — ${cleanP.name}`, metodo_pago: cleanP.entry_type === "trade_in" ? "Trade" : payMethod });
      showToast(`${cleanP.name} registrada${pendingFotos.length ? ` con ${pendingFotos.length} foto(s)` : ""}`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, user]);

  const hUpdPc = useCallback(async (p) => {
    try {
      const newCap = p._newCapital || 0;
      const cleanP = { ...p }; delete cleanP._newCapital; delete cleanP._pendingFotos; delete cleanP.metodo_pago;
      ["brand","model","ref","serial","name","sku","catalog_description","notes"].forEach(k => { if (typeof cleanP[k] === "string") cleanP[k] = cleanP[k].trim(); });
      ["supplier_id","ref_id","socio_aporta_id","client_id","validated_by","exit_fund","trade_ref","devolucion_de"].forEach(k => { if (cleanP[k] === "" || cleanP[k] === undefined) cleanP[k] = null; });
      ["cost","price_dealer","price_asked","price_trade","referenciada_comision"].forEach(k => { cleanP[k] = Number(cleanP[k]) || 0; });
      const invId = cleanP.inversionista_id || user?.id;
      cleanP.inversionista_id = invId;
      // Track edits
      const old = data?.pieces?.find(op => op.id === cleanP.id);
      if (old) {
        const trackFields = ["name","brand","model","ref","serial","cost","price_asked","price_dealer","price_trade","status","condition","fondo_id","notes","publish_catalog"];
        const edits = trackFields.filter(k => String(old[k] ?? "") !== String(cleanP[k] ?? "")).map(k => ({ id: crypto.randomUUID(), pieza_id: cleanP.id, campo: k, valor_antes: String(old[k] ?? ""), valor_despues: String(cleanP[k] ?? ""), editado_por: user?.email || "unknown" }));
        for (const e of edits) { try { await sb.from("pieza_edits").insert(e); } catch(ee) { console.warn("Edit track err:", ee); } }
      }
      // v22: If cost changed from 0 to >0, fix the BUY tx and optionally add CAPITAL
      if (old && (Number(old.cost) || 0) === 0 && cleanP.cost > 0) {
        const existingBuy = (data?.txs || []).find(t => t.pieza_id === cleanP.id && t.tipo === "BUY");
        if (existingBuy && Number(existingBuy.monto) === 0) {
          // Update BUY to reflect actual cost
          await sb.from("transacciones").update({ monto: -(cleanP.cost), inversionista_id: invId }).eq("id", existingBuy.id);
        }
        // If "Nueva Aportación" selected, create CAPITAL tx
        if (newCap > 0) {
          await db.saveTx({ id: uid(), fecha: cleanP.entry_date || td(), tipo: "CAPITAL", monto: cleanP.cost, fondo_id: "FIC", inversionista_id: invId, descripcion: `Nueva aportación para ${cleanP.name}`, metodo_pago: p.metodo_pago || "Efectivo MXN", partner_id: user?.id });
        }
      }
      await db.savePiece(cleanP); showToast("Pieza actualizada"); await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data, user]);

  const hSell = useCallback(async (p) => {
    try {
      const cost = p.cost || 0;

      // ═══ TRADE OUT (from SellForm) ═══
      if (p.exit_type === "trade_out") {
        const incoming = p._tradeIncoming || [];
        const cashOut_ = p._cashOut || 0;
        const cashIn_ = p._cashIn || 0;
        const trRef = "TR-" + Date.now().toString(36).slice(-5).toUpperCase();
        const fondo = p.fondo_id || "FIC";
        const invId = p.inversionista_id;

        // Mark piece as traded out
        await db.savePiece({ id: p.id, status: "Vendido", stage: "liquidado", exit_type: "trade_out", trade_ref: trRef, client_id: p.client_id || null });

        // Create incoming pieces (track created for unique SKU)
        const created = [...(data.pieces || [])];
        for (const item of incoming) {
          const np = { id: uid(), sku: genSku(created), name: [item.brand, item.model].filter(Boolean).join(" "), brand: item.brand, model: item.model, ref: item.ref, condition: "Excelente", auth_level: "VISUAL", fondo_id: fondo, inversionista_id: invId, entry_type: "trade_in", entry_date: p.xDate, cost: Number(item.value) || 0, ...calcPr(Number(item.value) || 0), status: "Disponible", stage: "inventario", notes: `Trade ${trRef} ← ${p.sku || ""} (${p.name || ""} ref ${p.ref || ""})`.trim(), trade_ref: trRef };
          created.push(np);
          await db.savePiece(np);
        }

        // Trade transaction (no profit)
        const desc = `Trade ${trRef}: ${p.name} → ${incoming.map(i => [i.brand, i.model].filter(Boolean).join(" ")).join(" + ")}`;
        await db.saveTx({ id: uid(), fecha: p.xDate, tipo: "TRADE", pieza_id: p.id, monto: 0, fondo_id: fondo, inversionista_id: invId, descripcion: desc, metodo_pago: "Trade", trade_ref: trRef });

        if (cashOut_ > 0) await db.saveTx({ id: uid(), fecha: p.xDate, tipo: "TRADE", pieza_id: p.id, monto: -(cashOut_), fondo_id: fondo, inversionista_id: invId, descripcion: `${trRef} — Diferencia pagada (sale del fondo)`, metodo_pago: "Trade+Cash", trade_ref: trRef });
        if (cashIn_ > 0) await db.saveTx({ id: uid(), fecha: p.xDate, tipo: "TRADE", pieza_id: p.id, monto: cashIn_, fondo_id: fondo, inversionista_id: invId, descripcion: `${trRef} — Diferencia recibida (entra al fondo)`, metodo_pago: "Trade+Cash", trade_ref: trRef });

        showToast(`Trade registrado: ${p.name} → ${incoming.length} pieza(s)`);
        await refresh(); cm();
        return;
      }

      // ═══ REGULAR SALE ═══
      const allCostos = data.costos || [];
      const gastosPieza = allCostos.filter(cx => cx.pieza_id === p.id).reduce((s, cx) => s + (Number(cx.monto) || 0), 0);
      const costoReal = cost + gastosPieza;
      const profit = p.xPrice - costoReal;
      await db.savePiece({ id: p.id, status: "Vendido", stage: "liquidado", exit_type: p.xType, exit_fund: p.xFund, client_id: p.client_id || null });
      await db.saveTx({ id: uid(), fecha: p.xDate, tipo: "SELL", pieza_id: p.id, monto: p.xPrice, fondo_id: p.xFund, inversionista_id: p.inversionista_id, descripcion: `Venta ${p.name} (Costo: ${fmxn(cost)}${gastosPieza > 0 ? ` + Gastos: ${fmxn(gastosPieza)}` : ""}, Utilidad: ${fmxn(profit)})`, metodo_pago: p.payOut });
      showToast(`Venta registrada: ${p.name} — Utilidad Real: ${fmxn(profit)}`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data]);

  const hTrade = useCallback(async (td_) => {
    try {
      const { outPieces, incoming, cashOut, cashIn, date } = td_;
      const trRef = "TR-" + Date.now().toString(36).slice(-5).toUpperCase();
      const fondo = outPieces[0].fondo_id || "FIC";
      const invId = outPieces[0].inversionista_id;

      // Mark outgoing pieces as traded out
      for (const op of outPieces) {
        await db.savePiece({ id: op.id, status: "Vendido", stage: "liquidado", exit_type: "trade_out", trade_ref: trRef });
      }
      // Create incoming pieces
      const created = [...(data.pieces || [])];
      for (const item of incoming) {
        const outDesc = outPieces.map(op => `${op.sku || ""} (${op.name || ""} ref ${op.ref || ""})`).join(" + ");
        const np = { id: uid(), sku: genSku(created), name: [item.brand, item.model].filter(Boolean).join(" "), brand: item.brand, model: item.model, ref: item.ref, condition: "Excelente", auth_level: "VISUAL", fondo_id: fondo, inversionista_id: invId, entry_type: "trade_in", entry_date: date, cost: Number(item.value) || 0, ...calcPr(Number(item.value) || 0), status: "Disponible", stage: "inventario", notes: `Trade ${trRef} ← ${outDesc}`.trim(), trade_ref: trRef };
        created.push(np);
        await db.savePiece(np);
      }

      // Register trade transaction (no profit — just a swap)
      const desc = `Trade ${trRef}: ${outPieces.map(p => p.name).join(" + ")} → ${incoming.map(i => [i.brand, i.model].filter(Boolean).join(" ")).join(" + ")}`;
      await db.saveTx({ id: uid(), fecha: date, tipo: "TRADE", pieza_id: outPieces[0].id, monto: 0, fondo_id: fondo, inversionista_id: invId, descripcion: desc, metodo_pago: "Trade", trade_ref: trRef });

      // Cash OUT from FIC (we paid difference)
      if (cashOut > 0) {
        await db.saveTx({ id: uid(), fecha: date, tipo: "TRADE", pieza_id: outPieces[0].id, monto: -(cashOut), fondo_id: fondo, inversionista_id: invId, descripcion: `${trRef} — Diferencia pagada (sale del fondo)`, metodo_pago: "Trade+Cash", trade_ref: trRef });
      }
      // Cash IN to FIC (we received difference)
      if (cashIn > 0) {
        await db.saveTx({ id: uid(), fecha: date, tipo: "TRADE", pieza_id: outPieces[0].id, monto: cashIn, fondo_id: fondo, inversionista_id: invId, descripcion: `${trRef} — Diferencia recibida (entra al fondo)`, metodo_pago: "Trade+Cash", trade_ref: trRef });
      }

      showToast(`Trade ${trRef} registrado`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data]);

  const hCap = useCallback(async (amt, desc, partner, fund, fecha) => {
    try {
      const targetFund = fund || (activeInv !== "ALL" && activeInv?.length > 10 ? activeInv : "FIC");
      const invId = targetFund?.length > 10 ? targetFund : user?.id;
      await db.saveTx({ id: uid(), fecha: fecha || td(), tipo: "CAPITAL", monto: amt, fondo_id: "FIC", inversionista_id: invId, descripcion: desc || "Inyección de capital", metodo_pago: "Efectivo MXN", partner_id: partner });
      showToast(`Capital registrado`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, activeInv, invInfo]);

  const hRetiro = useCallback(async (amt, desc, partner, fund, motivo, fecha) => {
    try {
      const tf = fund || (activeInv !== "ALL" && activeInv?.length > 10 ? activeInv : null);
      const invId = tf?.length > 10 ? tf : user?.id;
      const fc = (data?.txs || []).reduce((s, t) => (t.inversionista_id === invId || t.fondo_id === invId) ? s + (Number(t.monto) || 0) : s, 0);
      if (amt > fc && !confirm(`⚠️ Cash: ${fmxn(fc)}, retiro: ${fmxn(amt)}. ¿Continuar?`)) return;
      const lb = motivo === "venta" ? "Retiro al vender" : motivo === "total" ? "Retiro total" : "Retiro parcial";
      await db.saveTx({ id: uid(), fecha: fecha || td(), tipo: "RETIRO_CAPITAL", monto: -(amt), fondo_id: "FIC", inversionista_id: invId, descripcion: desc || lb, metodo_pago: "Efectivo MXN", partner_id: partner });
      showToast(`Retiro registrado`); await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, activeInv, data]);

  const hCancelRetiro = useCallback(async (tx) => {
    if (!confirm(`¿Cancelar retiro?\n${tx.descripcion}\n${fmxn(Math.abs(tx.monto))}`)) return;
    try { await db.saveTx({ id: uid(), fecha: td(), tipo: "CANCEL_RETIRO", monto: Math.abs(tx.monto), fondo_id: tx.fondo_id, descripcion: `↩ Cancelación: ${tx.descripcion} (ref: ${tx.id})`, metodo_pago: "Reversión", partner_id: tx.partner_id }); showToast("Retiro cancelado"); await refresh(); } catch (e) { alert("Error: " + e.message); }
  }, [refresh]);

  const hCancelCorte = useCallback(async (corte) => {
    if (!confirm(`¿Cancelar corte ${corte.periodo}? Se revertirán ${fmxn(corte.utilidad)}`)) return;
    try {
      for (const tx of (data?.txs || []).filter(t => t.tipo === "RETIRO" && (t.descripcion || "").includes(corte.periodo))) {
        if (!(data?.txs || []).some(ct => ct.tipo === "CANCEL_RETIRO" && (ct.descripcion || "").includes(tx.id)))
          await db.saveTx({ id: uid(), fecha: td(), tipo: "CANCEL_RETIRO", monto: Math.abs(tx.monto), fondo_id: tx.fondo_id, descripcion: `↩ Cancel corte ${corte.periodo}: ${tx.descripcion} (ref: ${tx.id})`, metodo_pago: "Reversión", partner_id: tx.partner_id });
      }
      await sb.from("cortes").update({ decision: "cancelado" }).eq("id", corte.id);
      showToast(`Corte cancelado`); await refresh();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, data]);

  const hDevolucion = useCallback(async (piece) => {
    const isTr = piece.exit_type === "trade_out", tr = piece.trade_ref, txs = data?.txs || [], ap = data?.pieces || [];
    let d = `¿Devolver "${piece.name}" (${piece.sku})?\n\n`;
    if (isTr && tr) { ap.filter(p => p.trade_ref === tr && p.entry_type === "trade_in" && p.id !== piece.id).forEach(p => { d += `• "${p.name}" → Devuelto\n`; }); const cr = txs.filter(t => t.trade_ref === tr && t.monto > 0 && t.tipo === "TRADE").reduce((s, t) => s + t.monto, 0); if (cr > 0) d += `• ${fmxn(cr)} sale del fondo\n`; }
    else { const st = txs.find(t => t.pieza_id === piece.id && t.tipo === "SELL"); if (st) d += `• ${fmxn(st.monto)} sale del fondo\n`; }
    if (!confirm(d)) return;
    try {
      if (isTr && tr) {
        await db.savePiece({ id: piece.id, status: "Disponible", stage: "inventario", exit_type: null, exit_fund: null });
        for (const ip of ap.filter(p => p.trade_ref === tr && p.entry_type === "trade_in" && p.id !== piece.id && p.status === "Disponible")) await db.savePiece({ id: ip.id, status: "Devuelto", stage: "cancelado" });
        for (const tx of txs.filter(t => t.trade_ref === tr && t.tipo === "TRADE" && t.monto !== 0)) await db.saveTx({ id: uid(), fecha: td(), tipo: "DEVOLUCION", pieza_id: piece.id, monto: -(tx.monto), fondo_id: tx.fondo_id, descripcion: `↩ Devol ${tr}: ${tx.descripcion} (ref: ${tx.id})`, metodo_pago: "Reversión", trade_ref: tr });
        await db.saveTx({ id: uid(), fecha: td(), tipo: "DEVOLUCION", pieza_id: piece.id, monto: 0, fondo_id: piece.fondo_id, descripcion: `↩ ${tr}: ${piece.name} regresa`, metodo_pago: "Devolución", trade_ref: tr });
      } else {
        await db.savePiece({ id: piece.id, status: "Disponible", stage: "inventario", exit_type: null, exit_fund: null });
        const st = txs.find(t => t.pieza_id === piece.id && t.tipo === "SELL");
        if (st) await db.saveTx({ id: uid(), fecha: td(), tipo: "DEVOLUCION", pieza_id: piece.id, monto: -(st.monto), fondo_id: st.fondo_id, descripcion: `↩ Devol venta: ${piece.name} (ref: ${st.id})`, metodo_pago: "Reversión" });
      }
      showToast(`${piece.name} devuelto a inventario`); 
      await refresh();
      // Open post-devolution action panel instead of closing
      const updatedPiece = { ...piece, status: "Disponible", stage: "inventario", exit_type: null, exit_fund: null };
      setSel(updatedPiece);
      setModal("post_dev");
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data]);

  const hCorregir = useCallback(async (piece) => {
    const txs = data?.txs || [];
    const pieceTxs = txs.filter(t => t.pieza_id === piece.id);
    const tradeTxs = piece.trade_ref ? txs.filter(t => t.trade_ref === piece.trade_ref) : [];
    const allRelated = [...new Map([...pieceTxs, ...tradeTxs].map(t => [t.id, t])).values()];
    const nonZero = allRelated.filter(t => t.monto !== 0 && t.tipo !== "CORRECCION");
    const netEffect = allRelated.reduce((s, t) => s + (t.monto || 0), 0);

    let desc = `¿Corregir "${piece.name}" (${piece.sku})?\n\n`;
    desc += `Esta acción NO borra nada — marca la pieza como "Corregido" y crea transacciones inversas.\n\n`;
    desc += `Se revertirán ${nonZero.length} transacción(es):\n`;
    nonZero.forEach(t => { desc += `  • ${t.tipo} ${t.monto >= 0 ? "+" : ""}${fmxn(t.monto)} — ${(t.descripcion || "").slice(0, 50)}\n`; });
    if (netEffect !== 0) desc += `\nEfecto neto en cash: ${netEffect > 0 ? "-" : "+"}${fmxn(Math.abs(netEffect))}`;

    if (!confirm(desc)) return;
    try {
      // Create reversal for each non-zero transaction
      for (const tx of nonZero) {
        // Skip if already corrected
        const alreadyCorrected = txs.some(ct => ct.tipo === "CORRECCION" && (ct.descripcion || "").includes(tx.id));
        if (alreadyCorrected) continue;
        await db.saveTx({
          id: uid(), fecha: td(), tipo: "CORRECCION", pieza_id: piece.id,
          monto: -(tx.monto), fondo_id: tx.fondo_id,
          descripcion: `⊘ Corrección: ${tx.descripcion || tx.tipo} (ref: ${tx.id})`,
          metodo_pago: "Corrección", trade_ref: tx.trade_ref || null
        });
      }
      // Mark piece as Corregido
      await db.savePiece({ id: piece.id, status: "Corregido", stage: "corregido" });
      // If trade, also mark related trade_in pieces as Corregido
      if (piece.trade_ref) {
        const relatedPieces = (data?.pieces || []).filter(p => p.trade_ref === piece.trade_ref && p.id !== piece.id && p.entry_type === "trade_in");
        for (const rp of relatedPieces) {
          if (rp.status !== "Corregido" && rp.status !== "Vendido") {
            await db.savePiece({ id: rp.id, status: "Corregido", stage: "corregido" });
          }
        }
      }
      showToast(`"${piece.name}" marcada como Corregido`);
      await refresh(); cm();
    } catch (e) { alert("Error: " + e.message); }
  }, [refresh, cm, data]);

  const logout = async () => { await sb.auth.signOut(); setUser(null); setData(null); };

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--nv)" }}><div className="fd text-2xl font-bold text-white animate-pulse">W</div></div>;
  if (!user) return <LoginScreen onLogin={u => { setUser(u); loadData(); }} />;
  if (!data) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--nv)" }}><div className="fd text-xl text-white">Cargando datos...</div></div>;

  // Check if user is pending activation
  if (myProfile?.role === "pending" || myProfile?.active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(145deg,#060E1A,var(--nv),#0A1525)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">⏳</div>
          <div className="fd text-xl font-bold text-white mb-2">Cuenta Pendiente</div>
          <div className="fb text-sm mb-6" style={{ color: "var(--cd)" }}>Tu cuenta ha sido creada pero un administrador debe activarla antes de que puedas acceder al sistema.</div>
          <div className="fb text-xs mb-6 p-3 rounded-xl" style={{ background: "rgba(201,169,110,.06)", color: "var(--gd)", border: "1px solid rgba(201,169,110,.1)" }}>{user.email}</div>
          <BtnS onClick={logout}>Cerrar Sesión</BtnS>
        </div>
      </div>
    );
  }

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
          {side && <div className="fb text-center text-xs mt-1" style={{ color: "rgba(245,240,232,.2)" }}>TWR OS v22</div>}
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
              <div className="flex gap-2"><BtnP onClick={() => setModal("ap")}><span className="flex items-center gap-1.5"><Ico d={IC.plus} s={14} />Pieza</span></BtnP><BtnS onClick={() => setModal("ac")}>+ Capital</BtnS><BtnS onClick={() => setModal("rc")}>↑ Retiro</BtnS></div>
            </div>

            {/* Fund Tabs */}
            {myInvs.length > 1 && (
              <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgba(255,255,255,.03)" }}>
                {myProfile?.role === "superuser" && (
                  <button onClick={() => setActiveInv("ALL")} className="fb text-xs font-semibold px-4 py-2 rounded-lg transition-all whitespace-nowrap"
                    style={activeInv === "ALL" ? { background: "rgba(201,169,110,.15)", color: "var(--cr)" } : { color: "var(--cd)" }}>
                    📊 Todos
                  </button>
                )}
                {myInvs.map(fk => (
                  <button key={fk} onClick={() => setActiveInv(fk)} className="fb text-xs font-semibold px-4 py-2 rounded-lg transition-all whitespace-nowrap"
                    style={activeInv === fk ? { background: "rgba(201,169,110,.15)", color: "var(--cr)" } : { color: "var(--cd)" }}>
                    {invInfo[fk]?.icon || "🏦"} {invInfo[fk]?.short || fk}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const nav = comp.cash + comp.invC;
              const ganancia = nav - comp.capNeto;
              const pctGanancia = comp.capNeto > 0 ? ((ganancia / comp.capNeto) * 100).toFixed(1) : "0";
              // Find user's split
              const mySplit = comp.isPersonal ? 100 : (comp.socios?.find(s => s.id === user?.id)?.participacion || (myProfile?.role === "superuser" ? 40 : 0));
              const myGanancia = Math.round(ganancia * mySplit / 100);
              return <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Cd className="p-4 md:p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("transactions")}><div className="fb text-xs font-medium uppercase tracking-widest" style={{ color: "var(--cd)" }}>Valor del Fondo</div><div className="fd text-xl md:text-2xl font-bold mt-1 text-white">{fmxn(nav)}</div><div className="fb text-xs mt-1" style={{ color: "var(--bl)" }}>Cash {fmxn(comp.cash)} · Piezas {fmxn(comp.invC)}</div></Cd>
                <Cd className="p-4 md:p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("transactions")}><div className="fb text-xs font-medium uppercase tracking-widest" style={{ color: "var(--cd)" }}>Inversión Neta</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{ color: "var(--bl)" }}>{fmxn(comp.capNeto)}</div><div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>{fmxn(comp.cap)} invertido{comp.retCapital > 0 ? ` · ${fmxn(comp.retCapital)} retirado` : ""}</div></Cd>
                <Cd className="p-4 md:p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("cortes")}><div className="fb text-xs font-medium uppercase tracking-widest" style={{ color: "var(--cd)" }}>Ganancia</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{ color: ganancia >= 0 ? "var(--gn)" : "var(--rd)" }}>{ganancia >= 0 ? "+" : ""}{fmxn(ganancia)}</div><div className="fb text-xs mt-1" style={{ color: ganancia >= 0 ? "var(--gn)" : "var(--rd)" }}>{ganancia >= 0 ? "+" : ""}{pctGanancia}% sobre inversión</div></Cd>
                <Cd className="p-4 md:p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("cortes")}><div className="fb text-xs font-medium uppercase tracking-widest" style={{ color: "var(--cd)" }}>{comp.isPersonal ? "Tu Ganancia" : `Tu Parte ${mySplit}%`}</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{ color: myGanancia >= 0 ? "var(--gn)" : "var(--rd)" }}>{myGanancia >= 0 ? "+" : ""}{fmxn(myGanancia)}</div><div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>{comp.rp !== ganancia ? `${fmxn(comp.rp)} realizada en ventas` : "de ventas directas"}</div></Cd>
                <Cd className="p-4 md:p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("transactions")}><div className="fb text-xs font-medium uppercase tracking-widest" style={{ color: "var(--cd)" }}>MOIC</div><div className="fd text-xl md:text-2xl font-bold mt-1" style={{ color: comp.moic >= 1 ? "var(--gn)" : "var(--pr)" }}>{(comp.moic || 0).toFixed(2)}x</div><div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>{comp.inv?.length || 0} pieza{(comp.inv?.length || 0) !== 1 ? "s" : ""} · {comp.sold?.length || 0} vendida{(comp.sold?.length || 0) !== 1 ? "s" : ""}</div></Cd>
              </div>

              {/* Cash vs Inventory breakdown bar */}
              {nav > 0 && <div className="rounded-xl overflow-hidden" style={{ height: 6 }}>
                <div className="h-full flex">
                  <div style={{ width: `${(comp.cash / nav * 100).toFixed(1)}%`, background: "var(--bl)" }} />
                  <div style={{ width: `${(comp.invC / nav * 100).toFixed(1)}%`, background: "var(--gd)" }} />
                </div>
              </div>}
              </>;
            })()}
            {comp.rp !== 0 && (
              <div className="rounded-xl p-4 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("cortes")} style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.1)" }}>
                <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gn)" }}>{comp.isPersonal ? "Utilidad de tu Fondo Personal" : "Distribución de Utilidad (solo ventas directas)"}</div>
                <div className={`grid gap-3 text-center`} style={{ gridTemplateColumns: `repeat(${(comp.splits?.length || 0) + 1}, 1fr)` }}>
                  {(comp.splits || []).map(s => (
                    <div key={s.id} className="rounded-xl p-3" style={{ background: `${s.color}11` }}>
                      <div className="fb text-xs" style={{ color: s.color }}>{s.name} {s.participacion}%</div>
                      <div className="fd font-bold text-lg text-white">{fmxn(s.share)}</div>
                      {comp.cap > 0 && <div className="fb text-xs mt-0.5" style={{ color: "var(--cd)" }}>{((s.share / comp.cap) * 100).toFixed(1)}% s/capital</div>}
                    </div>
                  ))}
                  <div className="rounded-xl p-3" style={{ background: "rgba(201,169,110,.06)" }}>
                    <div className="fb text-xs" style={{ color: "var(--gd)" }}>Total</div>
                    <div className="fd font-bold text-lg" style={{ color: comp.rp >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(comp.rp)}</div>
                    {comp.cap > 0 && <div className="fb text-xs mt-0.5" style={{ color: "var(--cd)" }}>{((comp.rp / comp.cap) * 100).toFixed(1)}% s/capital</div>}
                  </div>
                </div>
              </div>
            )}
            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Donut: Cash vs Inventory */}
              {(() => {
                const total = (comp.cash || 0) + (comp.invC || 0);
                if (total <= 0) return null;
                const cashPct = comp.cash / total;
                const invPct = comp.invC / total;
                const r = 60, cx = 80, cy = 80, sw = 18;
                const cashAngle = cashPct * 360;
                const toRad = d => d * Math.PI / 180;
                const x1 = cx + r * Math.sin(toRad(cashAngle));
                const y1 = cy - r * Math.cos(toRad(cashAngle));
                const lg = cashAngle > 180 ? 1 : 0;
                return (
                  <Cd className="p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("inventory")}>
                    <div className="fb text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "var(--gd)" }}>Composición del Fondo</div>
                    <div className="flex items-center gap-6">
                      <svg viewBox="0 0 160 160" className="w-32 h-32 shrink-0">
                        {cashPct >= 1 ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bl)" strokeWidth={sw} /> :
                         invPct >= 1 ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--gd)" strokeWidth={sw} /> : <>
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--gd)" strokeWidth={sw} />
                          <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${lg} 1 ${x1} ${y1}`} fill="none" stroke="var(--bl)" strokeWidth={sw} strokeLinecap="round" />
                        </>}
                        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" className="fd" fontSize="18" fontWeight="700">{fmxn(total)}</text>
                        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--cd)" className="fb" fontSize="10">NAV Total</text>
                      </svg>
                      <div className="space-y-3 flex-1">
                        <div>
                          <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 rounded-full" style={{ background: "var(--bl)" }} /><span className="fb text-xs" style={{ color: "var(--cd)" }}>Cash en Fondo</span></div>
                          <div className="fd font-bold text-white">{fmxn(comp.cash)}</div>
                          <div className="fb text-xs" style={{ color: "var(--bl)" }}>{(cashPct * 100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 rounded-full" style={{ background: "var(--gd)" }} /><span className="fb text-xs" style={{ color: "var(--cd)" }}>Inventario (Costo)</span></div>
                          <div className="fd font-bold text-white">{fmxn(comp.invC)}</div>
                          <div className="fb text-xs" style={{ color: "var(--gd)" }}>{(invPct * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  </Cd>
                );
              })()}

              {/* Bar chart: sales profit per piece */}
              {(() => {
                const soldPieces = (comp.sold || []).map(p => {
                  const sellTx = (data.txs || []).find(t => t.pieza_id === p.id && t.tipo === "SELL");
                  if (!sellTx) return null;
                  return { name: p.name?.split(" ").slice(0, 2).join(" ") || "?", profit: (sellTx.monto || 0) - (p.cost || 0) - (comp.gastosOf?.(p.id) || 0), gastos: comp.gastosOf?.(p.id) || 0, cost: p.cost || 0, sale: sellTx.monto || 0 };
                }).filter(Boolean);
                if (soldPieces.length === 0) return (
                  <Cd className="p-5 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-3xl mb-2">📊</div>
                      <div className="fb text-sm" style={{ color: "var(--cd)" }}>Gráfico de utilidades aparecerá con la primera venta</div>
                    </div>
                  </Cd>
                );
                const maxVal = Math.max(...soldPieces.map(s => Math.abs(s.profit)), 1);
                return (
                  <Cd className="p-5 cursor-pointer hover:brightness-110 transition-all" onClick={() => setPage("transactions")}>
                    <div className="fb text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "var(--gn)" }}>Utilidad por Pieza Vendida</div>
                    <div className="space-y-2">
                      {soldPieces.map((s, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="fb text-xs text-white truncate" style={{ width: 80 }}>{s.name}</div>
                          <div className="flex-1 h-6 rounded-lg overflow-hidden relative" style={{ background: "rgba(255,255,255,.04)" }}>
                            <div className="h-full rounded-lg transition-all" style={{ width: `${Math.max(5, (Math.abs(s.profit) / maxVal) * 100)}%`, background: s.profit >= 0 ? "rgba(74,222,128,.3)" : "rgba(251,113,133,.3)" }} />
                            <div className="absolute inset-0 flex items-center px-2"><span className="fb text-xs font-bold" style={{ color: s.profit >= 0 ? "var(--gn)" : "var(--rd)" }}>{s.profit >= 0 ? "+" : ""}{fmxn(s.profit)}</span></div>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2 mt-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        <div className="fb text-xs font-bold" style={{ width: 80, color: "var(--gd)" }}>Total</div>
                        <div className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(soldPieces.reduce((s, p) => s + p.profit, 0))}</div>
                      </div>
                    </div>
                  </Cd>
                );
              })()}
            </div>
            <Cd>
              <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                <h3 className="fd font-semibold text-white cursor-pointer hover:text-[var(--gd)] transition-colors" onClick={() => setPage("inventory")}>Inventario Activo ({comp.inv?.length || 0})</h3>
                <button className="fb text-xs" style={{ color: "var(--gd)" }} onClick={() => setPage("inventory")}>Ver todo →</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full"><thead><tr><TH>Pieza</TH><TH>Origen</TH><TH r>Costo</TH><TH r>Lista</TH><TH>Status</TH></tr></thead>
                  <tbody>{(comp.inv || []).slice(0, 10).map(p => <tr key={p.id} className="hover:bg-white/[.02] cursor-pointer" onClick={() => { setSel(p); setModal("ep"); }}><TD b>{p.name}</TD><TD><Bd text={invInfo[p.fondo_id]?.short || p.fondo_id} v="gold" /></TD><TD r>{fmxn(p.cost)}</TD><TD r a="var(--gd)">{fmxn(p.price_asked)}</TD><TD><Bd text={p.status} v="green" /></TD></tr>)}</tbody>
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
            {/* Investor tabs */}
            {myInvs.length > 1 && (
              <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgba(255,255,255,.03)" }}>
                {myProfile?.role === "superuser" && <button onClick={() => setActiveInv("ALL")} className="fb text-xs font-semibold px-3 py-2 rounded-lg" style={activeInv === "ALL" ? { background: "rgba(201,169,110,.15)", color: "var(--cr)" } : { color: "var(--cd)" }}>Todos</button>}
                {myInvs.map(fk => <button key={fk} onClick={() => setActiveInv(fk)} className="fb text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap" style={activeInv === fk ? { background: "rgba(201,169,110,.15)", color: "var(--cr)" } : { color: "var(--cd)" }}>{invInfo[fk]?.icon} {invInfo[fk]?.short || fk}</button>)}
              </div>
            )}
            <div className="relative"><div className="absolute left-3 top-3" style={{ color: "var(--cd)" }}><Ico d={IC.srch} s={16} /></div><input className="ti" style={{ paddingLeft: 36 }} placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} /></div>
            <div className="flex gap-2 flex-wrap">
              <span className="fb text-xs py-1" style={{ color: "var(--cd)" }}>Ordenar:</span>
              {[
                { col: "status", label: "Status" },
                { col: "cost", label: "Precio" },
                { col: "brand", label: "Marca" },
                { col: "name", label: "Nombre" },
                { col: "sku", label: "SKU" },
              ].map(s => <button key={s.col} onClick={() => setInvSort(prev => ({ col: s.col, dir: prev.col === s.col && prev.dir === "asc" ? "desc" : "asc" }))} className="fb text-xs px-3 py-1 rounded-full transition-all" style={{ background: invSort.col === s.col ? "rgba(201,169,110,.15)" : "rgba(255,255,255,.04)", color: invSort.col === s.col ? "var(--gd)" : "var(--cd)", border: invSort.col === s.col ? "1px solid rgba(201,169,110,.25)" : "1px solid rgba(255,255,255,.06)" }}>{s.label} {invSort.col === s.col ? (invSort.dir === "asc" ? "↑" : "↓") : ""}</button>)}
            </div>
            <Cd>
              <div className="overflow-x-auto">
                <table className="w-full"><thead><tr>{[
                  { col: "sku", label: "SKU" },
                  { col: "name", label: "Pieza" },
                  { col: "entry_type", label: "Motivo" },
                  { col: "fondo_id", label: "Origen" },
                  { col: "cost", label: "Costo", r: true },
                  { col: "price_asked", label: "Lista", r: true },
                  { col: "status", label: "Status" },
                ].map(h => <th key={h.col} onClick={() => setInvSort(prev => ({ col: h.col, dir: prev.col === h.col && prev.dir === "asc" ? "desc" : "asc" }))} className="px-3 py-2.5 fb text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors" style={{ color: invSort.col === h.col ? "var(--gd)" : "var(--cd)", textAlign: h.r ? "right" : "left", borderBottom: invSort.col === h.col ? "2px solid var(--gd)" : "1px solid rgba(255,255,255,.06)" }}>{h.label} {invSort.col === h.col ? (invSort.dir === "asc" ? "↑" : "↓") : ""}</th>)}<TH></TH></tr></thead>
                  <tbody>{fp.map(p => (
                    <tr key={p.id} className="hover:bg-white/[.02]" style={p.status === "Corregido" ? { opacity: 0.35 } : {}}>
                      <TD><span className="font-mono text-xs" style={{ color: "var(--cd)" }}>{p.sku || "—"}</span></TD>
                      <TD b>{p.name} {p.publish_catalog && <span title="En catálogo público" style={{ color: "var(--gn)" }}>●</span>}</TD>
                      <TD><Bd text={etLabel(p.entry_type)} v={p.entry_type === "trade_in" ? "gold" : "blue"} /></TD>
                      <TD><Bd text={invInfo[p.fondo_id]?.short || p.fondo_id || "—"} v="gold" /></TD>
                      <TD r>{fmxn(p.cost)}</TD><TD r a="var(--gd)">{fmxn(p.price_asked)}</TD>
                      <TD><Bd text={p.status} v={p.status === "Disponible" ? "green" : p.status === "Vendido" ? "purple" : p.status === "Devuelto" ? "red" : p.status === "Corregido" ? "default" : "default"} /></TD>
                      <TD>
                        <div className="flex gap-1">
                          <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--cd)" }} onClick={() => { setSel(p); setModal("ep"); }}><Ico d={IC.edit} s={14} /></button>
                          {p.status === "Disponible" && <>
                            <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--gn)" }} onClick={() => { setSel(p); setModal("sell"); }}><Ico d={IC.chk} s={14} /></button>
                            <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--gd)" }} onClick={() => { setSel(p); setModal("trade"); }}><Ico d={IC.swap} s={14} /></button>
                          </>}
                          {p.status === "Vendido" && <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "#FB7185" }} onClick={() => hDevolucion(p)} title="Devolver">↩</button>}
                          {p.status !== "Corregido" && <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "#F59E0B" }} onClick={() => hCorregir(p)} title="Corregir entrada">⊘</button>}
                          {p.status === "Disponible" && <button className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "#25D366" }} onClick={() => { const msg = encodeURIComponent(`Hola! Te comparto esta pieza disponible:\n\n*${p.brand} ${p.model}*\nRef: ${p.ref || "N/A"}\nPrecio: ${fmxn(p.price_asked)}\n\nThe Wrist Room — Mérida, Yucatán\nhttps://twr2.vercel.app/catalog`); window.open(`https://wa.me/?text=${msg}`, "_blank"); }} title="Compartir WhatsApp">📱</button>}
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
        {/* ═══ ESTADO DE CUENTA ═══ */}
        {page === "transactions" && (() => {
          const allTx = (data.txs || []).filter(t => activeInv === "ALL" || t.fondo_id === activeInv).sort((a, b) => a.fecha > b.fecha ? 1 : a.fecha < b.fecha ? -1 : 0);
          const allPs = (data.pieces || []).filter(p => activeInv === "ALL" || p.fondo_id === activeInv);
          const fil = allTx.filter(t => (!txFrom || t.fecha >= txFrom) && (!txTo || t.fecha <= txTo));
          const cIds = new Set(allTx.filter(t => t.tipo === "CANCEL_RETIRO" || t.tipo === "DEVOLUCION" || t.tipo === "CORRECCION").map(t => { const m = (t.descripcion || "").match(/ref: ([^\)]+)/); return m ? m[1] : ""; }).filter(Boolean));
          const txL = t => ({ RETIRO: "RETIRO", RETIRO_CAPITAL: "RET.CAP", CANCEL_RETIRO: "↩ CANCEL", DEVOLUCION: "↩ DEVOL", CORRECCION: "⊘ CORREC" }[t] || t);
          const txC = t => ({ SELL: "green", BUY: "red", CAPITAL: "blue", RETIRO: "purple", RETIRO_CAPITAL: "purple", CANCEL_RETIRO: "blue", DEVOLUCION: "gold", TRADE: "gold", CORRECCION: "default" }[t] || "gold");
          const socios = data.socios || [], gc = data.costos || [];
          const gOf = pid => gc.filter(c => c.pieza_id === pid).reduce((s, c) => s + (Number(c.monto) || 0), 0);
          const bef = txFrom ? allTx.filter(t => t.fecha < txFrom) : [];
          const cI = bef.reduce((s, t) => s + (t.monto || 0), 0);

          // Inventory at a specific date: determine each piece's state at that point in time
          const invAt = (date) => {
            if (!date) return [];
            const txBef = allTx.filter(t => t.fecha <= date);
            // Track which trade_refs have been devolved before this date
            const devolvedRefs = new Set(txBef.filter(t => t.tipo === "DEVOLUCION").map(t => t.trade_ref).filter(Boolean));
            return allPs.filter(p => {
              if (p.status === "Corregido") return false;
              const entryDate = p.entry_date || p.created_at?.slice(0, 10);
              if (!entryDate || entryDate > date) return false;

              // If piece is Devuelto and its trade was devolved before this date, it's out
              if (p.status === "Devuelto" && p.trade_ref && devolvedRefs.has(p.trade_ref)) return false;

              const pTxs = txBef.filter(t => t.pieza_id === p.id);
              let inInv = true;
              for (const t of pTxs) {
                if (t.tipo === "SELL") inInv = false;
                else if (t.tipo === "TRADE" && t.descripcion?.startsWith("Trade ")) inInv = false;
                else if (t.tipo === "DEVOLUCION" && t.monto === 0) inInv = true;
                else if (t.tipo === "CORRECCION") inInv = false;
              }
              return inInv;
            });
          };
          // Inventory BEFORE period start (for "Posición Inicial")
          const iB = txFrom ? invAt((() => { const d = new Date(txFrom); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()) : [];
          const iBC = iB.reduce((s, p) => s + (Number(p.cost) || 0), 0);
          // Inventory AT period end (for "Posición Final")
          const iE = txTo ? invAt(txTo) : allPs.filter(p => p.status === "Disponible");
          const iEC = iE.reduce((s, p) => s + (Number(p.cost) || 0), 0);

          const act = {}; fil.forEach(t => { const k = t.tipo; if (!act[k]) act[k] = { n: 0, i: 0, o: 0 }; act[k].n++; if (t.monto > 0) act[k].i += t.monto; else act[k].o += Math.abs(t.monto); });
          const AL = { CAPITAL: { l: "Capital", i: "💰", c: "var(--bl)" }, BUY: { l: "Compras", i: "🛒", c: "var(--rd)" }, SELL: { l: "Ventas", i: "💵", c: "var(--gn)" }, TRADE: { l: "Trades", i: "🔄", c: "var(--gd)" }, RETIRO: { l: "Retiros Util.", i: "📤", c: "#FB7185" }, RETIRO_CAPITAL: { l: "Retiro Cap.", i: "↑", c: "#FB7185" }, CANCEL_RETIRO: { l: "Cancel.", i: "↩", c: "var(--bl)" }, DEVOLUCION: { l: "Devol.", i: "↩", c: "var(--gd)" }, CORRECCION: { l: "Correcciones", i: "⊘", c: "#F59E0B" } };
          const cF = txTo ? allTx.filter(t => t.fecha <= txTo).reduce((s, t) => s + (t.monto || 0), 0) : allTx.reduce((s, t) => s + (t.monto || 0), 0);
          const sP = fil.filter(t => t.tipo === "SELL");
          const uP = sP.reduce((s, t) => { const p = allPs.find(pc => pc.id === t.pieza_id); return p ? s + (t.monto - (Number(p.cost) || 0) - gOf(t.pieza_id)) : s; }, 0);
          const exportPDF = () => {
            const fl = activeInv === "ALL" ? "Todos" : (invInfo[activeInv]?.short || activeInv), pl = txFrom && txTo ? `${txFrom} al ${txTo}` : "Histórico";
            let h = `<html><head><meta charset="UTF-8"><title>TWR Reporte</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;padding:40px;color:#1a1a2e;font-size:11px}h1{font-size:22px}h2{font-size:13px;color:#666;margin-bottom:20px}.hd{display:flex;justify-content:space-between;margin-bottom:25px;padding-bottom:12px;border-bottom:2px solid #C9A96E}.bl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:15px}.bl>div{padding:10px;border-radius:8px;text-align:center;background:#f8f9fa;border:1px solid #e9ecef}.lb{font-size:9px;color:#666;text-transform:uppercase}.vl{font-size:15px;font-weight:700}.sc{margin:15px 0 8px;font-size:11px;font-weight:700;color:#C9A96E;text-transform:uppercase}table{width:100%;border-collapse:collapse}th{text-align:left;padding:6px;border-bottom:2px solid #C9A96E;font-size:9px;text-transform:uppercase;color:#666}td{padding:5px 6px;border-bottom:1px solid #eee;font-size:10px}.r{text-align:right}.b{font-weight:600}.cx{opacity:.4;text-decoration:line-through}.gn{color:#16a34a}.rd{color:#dc2626}.ft{margin-top:25px;padding-top:12px;border-top:1px solid #ddd;font-size:9px;color:#999;text-align:center}</style></head><body>`;
            h += `<div class="hd"><div><h1>The Wrist Room</h1><h2>Reporte — ${fl}</h2><div>${pl}</div></div><div style="text-align:right;font-size:10px;color:#666">${new Date().toLocaleString("es-MX")}</div></div>`;
            if (txFrom) h += `<div class="sc">Inicio</div><div class="bl"><div><div class="lb">Cash</div><div class="vl">${fmxn(cI)}</div></div><div><div class="lb">Inventario</div><div class="vl">${fmxn(iBC)} (${iB.length})</div></div><div><div class="lb">NAV</div><div class="vl">${fmxn(cI+iBC)}</div></div></div>`;
            h += `<div class="sc">Actividad</div><div class="bl" style="grid-template-columns:repeat(4,1fr)">`;
            Object.entries(act).forEach(([k,v]) => { h += `<div><div class="lb">${AL[k]?.l||k} (${v.n})</div><div class="vl">${v.i>0?`<span class="gn">+${fmxn(v.i)}</span> `:""}${v.o>0?`<span class="rd">-${fmxn(v.o)}</span>`:""}</div></div>`; });
            h += `</div><div class="sc">Cierre</div><div class="bl"><div><div class="lb">Cash</div><div class="vl">${fmxn(cF)}</div></div><div><div class="lb">Inventario (${iE.length})</div><div class="vl">${fmxn(iEC)}</div></div><div><div class="lb">NAV</div><div class="vl" style="color:${cF+iEC>=0?"#16a34a":"#dc2626"}">${fmxn(cF+iEC)}</div></div></div>`;
            if (uP !== 0) { h += `<div class="sc">Utilidad: ${fmxn(uP)}</div><div class="bl" style="grid-template-columns:repeat(${socios.length},1fr)">`; socios.forEach(s => { h += `<div><div class="lb">${s.name} ${s.participacion}%</div><div class="vl gn">${fmxn(Math.round(uP*s.participacion/100))}</div></div>`; }); h += `</div>`; }
            h += `<div class="sc">Detalle (${fil.length})</div><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Desc</th><th class="r">Cargo</th><th class="r">Abono</th><th class="r">Saldo</th></tr></thead><tbody>`;
            let rn = cI; fil.forEach(t => { rn += (t.monto||0); h += `<tr${cIds.has(t.id)?' class="cx"':''}><td>${t.fecha}</td><td>${txL(t.tipo)}</td><td>${(t.descripcion||"").replace(/</g,"&lt;")}</td><td class="r rd">${t.monto<0?fmxn(Math.abs(t.monto)):""}</td><td class="r gn">${t.monto>=0?fmxn(t.monto):""}</td><td class="r b">${fmxn(rn)}</td></tr>`; });
            h += `</tbody></table><div class="ft">The Wrist Room · Mérida, Yucatán · ${pl}</div></body></html>`;
            const w = window.open("","_blank"); w.document.write(h); w.document.close(); setTimeout(() => w.print(), 500);
          };
          return <div className="space-y-5 au">
            <div className="flex items-center justify-between flex-wrap gap-3"><h1 className="fd text-2xl md:text-3xl font-bold text-white">Estado de Cuenta</h1><div className="flex gap-2"><button onClick={exportPDF} className="fb text-xs px-4 py-2.5 rounded-xl font-semibold" style={{ background: "rgba(201,169,110,.15)", color: "var(--cr)", border: "1px solid rgba(201,169,110,.2)" }}>📄 PDF</button><BtnS onClick={() => setModal("ac")}>+ Capital</BtnS><BtnS onClick={() => setModal("rc")}>↑ Retiro</BtnS></div></div>
            <div className="flex gap-3 items-end flex-wrap">
              <Fl label="Desde"><input type="date" className="ti" value={txFrom} onChange={e => setTxFrom(e.target.value)} style={{ fontSize: 12, padding: "6px 10px" }} /></Fl>
              <Fl label="Hasta"><input type="date" className="ti" value={txTo} onChange={e => setTxTo(e.target.value)} style={{ fontSize: 12, padding: "6px 10px" }} /></Fl>
              <button onClick={() => { const n = td(); setTxFrom(n.slice(0, 7) + "-01"); setTxTo(n); }} className="fb text-xs px-3 py-2 rounded-lg" style={{ color: "var(--bl)", background: "rgba(96,165,250,.08)" }}>Este mes</button>
              <button onClick={() => { const d = new Date(); d.setMonth(d.getMonth() - 1); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"); setTxFrom(`${y}-${m}-01`); setTxTo(`${y}-${m}-${new Date(y, d.getMonth() + 1, 0).getDate()}`); }} className="fb text-xs px-3 py-2 rounded-lg" style={{ color: "var(--bl)", background: "rgba(96,165,250,.08)" }}>Mes anterior</button>
              {(txFrom || txTo) && <button onClick={() => { setTxFrom(""); setTxTo(""); }} className="fb text-xs px-3 py-2 rounded-lg" style={{ color: "var(--rd)", background: "rgba(251,113,133,.08)" }}>✕</button>}
            </div>
            {txFrom && <Cd className="p-4"><div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--bl)" }}>📊 Posición al {txFrom}</div><div className="grid grid-cols-3 gap-3 text-center"><div><div className="fb text-xs" style={{ color: "var(--cd)" }}>NAV</div><div className="fd font-bold text-lg text-white">{fmxn(cI + iBC)}</div></div><div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Cash</div><div className="fd font-bold text-lg text-white">{fmxn(cI)}</div></div><div><div className="fb text-xs" style={{ color: "var(--gd)" }}>Inventario ({iB.length})</div><div className="fd font-bold text-lg text-white">{fmxn(iBC)}</div></div></div></Cd>}
            <Cd className="p-4"><div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>⚡ Actividad {txFrom ? "del Periodo" : ""} ({fil.length} mov.)</div><div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(act).map(([k, v]) => { const inf = AL[k] || { l: k, i: "📋", c: "var(--cd)" }; return <div key={k} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}><div className="flex items-center gap-2 mb-1"><span>{inf.i}</span><span className="fb text-xs font-semibold" style={{ color: inf.c }}>{inf.l}</span></div><div className="fb text-xs" style={{ color: "var(--cd)" }}>{v.n} op.</div><div className="flex gap-2">{v.i > 0 && <span className="fb text-xs" style={{ color: "var(--gn)" }}>+{fmxn(v.i)}</span>}{v.o > 0 && <span className="fb text-xs" style={{ color: "var(--rd)" }}>-{fmxn(v.o)}</span>}</div></div>; })}
            </div></Cd>
            <Cd className="p-4"><div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gn)" }}>📈 {txFrom ? `Posición al ${txTo || td()}` : "Estado Actual"}</div><div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div><div className="fb text-xs" style={{ color: "var(--cd)" }}>NAV</div><div className="fd font-bold text-xl" style={{ color: cF+iEC >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(cF + iEC)}</div>{txFrom && <div className="fb text-xs mt-0.5" style={{ color: (cF+iEC)-(cI+iBC) >= 0 ? "var(--gn)" : "var(--rd)" }}>{(cF+iEC)-(cI+iBC) >= 0 ? "+" : ""}{fmxn((cF+iEC)-(cI+iBC))}</div>}</div>
              <div><div className="fb text-xs" style={{ color: "var(--bl)" }}>Cash</div><div className="fd font-bold text-xl text-white">{fmxn(cF)}</div>{txFrom && <div className="fb text-xs mt-0.5" style={{ color: cF-cI >= 0 ? "var(--gn)" : "var(--rd)" }}>{cF-cI >= 0 ? "+" : ""}{fmxn(cF-cI)}</div>}</div>
              <div><div className="fb text-xs" style={{ color: "var(--gd)" }}>Inventario ({iE.length})</div><div className="fd font-bold text-xl text-white">{fmxn(iEC)}</div>{txFrom && <div className="fb text-xs mt-0.5" style={{ color: iEC-iBC >= 0 ? "var(--gn)" : "var(--rd)" }}>{iEC-iBC >= 0 ? "+" : ""}{fmxn(iEC-iBC)}</div>}</div>
              <div><div className="fb text-xs" style={{ color: uP >= 0 ? "var(--gn)" : "var(--rd)" }}>Utilidad</div><div className="fd font-bold text-xl" style={{ color: uP >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(uP)}</div></div>
              <div><div className="fb text-xs" style={{ color: "var(--cd)" }}>Vendidas</div><div className="fd font-bold text-xl text-white">{sP.length}</div></div>
            </div>
            {uP !== 0 && <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}><div className="fb text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--gn)" }}>Distribución</div><div className="grid gap-3 text-center" style={{ gridTemplateColumns: `repeat(${socios.length + 1}, 1fr)` }}>
              {socios.map(s => <div key={s.id} className="rounded-lg p-2" style={{ background: `${s.color}11` }}><div className="fb text-xs" style={{ color: s.color }}>{s.name} {s.participacion}%</div><div className="fd font-bold text-white">{fmxn(Math.round(uP * s.participacion / 100))}</div></div>)}
              <div className="rounded-lg p-2" style={{ background: "rgba(201,169,110,.06)" }}><div className="fb text-xs" style={{ color: "var(--gd)" }}>Total</div><div className="fd font-bold" style={{ color: uP >= 0 ? "var(--gn)" : "var(--rd)" }}>{fmxn(uP)}</div></div>
            </div></div>}
            </Cd>
            <Cd><div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}><span className="fb text-xs font-bold" style={{ color: "var(--cd)" }}>Detalle ({fil.length}) — más recientes primero</span></div><div className="overflow-x-auto"><table className="w-full"><thead><tr><TH>Fecha</TH><TH>Tipo</TH><TH>Descripción</TH><TH>Fondo</TH><TH r>Monto</TH><TH r>Saldo</TH><TH></TH></tr></thead>
              <tbody>{(() => { let rn = cI; const rows = fil.map(t => { rn += (t.monto || 0); return { ...t, _saldo: rn }; }); return rows.slice().reverse().map(t => { const isR = t.tipo === "RETIRO" || t.tipo === "RETIRO_CAPITAL"; const cx = cIds.has(t.id);
                return <tr key={t.id} className="hover:bg-white/[.02]" style={cx ? { opacity: 0.4 } : {}}><TD><span className="text-xs" style={{ color: "var(--cd)" }}>{t.fecha}</span></TD><TD><Bd text={txL(t.tipo)} v={txC(t.tipo)} /></TD><TD><span style={cx ? { textDecoration: "line-through" } : {}}>{t.descripcion}</span>{cx && <span className="fb text-xs ml-1" style={{ color: "var(--rd)" }}>cancelado</span>}</TD><TD><Bd text={invInfo[t.fondo_id]?.short || t.fondo_id || "—"} v="blue" /></TD><TD r a={(t.monto || 0) >= 0 ? "var(--gn)" : "var(--rd)"}>{(t.monto || 0) >= 0 ? "+" : ""}{fmxn(t.monto)}</TD><TD r><span className="fb text-xs" style={{ color: "var(--cd)" }}>{fmxn(t._saldo)}</span></TD><TD>{isR && !cx && <button onClick={() => hCancelRetiro(t)} className="fb text-xs px-2 py-1 rounded-lg hover:bg-white/5" style={{ color: "#FB7185" }}>↩</button>}</TD></tr>; }); })()}</tbody>
            </table></div></Cd>
          </div>;
        })()}

        {page === "cortes" && (
          <div className="space-y-5 au">
            <div className="flex items-center justify-between"><h1 className="fd text-2xl md:text-3xl font-bold text-white">Cortes Mensuales</h1><BtnP onClick={() => setModal("ct")}>+ Corte</BtnP></div>
            {(data.cortes || []).length === 0 && <Cd className="p-8 text-center"><div className="fb text-sm" style={{ color: "var(--cd)" }}>No hay cortes registrados. Crea el primer corte mensual para controlar utilidades.</div></Cd>}
            <div className="space-y-3">{(data.cortes || []).map(c => <Cd key={c.id} className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="fb text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>{c.id}</span>
                <span className="fd font-semibold text-white">{c.periodo}</span>
                <span className="fb text-sm" style={{ color: "var(--cd)" }}>{c.label}</span>
                <Bd text={c.decision === "retirar" ? "💰 Retirado" : c.decision === "cancelado" ? "❌ Cancelado" : "🔄 Reinvertido"} v={c.decision === "retirar" ? "green" : c.decision === "cancelado" ? "red" : "blue"} />{c.decision === "retirar" && c.utilidad > 0 && <button onClick={() => hCancelCorte(c)} className="fb text-xs px-3 py-1 rounded-lg ml-2" style={{ background: "rgba(251,113,133,.1)", color: "#FB7185" }}>↩ Cancelar</button>}
              </div>
              {c.utilidad > 0 && <div className={`grid gap-3 text-center py-2 rounded-xl`} style={{ background: "rgba(255,255,255,.03)", gridTemplateColumns: `repeat(${(data.socios?.length || 0) + 1}, 1fr)` }}>
                <div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Utilidad</span><div className="fd font-bold" style={{ color: "var(--gn)" }}>{fmxn(c.utilidad)}</div></div>
                {(data.socios || []).map(s => <div key={s.id}><span className="fb text-xs" style={{ color: s.color }}>{s.name}</span><div className="fd font-bold text-white">{fmxn(c.splits?.[s.id] || 0)}</div></div>)}
              </div>}
              {c.utilidad === 0 && <div className="fb text-sm" style={{ color: "var(--cd)" }}>Sin utilidad en este periodo</div>}
            </Cd>)}</div>
          </div>
        )}

        {/* ═══ CATALOGS ═══ */}
        {page === "catalogs" && <CatalogsSection data={data} refresh={refresh} showToast={showToast} db={db} />}

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
            {/* Contact Stats */}
            <ContactStats pieces={data.pieces} />

            <Cd className="p-5">
              <h3 className="fd font-semibold text-white mb-4">Distribución de Utilidades</h3>
              <div className={`grid gap-4 text-center`} style={{ gridTemplateColumns: `repeat(${(data.socios?.length || 0) + 1}, 1fr)` }}>
                <div><span className="fb text-xs" style={{ color: "var(--cd)" }}>Total</span><div className="fd text-xl font-bold" style={{ color: "var(--gn)" }}>{fmxn(comp.rp)}</div></div>
                {(data.socios || []).map(s => <div key={s.id}><span className="fb text-xs" style={{ color: s.color }}>{s.name} {s.participacion}%</span><div className="fd text-lg font-bold text-white">{fmxn(Math.round(comp.rp * (Number(s.participacion) / 100)))}</div></div>)}
              </div>
            </Cd>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {page === "settings" && <SettingsPage data={data} showToast={showToast} refresh={refresh} currentUser={user} />}

      </div></main>

      {/* Toast */}
      {toast && <div className="fixed bottom-4 right-4 z-50 fb text-sm px-4 py-3 rounded-xl shadow-lg au" style={{ background: toast.type === "ok" ? "#166534" : "rgba(251,113,133,.2)", color: toast.type === "ok" ? "var(--gn)" : "var(--rd)" }}>{toast.msg}</div>}

      {/* MODALS */}
      <Md open={modal === "ap"} onClose={cm} title="Nueva Pieza — Entrada" wide><PcForm onSave={hAddPc} onClose={cm} allPieces={data.pieces} fotos={data.fotos} customRefs={data.customRefs} userId={user?.id} suppliers={data.suppliers} onSaveSupplier={async (s) => { await db.saveSupplier(s); await refresh(); }} userRole={myProfile?.role} invInfo={invInfo} myInvs={myInvs} defaultFund={activeInv === "ALL" ? "FIC" : activeInv} txs={data.txs} investors={investors} /></Md>
      <Md open={modal === "ep"} onClose={cm} title={"Editar — " + (sel?.name || "")} wide>{sel && <PcForm piece={sel} onSave={hUpdPc} onClose={cm} allPieces={data.pieces} fotos={data.fotos} customRefs={data.customRefs} userId={user?.id} suppliers={data.suppliers} onSaveSupplier={async (s) => { await db.saveSupplier(s); await refresh(); }} userRole={myProfile?.role} invInfo={invInfo} myInvs={myInvs} defaultFund={activeInv === "ALL" ? (investors[0]?.id || null) : activeInv} txs={data.txs} investors={investors} />}</Md>
      <Md open={modal === "sell"} onClose={cm} title={"Salida — " + (sel?.name || "")} wide>{sel && <SellForm piece={sel} onSave={hSell} onClose={cm} docs={docs} socios={data.socios} allPieces={data.pieces} clients={data.clients} onSaveClient={async (c) => { await db.saveClient(c); await refresh(); }} costos={data.costos} invInfo={invInfo} myInvs={myInvs} txs={data.txs} />}</Md>
      <Md open={modal === "trade"} onClose={cm} title={"Trade-out — " + (sel?.name || "")} wide>{sel && <TradeForm piece={sel} allPieces={data.pieces} onSave={hTrade} onClose={cm} />}</Md>
      <Md open={modal === "ac"} onClose={cm} title="Inyección de Capital">{<CapitalForm onSave={hCap} onClose={cm} socios={data.socios} invInfo={invInfo} myInvs={myInvs} defaultFund={activeInv === "ALL" ? "FIC" : activeInv} txs={data.txs} />}</Md>
      <Md open={modal === "rc"} onClose={cm} title="Retiro de Capital">{<RetiroCapitalForm onSave={hRetiro} onClose={cm} socios={data.socios} invInfo={invInfo} myInvs={myInvs} defaultFund={activeInv === "ALL" ? "FIC" : activeInv} txs={data.txs} />}</Md>

      {/* Post-Devolution Action Panel */}
      <Md open={modal === "post_dev"} onClose={cm} title="Pieza Devuelta — ¿Qué hacer?">
        {sel && (() => {
          const freshPiece = (data?.pieces || []).find(p => p.id === sel.id) || sel;
          return <div className="space-y-4">
          <div className="rounded-xl p-4 text-center" style={{ background: "rgba(74,222,128,.06)", border: "1px solid rgba(74,222,128,.15)" }}>
            <div className="text-3xl mb-2">✅</div>
            <div className="fd text-lg font-bold text-white mb-1">{freshPiece.name}</div>
            <div className="fb text-xs" style={{ color: "var(--cd)" }}>{freshPiece.sku} · Costo: {fmxn(freshPiece.cost)} · Ahora en inventario</div>
          </div>
          <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gd)" }}>Acciones rápidas</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setSel(freshPiece); setModal("sell"); }} className="p-4 rounded-xl text-center transition-all hover:brightness-110" style={{ background: "rgba(74,222,128,.08)", border: "1.5px solid rgba(74,222,128,.15)" }}>
              <div className="text-2xl mb-2">💵</div>
              <div className="fb text-sm font-semibold" style={{ color: "var(--gn)" }}>Vender</div>
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Registrar venta directa</div>
            </button>
            <button onClick={() => { setSel(freshPiece); setModal("trade"); }} className="p-4 rounded-xl text-center transition-all hover:brightness-110" style={{ background: "rgba(201,169,110,.08)", border: "1.5px solid rgba(201,169,110,.15)" }}>
              <div className="text-2xl mb-2">🔄</div>
              <div className="fb text-sm font-semibold" style={{ color: "var(--gd)" }}>Nuevo Trade</div>
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Intercambiar por otra pieza</div>
            </button>
            <button onClick={() => { setSel(freshPiece); setModal("ep"); }} className="p-4 rounded-xl text-center transition-all hover:brightness-110" style={{ background: "rgba(96,165,250,.08)", border: "1.5px solid rgba(96,165,250,.15)" }}>
              <div className="text-2xl mb-2">✏️</div>
              <div className="fb text-sm font-semibold" style={{ color: "var(--bl)" }}>Editar Pieza</div>
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Fotos, precio, catálogo</div>
            </button>
            <button onClick={cm} className="p-4 rounded-xl text-center transition-all hover:brightness-110" style={{ background: "rgba(255,255,255,.04)", border: "1.5px solid rgba(255,255,255,.08)" }}>
              <div className="text-2xl mb-2">📦</div>
              <div className="fb text-sm font-semibold text-white">Guardar</div>
              <div className="fb text-xs mt-1" style={{ color: "var(--cd)" }}>Dejar en inventario</div>
            </button>
          </div>
        </div>;
        })()}
      </Md>
      <Md open={modal === "ct"} onClose={cm} title="Nuevo Corte Mensual" wide>{<CorteForm onSave={async (c) => {
        try {
          const { _sells, ...corteData } = c;
          await db.saveCorte(corteData);
          const fondo = c.fondo_id || "FIC";

          if (c.utilidad > 0) {
            for (const s of (data.socios || [])) {
              const share = c.splits?.[s.id] || 0;
              if (share <= 0) continue;

              if (c.decision === "retirar") {
                // Retirar: profit leaves the fund
                await db.saveTx({ id: uid(), fecha: td(), tipo: "RETIRO", pieza_id: null, monto: -(share), fondo_id: fondo, descripcion: `Retiro utilidades ${c.periodo} — ${s.name} (${s.participacion}%)`, metodo_pago: "Retiro", partner_id: s.id });
              } else {
                // Reinvertir: withdraw profit then reinsert as new capital
                await db.saveTx({ id: uid(), fecha: td(), tipo: "RETIRO", pieza_id: null, monto: -(share), fondo_id: fondo, descripcion: `Corte ${c.periodo} — Retiro utilidad ${s.name} (${s.participacion}%)`, metodo_pago: "Reinversión", partner_id: s.id });
                await db.saveTx({ id: uid(), fecha: td(), tipo: "CAPITAL", pieza_id: null, monto: share, fondo_id: fondo, descripcion: `Corte ${c.periodo} — Reinversión utilidad ${s.name} (${s.participacion}%)`, metodo_pago: "Reinversión", partner_id: s.id });
              }
            }
          }
          showToast(c.decision === "retirar" ? "Corte cerrado — retiros generados" : "Corte cerrado — utilidades reinvertidas como capital");
          await refresh(); cm();
        } catch (e) { alert(e.message); }
      } } onClose={cm} socios={data.socios} pieces={data.pieces} txs={data.txs} cortes={data.cortes} costos={data.costos} />}</Md>
    </div>
  );
}

/* ═══ SMALL FORMS ═══ */
function ContactStats({ pieces }) {
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!loaded) { db.loadContactStats().then(d => { setStats(d); setLoaded(true); }); } }, [loaded]);
  if (!stats || stats.length === 0) return null;
  const byPiece = {};
  stats.forEach(s => { byPiece[s.pieza_id] = (byPiece[s.pieza_id] || 0) + 1; });
  const ranked = Object.entries(byPiece).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const today = stats.filter(s => s.created_at?.slice(0, 10) === td()).length;
  const week = stats.filter(s => { const d = new Date(s.created_at); return (Date.now() - d.getTime()) < 7 * 86400000; }).length;
  return (
    <Cd className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="fb text-xs font-bold uppercase tracking-widest" style={{ color: "var(--bl)" }}>📱 Contactos del Catálogo</div>
        <div className="flex gap-3">
          <span className="fb text-xs" style={{ color: "var(--gn)" }}>Hoy: {today}</span>
          <span className="fb text-xs" style={{ color: "var(--bl)" }}>7d: {week}</span>
          <span className="fb text-xs" style={{ color: "var(--cd)" }}>Total: {stats.length}</span>
        </div>
      </div>
      <div className="space-y-1">
        {ranked.map(([pid, count]) => {
          const p = (pieces || []).find(pc => pc.id === pid);
          return <div key={pid} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}>
            <div className="fb text-sm text-white flex-1 truncate">{p?.name || pid}</div>
            {p?.es_referenciada && <span className="fb text-xs" style={{ color: "var(--gd)" }}>🤝</span>}
            <div className="fb text-sm font-bold" style={{ color: "var(--bl)" }}>{count} <span className="text-xs font-normal" style={{ color: "var(--cd)" }}>click{count !== 1 ? "s" : ""}</span></div>
          </div>;
        })}
      </div>
    </Cd>
  );
}

function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const load = async () => { setLoading(true); setLogs(await db.loadAuditLog(100)); setLoading(false); setExpanded(true); };
  return (
    <Cd className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="fd font-semibold text-white">📜 Registro de Actividad</h3>
        {!expanded ? <BtnS onClick={load}>{loading ? "Cargando..." : "Ver Log"}</BtnS> : <BtnS onClick={() => setExpanded(false)}>Ocultar</BtnS>}
      </div>
      {expanded && logs.length > 0 && (
        <div className="space-y-1" style={{ maxHeight: 400, overflowY: "auto" }}>
          {logs.map(l => (
            <div key={l.id} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}>
              <div className="fb text-xs shrink-0" style={{ color: "var(--cd)", minWidth: 120 }}>{l.created_at?.slice(0, 16).replace("T", " ")}</div>
              <div className="fb text-xs font-semibold shrink-0" style={{ color: "var(--bl)", minWidth: 80 }}>{l.action}</div>
              <div className="fb text-xs flex-1 min-w-0 truncate" style={{ color: "var(--cd)" }}>
                {l.description || `${l.module || ""} ${l.entity || ""}`}
              </div>
              <div className="fb text-xs shrink-0" style={{ color: "var(--gk)" }}>{l.user_name || l.user_email || "—"}</div>
            </div>
          ))}
        </div>
      )}
      {expanded && logs.length === 0 && <div className="fb text-sm text-center py-4" style={{ color: "var(--cd)" }}>No hay registros de actividad.</div>}
    </Cd>
  );
}

function CatalogsSection({ data, refresh, showToast, db }) {
  const [catTab, setCatTab] = useState("proveedores");
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState("");

  const saveSupp = async (s) => { try { await db.saveSupplier(s); showToast("Proveedor guardado"); setEditItem(null); await refresh(); } catch(e) { alert("Error: " + e.message); } };
  const saveClnt = async (c) => { try { await db.saveClient(c); showToast("Cliente guardado"); setEditItem(null); await refresh(); } catch(e) { alert("Error: " + e.message); } };
  const delSupp = async (id) => { if (!confirm("¿Eliminar proveedor?")) return; try { await db.delSupplier(id); showToast("Eliminado"); await refresh(); } catch(e) { alert("Error: " + e.message); } };
  const delClnt = async (id) => { if (!confirm("¿Eliminar cliente?")) return; try { await db.delClient(id); showToast("Eliminado"); await refresh(); } catch(e) { alert("Error: " + e.message); } };

  const suppList = (data.suppliers || []).filter(s => !search || s.name?.toLowerCase().includes(search.toLowerCase()));
  const clntList = (data.clients || []).filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5 au">
      <h1 className="fd text-2xl md:text-3xl font-bold text-white">Catálogos</h1>
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[{id:"proveedores",l:"Proveedores",n:data.suppliers?.length||0},{id:"clientes",l:"Clientes",n:data.clients?.length||0},{id:"marcas",l:"Marcas & Modelos",n:BRANDS.length},{id:"catalogo",l:"Catálogo Público"}].map(t =>
          <button key={t.id} onClick={() => { setCatTab(t.id); setSearch(""); setEditItem(null); }} className="fb text-sm px-4 py-2 rounded-lg transition-all" style={catTab === t.id ? { background: "rgba(201,169,110,.15)", color: "var(--cr)", fontWeight: 600 } : { background: "rgba(255,255,255,.03)", color: "var(--cd)" }}>{t.l} {t.n != null && <span className="ml-1 text-xs">({t.n})</span>}</button>
        )}
      </div>

      {/* ─── PROVEEDORES ─── */}
      {catTab === "proveedores" && (
        <Cd className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="fd font-semibold text-white">Proveedores ({suppList.length})</h3>
            <div className="flex gap-2">
              <input className="ti" style={{ width: 180, fontSize: 12 }} placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
              <button onClick={() => setEditItem({ id: "Pid_" + uid().slice(0,8), name: "", type: "Particular", phone: "", email: "", ine: "", notes: "", _new: true })} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>+ Nuevo</button>
            </div>
          </div>
          {editItem && editItem.id?.startsWith("Pid") && (
            <div className="p-3 rounded-xl mb-3" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.12)" }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                <input className="ti" placeholder="Nombre *" value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} />
                <select className="ti" value={editItem.type || "Particular"} onChange={e => setEditItem(p => ({ ...p, type: e.target.value }))}>{SUPPLIER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                <input className="ti" placeholder="Teléfono" value={editItem.phone || ""} onChange={e => setEditItem(p => ({ ...p, phone: e.target.value }))} />
                <input className="ti" placeholder="Email" value={editItem.email || ""} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} />
                <input className="ti" placeholder="INE / Identificación" value={editItem.ine || ""} onChange={e => setEditItem(p => ({ ...p, ine: e.target.value }))} />
                <input className="ti" placeholder="Notas" value={editItem.notes || ""} onChange={e => setEditItem(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex gap-2"><BtnP onClick={() => { if (!editItem.name) return alert("Nombre requerido"); const { _new, ...s } = editItem; saveSupp(s); }}>Guardar</BtnP><BtnS onClick={() => setEditItem(null)}>Cancelar</BtnS></div>
            </div>
          )}
          <div className="space-y-1">
            {suppList.map(s => {
              const deals = (data.pieces || []).filter(p => p.supplier_id === s.id).length;
              return (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center fb text-sm font-bold" style={{ background: "rgba(201,169,110,.12)", color: "var(--cr)" }}>{(s.name || "?")[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="fb text-sm font-semibold text-white truncate">{s.name} <span className="text-xs font-normal" style={{ color: "var(--cd)" }}>· {s.type || "Particular"}</span></div>
                  <div className="fb text-xs" style={{ color: "var(--cd)" }}>{[s.phone, s.email].filter(Boolean).join(" · ") || "Sin contacto"}{deals > 0 && ` · ${deals} pieza(s)`}</div>
                </div>
                <button onClick={() => setEditItem({ ...s })} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--cr)" }}>✏️</button>
                <button onClick={() => delSupp(s.id)} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--rd)" }}>🗑</button>
              </div>);
            })}
            {suppList.length === 0 && <div className="fb text-sm text-center py-6" style={{ color: "var(--cd)" }}>No hay proveedores registrados</div>}
          </div>
        </Cd>
      )}

      {/* ─── CLIENTES ─── */}
      {catTab === "clientes" && (
        <Cd className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="fd font-semibold text-white">Clientes ({clntList.length})</h3>
            <div className="flex gap-2">
              <input className="ti" style={{ width: 180, fontSize: 12 }} placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
              <button onClick={() => setEditItem({ id: "Cid_" + uid().slice(0,8), name: "", phone: "", email: "", ine: "", tier: "Prospecto", notes: "", _new: true })} className="fb text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}>+ Nuevo</button>
            </div>
          </div>
          {editItem && editItem.id?.startsWith("Cid") && (
            <div className="p-3 rounded-xl mb-3" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.12)" }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                <input className="ti" placeholder="Nombre *" value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} />
                <select className="ti" value={editItem.tier || "Prospecto"} onChange={e => setEditItem(p => ({ ...p, tier: e.target.value }))}>{CLIENT_TIERS.map(t => <option key={t} value={t}>{t}</option>)}</select>
                <input className="ti" placeholder="Teléfono" value={editItem.phone || ""} onChange={e => setEditItem(p => ({ ...p, phone: e.target.value }))} />
                <input className="ti" placeholder="Email" value={editItem.email || ""} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} />
                <input className="ti" placeholder="INE / Identificación" value={editItem.ine || ""} onChange={e => setEditItem(p => ({ ...p, ine: e.target.value }))} />
                <input className="ti" placeholder="Notas" value={editItem.notes || ""} onChange={e => setEditItem(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex gap-2"><BtnP onClick={() => { if (!editItem.name) return alert("Nombre requerido"); const { _new, ...c } = editItem; saveClnt(c); }}>Guardar</BtnP><BtnS onClick={() => setEditItem(null)}>Cancelar</BtnS></div>
            </div>
          )}
          <div className="space-y-1">
            {clntList.map(c => {
              const buys = (data.pieces || []).filter(p => p.client_id === c.id).length;
              return (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center fb text-sm font-bold" style={{ background: "rgba(96,165,250,.12)", color: "var(--bl)" }}>{(c.name || "?")[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="fb text-sm font-semibold text-white truncate">{c.name} <Bd text={c.tier || "Prospecto"} v={c.tier === "VIP" ? "green" : "blue"} /></div>
                  <div className="fb text-xs" style={{ color: "var(--cd)" }}>{[c.phone, c.email].filter(Boolean).join(" · ") || "Sin contacto"}{buys > 0 && ` · ${buys} compra(s)`}</div>
                </div>
                <button onClick={() => setEditItem({ ...c })} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--cr)" }}>✏️</button>
                <button onClick={() => delClnt(c.id)} className="fb text-xs px-2 py-1 rounded" style={{ color: "var(--rd)" }}>🗑</button>
              </div>);
            })}
            {clntList.length === 0 && <div className="fb text-sm text-center py-6" style={{ color: "var(--cd)" }}>No hay clientes registrados</div>}
          </div>
        </Cd>
      )}

      {/* ─── MARCAS ─── */}
      {catTab === "marcas" && (
        <>
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
        </>
      )}

      {/* ─── CATALOGO PUBLICO ─── */}
      {catTab === "catalogo" && (
        <Cd className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="fd font-semibold text-white">Catálogo Público</h3>
            <a href="?catalog" target="_blank" className="fb text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: "rgba(74,222,128,.12)", color: "var(--gn)" }}><Ico d={IC.globe} s={14} />Ver catálogo</a>
          </div>
          <div className="fb text-sm" style={{ color: "var(--cd)" }}>
            {(data.pieces || []).filter(p => p.publish_catalog).length} piezas publicadas de {(data.pieces || []).filter(p => p.status === "Disponible").length} disponibles
          </div>
        </Cd>
      )}
    </div>
  );
}

function CapitalForm({ onSave, onClose, socios, invInfo: fi, myInvs, defaultFund, txs }) {
  const sl = socios || [];
  const funds = myInvs || ["FIC"];
  const info = fi || {};
  const [amt, setAmt] = useState(""); const [desc, setDesc] = useState(""); const [partner, setPartner] = useState(sl[0]?.id || "");
  const [fund, setFund] = useState(defaultFund || funds[0] || "FIC");
  const [fecha, setFecha] = useState(td());
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!amt || saving) return;
    setSaving(true);
    try { await onSave(Number(amt), desc, partner, fund, fecha); } catch(e) { alert("Error: " + e.message); setSaving(false); }
  };
  return <div className="space-y-4">
    {funds.length > 1 && <InvSel value={fund} onChange={setFund} label="¿A qué fondo?" funds={funds} invInfo={info} txs={txs} />}
    {funds.length === 1 && <div className="fb text-xs p-3 rounded-xl" style={{ background: "rgba(201,169,110,.06)", color: "var(--gd)" }}>{info[funds[0]]?.icon} Fondo: {info[funds[0]]?.short}</div>}
    <Fl label="Fecha" req><input type="date" className="ti" value={fecha} onChange={e => setFecha(e.target.value)} /></Fl>
    <Fl label="Monto (MXN)" req><input type="number" className="ti" value={amt} onChange={e => setAmt(e.target.value)} /></Fl>
    <Fl label="Descripción"><input className="ti" value={desc} onChange={e => setDesc(e.target.value)} /></Fl>
    <div className="flex gap-3"><BtnP onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Registrar"}</BtnP><BtnS onClick={onClose} disabled={saving}>Cancelar</BtnS></div>
  </div>;
}

function RetiroCapitalForm({ onSave, onClose, socios, invInfo: fi, myInvs, defaultFund, txs }) {
  const sl = socios || [], funds = myInvs || ["FIC"], info = fi || {};
  const [amt, setAmt] = useState(""), [desc, setDesc] = useState(""), [partner, setPartner] = useState(sl[0]?.id || "");
  const [fund, setFund] = useState(defaultFund || funds[0] || "FIC"), [motivo, setMotivo] = useState("parcial"), [saving, setSaving] = useState(false);
  const [fecha, setFecha] = useState(td());
  const cash = (txs || []).reduce((s, t) => t.fondo_id === fund ? s + (t.monto || 0) : s, 0);
  const cap = (txs || []).filter(t => t.fondo_id === fund && t.tipo === "CAPITAL").reduce((s, t) => s + (t.monto || 0), 0);
  const go = async () => { if (!amt || saving || Number(amt) <= 0) return; setSaving(true); try { await onSave(Number(amt), desc, partner, fund, motivo, fecha); } catch(e) { alert(e.message); setSaving(false); } };
  return <div className="space-y-4">
    {funds.length > 1 && <InvSel value={fund} onChange={setFund} label="¿De qué fondo?" funds={funds} invInfo={info} txs={txs} />}
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl p-3 text-center" style={{ background: "rgba(96,165,250,.06)" }}><div className="fb text-xs" style={{ color: "var(--bl)" }}>Cash</div><div className="fd font-bold text-lg text-white">{fmxn(cash)}</div></div>
      <div className="rounded-xl p-3 text-center" style={{ background: "rgba(201,169,110,.06)" }}><div className="fb text-xs" style={{ color: "var(--gd)" }}>Capital</div><div className="fd font-bold text-lg text-white">{fmxn(cap)}</div></div>
    </div>
    <Fl label="Fecha" req><input type="date" className="ti" value={fecha} onChange={e => setFecha(e.target.value)} /></Fl>
    <Fl label="Motivo" req><div className="grid grid-cols-3 gap-2">
      {[{v:"parcial",l:"Parcial",i:"📤"},{v:"venta",l:"Al Vender",i:"💰"},{v:"total",l:"Total",i:"🏦"}].map(m => <button key={m.v} type="button" onClick={() => { setMotivo(m.v); if (m.v === "total") setAmt(String(Math.max(0, cash))); }} className="p-3 rounded-xl text-center" style={{ background: motivo === m.v ? "rgba(251,113,133,.1)" : "rgba(255,255,255,.03)", border: motivo === m.v ? "1.5px solid rgba(251,113,133,.3)" : "1.5px solid rgba(255,255,255,.06)" }}><div className="text-xl mb-1">{m.i}</div><div className="fb text-xs font-semibold" style={{ color: motivo === m.v ? "#FB7185" : "var(--cd)" }}>{m.l}</div></button>)}
    </div></Fl>
    <Fl label="¿Quién?" req><div className="space-y-2">{sl.map(s => <button key={s.id} type="button" onClick={() => setPartner(s.id)} className="w-full flex items-center gap-3 p-3 rounded-xl" style={{ background: partner === s.id ? "rgba(251,113,133,.1)" : "rgba(255,255,255,.02)", border: partner === s.id ? "1.5px solid rgba(251,113,133,.3)" : "1.5px solid rgba(255,255,255,.06)" }}><div className="w-8 h-8 rounded-lg flex items-center justify-center fb text-xs font-bold" style={{ background: `${s.color}20`, color: s.color }}>{s.participacion}%</div><div className="fb text-sm font-semibold text-white">{s.name}</div>{partner === s.id && <div className="ml-auto" style={{ color: "#FB7185" }}>✓</div>}</button>)}</div></Fl>
    <Fl label="Monto (MXN)" req><input type="number" className="ti" style={{ fontSize: 18, fontWeight: 700 }} value={amt} onChange={e => setAmt(e.target.value)} />{Number(amt) > cash && <div className="fb text-xs mt-1 p-2 rounded-lg" style={{ background: "rgba(251,113,133,.08)", color: "var(--rd)" }}>⚠️ Excede cash</div>}</Fl>
    <Fl label="Descripción"><input className="ti" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Motivo..." /></Fl>
    <div className="flex gap-3"><button type="button" onClick={go} disabled={saving || !amt || Number(amt) <= 0} className="fb px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: "rgba(251,113,133,.15)", color: "#FB7185", border: "1px solid rgba(251,113,133,.25)" }}>{saving ? "..." : `Retirar ${amt ? fmxn(Number(amt)) : ""}`}</button><BtnS onClick={onClose} disabled={saving}>Cancelar</BtnS></div>
  </div>;
}

function CorteForm({ onSave, onClose, socios, pieces, txs, cortes, costos }) {
  const sl = socios || [];
  const allTxs = txs || [];
  const allPieces = pieces || [];
  const allCostos = costos || [];
  const existingCortes = cortes || [];
  const [period, setP] = useState(td().slice(0, 7));
  const [label, setL] = useState("");
  const exists = existingCortes.some(c => c.periodo === period);

  const periodSells = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const start = `${period}-01`;
    const endDay = new Date(y, m, 0).getDate();
    const end = `${period}-${String(endDay).padStart(2, "0")}`;
    return allTxs.filter(t => t.tipo === "SELL" && t.fecha >= start && t.fecha <= end).map(t => {
      const pc = allPieces.find(p => p.id === t.pieza_id);
      const cost = pc?.cost || 0;
      const gastos = allCostos.filter(cx => cx.pieza_id === t.pieza_id).reduce((s, cx) => s + (Number(cx.monto) || 0), 0);
      const sale = t.monto || 0;
      return { txId: t.id, pieza_id: t.pieza_id, name: pc?.name || "—", sku: pc?.sku || "", cost, gastos, costoReal: cost + gastos, sale, profit: sale - cost - gastos, fecha: t.fecha };
    });
  }, [period, allTxs, allPieces, allCostos]);

  const totalProfit = periodSells.reduce((s, p) => s + p.profit, 0);
  const totalSales = periodSells.reduce((s, p) => s + p.sale, 0);
  const totalCost = periodSells.reduce((s, p) => s + p.cost, 0);
  const totalGastosCorte = periodSells.reduce((s, p) => s + p.gastos, 0);
  const splits = Object.fromEntries(sl.map(s => [s.id, Math.round(totalProfit * (Number(s.participacion) / 100))]));
  const cap = allTxs.filter(t => t.tipo === "CAPITAL").reduce((s, t) => s + (t.monto || 0), 0);

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <Fl label="Periodo" req><input type="month" className="ti" value={period} onChange={e => setP(e.target.value)} /></Fl>
      <Fl label="Etiqueta"><input className="ti" value={label} onChange={e => setL(e.target.value)} placeholder={`Corte ${period}`} /></Fl>
    </div>

    {exists && <div className="fb text-sm p-3 rounded-xl" style={{ background: "rgba(251,113,133,.08)", color: "var(--rd)" }}>⚠ Ya existe un corte para {period}</div>}

    <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)" }}>
      <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gd)" }}>Ventas del Periodo ({periodSells.length})</div>
      {periodSells.length > 0 ? (<div className="space-y-1">
        {periodSells.map((s, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: "rgba(255,255,255,.02)" }}>
            <div className="flex-1 min-w-0">
              <div className="fb text-sm font-semibold text-white truncate">{s.sku} — {s.name}</div>
              <div className="fb text-xs" style={{ color: "var(--cd)" }}>{s.fecha}</div>
            </div>
            <div className="text-right">
              <div className="fb text-xs" style={{ color: "var(--cd)" }}>Costo: {fmxn(s.cost)}{s.gastos > 0 ? ` + Gastos: ${fmxn(s.gastos)}` : ""} → Venta: {fmxn(s.sale)}</div>
              <div className="fb text-sm font-bold" style={{ color: s.profit >= 0 ? "var(--gn)" : "var(--rd)" }}>{s.profit >= 0 ? "+" : ""}{fmxn(s.profit)}</div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 p-3 mt-2 rounded-xl" style={{ background: "rgba(201,169,110,.06)", border: "1px solid rgba(201,169,110,.1)" }}>
          <div className="flex-1"><span className="fd font-semibold text-white">Total</span></div>
          <div className="text-right">
            <div className="fb text-xs" style={{ color: "var(--cd)" }}>Costo: {fmxn(totalCost)}{totalGastosCorte > 0 ? ` + Gastos: ${fmxn(totalGastosCorte)}` : ""} → Ventas: {fmxn(totalSales)}</div>
            <div className="fd text-lg font-bold" style={{ color: totalProfit >= 0 ? "var(--gn)" : "var(--rd)" }}>{totalProfit >= 0 ? "+" : ""}{fmxn(totalProfit)}</div>
          </div>
        </div>
      </div>) : (<div className="fb text-sm text-center py-4" style={{ color: "var(--cd)" }}>No hay ventas en este periodo</div>)}
    </div>

    {totalProfit !== 0 && (<div className="rounded-xl p-4" style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.1)" }}>
      <div className="fb text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--gn)" }}>Distribución {cap > 0 ? `(${((totalProfit / cap) * 100).toFixed(1)}% s/capital)` : ""}</div>
      <div className={`grid gap-3 text-center`} style={{ gridTemplateColumns: `repeat(${sl.length + 1}, 1fr)` }}>
        {sl.map(s => (<div key={s.id} className="rounded-xl p-3" style={{ background: `${s.color}11` }}>
          <div className="fb text-xs" style={{ color: s.color }}>{s.name} {s.participacion}%</div>
          <div className="fd font-bold text-lg text-white">{fmxn(splits[s.id] || 0)}</div>
        </div>))}
        <div className="rounded-xl p-3" style={{ background: "rgba(201,169,110,.06)" }}>
          <div className="fb text-xs" style={{ color: "var(--gd)" }}>Total</div>
          <div className="fd font-bold text-lg" style={{ color: "var(--gn)" }}>{fmxn(totalProfit)}</div>
        </div>
      </div>
    </div>)}

    {totalProfit > 0 && !exists && (<div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => onSave({ id: "C-" + uid().slice(0, 5), periodo: period, label: label || `Corte ${period}`, utilidad: totalProfit, splits, decision: "reinvertir", fondo_id: "FIC" })} className="fb p-4 rounded-xl text-center font-semibold transition-all hover:brightness-110" style={{ background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.2)", color: "var(--bl)" }}>
        <div className="text-2xl mb-1">🔄</div><div>Reinvertir</div>
        <div className="text-xs font-normal mt-1" style={{ color: "var(--cd)" }}>Se retira y se reinyecta como capital. La base de inversión crece.</div>
      </button>
      <button type="button" onClick={() => onSave({ id: "C-" + uid().slice(0, 5), periodo: period, label: label || `Corte ${period}`, utilidad: totalProfit, splits, decision: "retirar", fondo_id: "FIC" })} className="fb p-4 rounded-xl text-center font-semibold transition-all hover:brightness-110" style={{ background: "rgba(74,222,128,.12)", border: "1px solid rgba(74,222,128,.2)", color: "var(--gn)" }}>
        <div className="text-2xl mb-1">💰</div><div>Retirar Utilidades</div>
        <div className="text-xs font-normal mt-1" style={{ color: "var(--cd)" }}>La utilidad sale del fondo. Cada socio recibe su parte.</div>
      </button>
    </div>)}

    {totalProfit === 0 && !exists && periodSells.length > 0 && (<div className="flex gap-3"><BtnP onClick={() => onSave({ id: "C-" + uid().slice(0, 5), periodo: period, label: label || `Corte ${period}`, utilidad: 0, splits, decision: "reinvertir", fondo_id: "FIC" })}>Cerrar Corte (Sin utilidad)</BtnP><BtnS onClick={onClose}>Cancelar</BtnS></div>)}
    {(exists || periodSells.length === 0) && <div className="flex gap-3"><BtnS onClick={onClose}>Cerrar</BtnS></div>}
  </div>;
}
