-- =============================================
-- FINANCIERA APP - Schema v2
-- =============================================

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telefono TEXT,
  password_hash TEXT NOT NULL,
  activo BOOLEAN DEFAULT true,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas USA
CREATE TABLE IF NOT EXISTS cuentas_usa (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  banco TEXT,
  notas TEXT,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas Pesos TT
CREATE TABLE IF NOT EXISTS cuentas_pesos_tt (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  alias TEXT,
  cbu TEXT,
  notas TEXT,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operaciones
CREATE TABLE IF NOT EXISTS operaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  -- Montos
  monto_usd NUMERIC(18,2) DEFAULT 0,
  monto_usdt NUMERIC(18,4) DEFAULT 0,
  monto_pesos NUMERIC(18,2) DEFAULT 0,
  monto_eur NUMERIC(18,2) DEFAULT 0,
  -- Para cable y USDT en %
  porcentaje NUMERIC(6,4),
  comision_usd NUMERIC(18,2),
  -- Tipo de cambio
  tipo_cambio NUMERIC(14,4),
  -- Cuenta asociada
  cuenta_usa_id UUID REFERENCES cuentas_usa(id) ON DELETE SET NULL,
  cuenta_pesos_id UUID REFERENCES cuentas_pesos_tt(id) ON DELETE SET NULL,
  -- Extra
  descripcion TEXT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saldo en la calle
CREATE TABLE IF NOT EXISTS saldo_calle (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  moneda TEXT NOT NULL CHECK (moneda IN ('USD','ARS','USDT','EUR')),
  monto NUMERIC(18,2) NOT NULL,
  descripcion TEXT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cierre diario
CREATE TABLE IF NOT EXISTS cierres_diarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  saldo_usd_cash NUMERIC(18,2) DEFAULT 0,
  saldo_usd_transfer NUMERIC(18,2) DEFAULT 0,
  saldo_usdt NUMERIC(18,4) DEFAULT 0,
  saldo_eur NUMERIC(18,2) DEFAULT 0,
  saldo_pesos_transfer NUMERIC(18,2) DEFAULT 0,
  saldo_pesos_cash NUMERIC(18,2) DEFAULT 0,
  saldo_cuentas_usa NUMERIC(18,2) DEFAULT 0,
  saldo_calle_usd NUMERIC(18,2) DEFAULT 0,
  saldo_calle_ars NUMERIC(18,2) DEFAULT 0,
  notas TEXT,
  cerrado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_operaciones_cliente ON operaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_fecha ON operaciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_operaciones_tipo ON operaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_saldo_calle_cliente ON saldo_calle(cliente_id);

-- Permisos
ALTER TABLE clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE operaciones DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_usa DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_pesos_tt DISABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_calle DISABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_diarios DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
