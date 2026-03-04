-- ══════════════════════════════════════════════════════════════════════════════
--  TWR OS v13 · MIGRATION — Ejecutar DESPUÉS del schema v9 existente
--  Agrega: catálogo público, settings, refs custom, docs obligatorios
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COLUMNAS NUEVAS EN PIEZAS — catálogo público + fotos + fondos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS publish_catalog BOOLEAN DEFAULT false;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS catalog_description TEXT;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS catalog_order INTEGER DEFAULT 0;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS fondo_id TEXT DEFAULT 'FIC';
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'adquisicion'
  CHECK (entry_type IN ('adquisicion','trade_in','consignacion'));
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS exit_type TEXT
  CHECK (exit_type IN ('venta','trade_out','retorno_consignacion'));
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS exit_fund TEXT;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS trade_ref TEXT;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS auth_level TEXT DEFAULT 'NONE'
  CHECK (auth_level IN ('NONE','VISUAL','SERIAL','MOVEMENT','THIRD','BRAND'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_piezas_sku ON piezas(sku) WHERE sku IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CUSTOM WATCH REFERENCES — refs escritas manualmente por el usuario
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_referencias (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand         TEXT NOT NULL,
  model         TEXT NOT NULL,
  ref_number    TEXT NOT NULL,
  ai_validated  BOOLEAN DEFAULT false,
  ai_response   JSONB,                     -- Respuesta completa de la IA
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brand, model, ref_number)
);

ALTER TABLE custom_referencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "custom_refs_all_auth" ON custom_referencias;
CREATE POLICY "custom_refs_all_auth" ON custom_referencias FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Política pública para lectura (catálogo público necesita leer refs)
DROP POLICY IF EXISTS "custom_refs_public_read" ON custom_referencias;
CREATE POLICY "custom_refs_public_read" ON custom_referencias FOR SELECT TO anon USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SETTINGS — Configuración del sistema (WhatsApp, docs obligatorios, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_all_auth" ON app_settings;
CREATE POLICY "settings_all_auth" ON app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Anon read for public catalog to get WhatsApp number
DROP POLICY IF EXISTS "settings_public_read" ON app_settings;
CREATE POLICY "settings_public_read" ON app_settings FOR SELECT TO anon USING (key IN ('whatsapp_number','catalog_config','business_name'));

-- Seed default settings
INSERT INTO app_settings (key, value) VALUES
  ('whatsapp_number', '"5219991234567"'),
  ('business_name', '"The Wrist Room"'),
  ('catalog_config', '{"show_prices": true, "show_reference": true, "currency": "MXN"}'),
  ('required_docs', '{"compra": ["identificacion","contrato"], "venta": ["identificacion","contrato","comprobante_pago"], "trade": ["identificacion","contrato"]}'),
  ('doc_types', '["identificacion","contrato","factura","comprobante_pago","comprobante_deposito","tarjeta_garantia","certificado_autenticidad","otro"]')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FONDOS — Tabla de fondos de inversión
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fondos (
  id          TEXT PRIMARY KEY,             -- 'FIC', 'FP1', 'FP2'
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  tipo        TEXT NOT NULL CHECK (tipo IN ('compartido','personal')),
  split       JSONB,                       -- {"fernando": 40, "socioA": 30, "socioB": 30}
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fondos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fondos_all_auth" ON fondos;
CREATE POLICY "fondos_all_auth" ON fondos FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO fondos (id, nombre, descripcion, tipo, split) VALUES
  ('FIC', 'Fondo de Inversión Compartida', 'Fondo común. Fernando 40% · Socio A 30% · Socio B 30%', 'compartido', '{"fernando": 40, "socioA": 30, "socioB": 30}'),
  ('FP1', 'Fondo Personal 1 — Fernando', 'Operaciones independientes de Fernando. 100% utilidad.', 'personal', '{"fernando": 100}'),
  ('FP2', 'Fondo Personal 2 — La Sociedad', 'Operaciones de La Sociedad. 50/50 entre socios.', 'personal', '{"socioA": 50, "socioB": 50}')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CORTES MENSUALES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cortes (
  id          TEXT PRIMARY KEY,
  periodo     TEXT NOT NULL,               -- '2026-01'
  label       TEXT,
  utilidad    NUMERIC(14,2) DEFAULT 0,
  splits      JSONB,                       -- {"fernando": 9200, "socioA": 6900, "socioB": 6900}
  decision    TEXT DEFAULT 'reinvertir',
  fondo_id    TEXT DEFAULT 'FIC' REFERENCES fondos(id),
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cortes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cortes_all_auth" ON cortes;
CREATE POLICY "cortes_all_auth" ON cortes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TRANSACCIONES UNIFICADAS (complementa ventas/pagos existentes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transacciones (
  id          TEXT PRIMARY KEY,
  fecha       DATE NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('CAPITAL','BUY','SELL','TRADE','EXPENSE')),
  pieza_id    TEXT REFERENCES piezas(id),
  monto       NUMERIC(14,2) DEFAULT 0,
  fondo_id    TEXT REFERENCES fondos(id),
  descripcion TEXT,
  metodo_pago TEXT,
  partner_id  TEXT,
  trade_ref   TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_fecha ON transacciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_tx_fondo ON transacciones(fondo_id);
CREATE INDEX IF NOT EXISTS idx_tx_tipo  ON transacciones(tipo);

ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tx_all_auth" ON transacciones;
CREATE POLICY "tx_all_auth" ON transacciones FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. POLÍTICAS PÚBLICAS — para el catálogo público (anon access)
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo piezas marcadas como publish_catalog = true
DROP POLICY IF EXISTS "piezas_public_catalog" ON piezas;
CREATE POLICY "piezas_public_catalog" ON piezas FOR SELECT TO anon
  USING (publish_catalog = true AND status = 'Disponible');

-- Fotos públicas de piezas en catálogo
DROP POLICY IF EXISTS "fotos_public_read" ON pieza_fotos;
CREATE POLICY "fotos_public_read" ON pieza_fotos FOR SELECT TO anon
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM piezas
      WHERE piezas.id = pieza_fotos.pieza_id
        AND piezas.publish_catalog = true
        AND piezas.status = 'Disponible'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. STORAGE BUCKET POLICIES (ejecutar en Supabase Dashboard → Storage)
-- ─────────────────────────────────────────────────────────────────────────────
-- Para fotos_piezas (público):
--   - SELECT: public (ya debería estar)
--   - INSERT/UPDATE/DELETE: authenticated only
--
-- Para documentos (privado):
--   - Todo: authenticated only
--
-- Nota: estas políticas se configuran en el Dashboard de Supabase,
--       no se pueden crear con SQL puro.

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'v13 migration complete' AS status;
