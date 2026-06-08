import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gdzqawpuhkujmvxekvdt.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkenFhd3B1aGt1am12eGVrdmR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQyMDc0MywiZXhwIjoyMDk1OTk2NzQzfQ.ut5qf4g_evV5zXWPqocmGVEmfyvLR-gd1WSuBkkLgoE'

export const supabase = createClient(supabaseUrl, supabaseServiceKey)
export const supabaseAdmin = supabase

export type OperationType =
  // USD
  | 'compra_usd_cash' | 'venta_usd_cash'
  | 'compra_usd_transfer' | 'venta_usd_transfer'
  // Cable (%)
  | 'bajada_cable' | 'bajada_cable_pesos' | 'bajada_cable_pesos_tt' | 'subida_cable' | 'subida_cable_usdt'
  // USDT
  | 'compra_usdt_cash' | 'venta_usdt_cash'
  | 'compra_usdt_pesos' | 'venta_usdt_pesos'
  // Euros
  | 'compra_eur_ars' | 'venta_eur_ars'
  | 'compra_eur_usd' | 'venta_eur_usd'
  // Saldos iniciales
  | 'saldo_inicial_usd' | 'saldo_inicial_usdt'
  | 'saldo_inicial_pesos_tt' | 'saldo_inicial_pesos_cash'
  | 'saldo_inicial_cuenta_usa' | 'saldo_inicial_eur'
  | 'ajuste_saldo'
  // Gastos
  | 'gasto_usd' | 'gasto_usdt' | 'gasto_ars_cash' | 'gasto_ars_tt' | 'gasto_usa'
  // Ajustes por caja (pueden ser + o -)
  | 'ajuste_usd' | 'ajuste_usdt' | 'ajuste_eur' | 'ajuste_ars_cash' | 'ajuste_ars_tt' | 'ajuste_usa'
  // Cobros y pagos de calle
  | 'cobro_deuda_usd' | 'cobro_deuda_ars' | 'cobro_deuda_usdt' | 'cobro_deuda_eur'
  | 'pago_deuda_usd'  | 'pago_deuda_ars'  | 'pago_deuda_usdt'  | 'pago_deuda_eur'
  // Préstamos (sale de la caja, el cliente queda debiendo)
  | 'prestamo_ars' | 'prestamo_ars_tt' | 'prestamo_usdt' | 'prestamo_usd'

export const OPERATION_LABELS: Record<OperationType, string> = {
  compra_usd_cash: 'Compra USD Cash',
  venta_usd_cash: 'Venta USD Cash',
  compra_usd_transfer: 'Compra USD Transfer',
  venta_usd_transfer: 'Venta USD Transfer',
  bajada_cable: 'Bajada de Cable (USD cash)',
  bajada_cable_pesos: 'Bajada de Cable (Pesos cash)',
  bajada_cable_pesos_tt: 'Bajada de Cable (Pesos TT)',
  subida_cable: 'Subida de Cable',
  subida_cable_usdt: 'Subida de Cable por USDT',
  compra_usdt_cash: 'Compra USDT / USD Cash',
  venta_usdt_cash: 'Venta USDT / USD Cash',
  compra_usdt_pesos: 'Compra USDT / Pesos TT',
  venta_usdt_pesos: 'Venta USDT / Pesos TT',
  compra_eur_ars: 'Compra EUR / ARS',
  venta_eur_ars: 'Venta EUR / ARS',
  compra_eur_usd: 'Compra EUR / USD',
  venta_eur_usd: 'Venta EUR / USD',
  saldo_inicial_usd: '📥 Saldo Inicial USD',
  saldo_inicial_usdt: '📥 Saldo Inicial USDT',
  saldo_inicial_pesos_tt: '📥 Saldo Inicial Pesos TT',
  saldo_inicial_pesos_cash: '📥 Saldo Inicial Pesos Físico',
  saldo_inicial_cuenta_usa: '📥 Saldo Inicial Cuenta USA',
  saldo_inicial_eur: '📥 Saldo Inicial EUR',
  ajuste_saldo: '⚙️ Ajuste de Saldo',
  gasto_usd: '💸 Gasto USD',
  gasto_usdt: '💸 Gasto USDT',
  gasto_ars_cash: '💸 Gasto Pesos Físico',
  gasto_ars_tt: '💸 Gasto Pesos TT',
  gasto_usa: '💸 Gasto Cuenta USA',
  ajuste_usd: '⚙️ Ajuste USD',
  ajuste_usdt: '⚙️ Ajuste USDT',
  ajuste_eur: '⚙️ Ajuste EUR',
  ajuste_ars_cash: '⚙️ Ajuste Pesos Físico',
  ajuste_ars_tt: '⚙️ Ajuste Pesos TT',
  ajuste_usa: '⚙️ Ajuste Cuenta USA',
  cobro_deuda_usd:  '💰 Cobro de deuda USD',
  cobro_deuda_ars:  '💰 Cobro de deuda ARS',
  cobro_deuda_usdt: '💰 Cobro de deuda USDT',
  cobro_deuda_eur:  '💰 Cobro de deuda EUR',
  pago_deuda_usd:   '💸 Pago de deuda USD',
  pago_deuda_ars:   '💸 Pago de deuda ARS',
  pago_deuda_usdt:  '💸 Pago de deuda USDT',
  pago_deuda_eur:   '💸 Pago de deuda EUR',
  prestamo_ars:     '🤝 Préstamo ARS (efectivo)',
  prestamo_ars_tt:  '🤝 Préstamo ARS TT',
  prestamo_usdt:    '🤝 Préstamo USDT',
  prestamo_usd:     '🤝 Préstamo USD',
}

export const OPERATION_GROUPS: { label: string; types: OperationType[] }[] = [
  {
    label: '💵 USD',
    types: ['compra_usd_cash', 'venta_usd_cash', 'compra_usd_transfer', 'venta_usd_transfer'],
  },
  {
    label: '🔌 Cable',
    types: ['bajada_cable', 'bajada_cable_pesos', 'bajada_cable_pesos_tt', 'subida_cable', 'subida_cable_usdt'],
  },
  {
    label: '◎ USDT',
    types: ['compra_usdt_cash', 'venta_usdt_cash', 'compra_usdt_pesos', 'venta_usdt_pesos'],
  },
  {
    label: '🇪🇺 Euros',
    types: ['compra_eur_ars', 'venta_eur_ars', 'compra_eur_usd', 'venta_eur_usd'],
  },
  {
    label: '📥 Saldos',
    types: ['saldo_inicial_usd', 'saldo_inicial_usdt', 'saldo_inicial_eur', 'saldo_inicial_pesos_tt', 'saldo_inicial_pesos_cash', 'saldo_inicial_cuenta_usa', 'ajuste_saldo'],
  },
  {
    label: '💸 Gastos',
    types: ['gasto_usd', 'gasto_usdt', 'gasto_ars_cash', 'gasto_ars_tt', 'gasto_usa'],
  },
  {
    label: '⚙️ Ajustes',
    types: ['ajuste_usd', 'ajuste_usdt', 'ajuste_eur', 'ajuste_ars_cash', 'ajuste_ars_tt', 'ajuste_usa'],
  },
  {
    label: '💰 Cobros y Pagos Calle',
    types: ['cobro_deuda_usd','cobro_deuda_ars','cobro_deuda_usdt','cobro_deuda_eur','pago_deuda_usd','pago_deuda_ars','pago_deuda_usdt','pago_deuda_eur'],
  },
  {
    label: '🤝 Préstamos',
    types: ['prestamo_ars', 'prestamo_ars_tt', 'prestamo_usdt', 'prestamo_usd'],
  },
]

export const OPERATION_COLORS: Record<string, string> = {
  compra_usd_cash: 'bg-green-100 text-green-800',
  venta_usd_cash: 'bg-red-100 text-red-800',
  compra_usd_transfer: 'bg-emerald-100 text-emerald-800',
  venta_usd_transfer: 'bg-rose-100 text-rose-800',
  bajada_cable: 'bg-yellow-100 text-yellow-800',
  bajada_cable_pesos: 'bg-orange-100 text-orange-800',
  bajada_cable_pesos_tt: 'bg-orange-100 text-orange-800',
  subida_cable: 'bg-amber-100 text-amber-800',
  subida_cable_usdt: 'bg-blue-100 text-blue-800',
  compra_usdt_cash: 'bg-blue-100 text-blue-800',
  venta_usdt_cash: 'bg-purple-100 text-purple-800',
  compra_usdt_pesos: 'bg-cyan-100 text-cyan-800',
  venta_usdt_pesos: 'bg-violet-100 text-violet-800',
  compra_eur_ars: 'bg-orange-100 text-orange-800',
  venta_eur_ars: 'bg-pink-100 text-pink-800',
  compra_eur_usd: 'bg-teal-100 text-teal-800',
  venta_eur_usd: 'bg-indigo-100 text-indigo-800',
  saldo_inicial_usd: 'bg-gray-100 text-gray-700',
  saldo_inicial_usdt: 'bg-gray-100 text-gray-700',
  saldo_inicial_pesos_tt: 'bg-gray-100 text-gray-700',
  saldo_inicial_cuenta_usa: 'bg-gray-100 text-gray-700',
  ajuste_saldo: 'bg-gray-200 text-gray-700',
  ajuste_usd: 'bg-gray-200 text-gray-700',
  ajuste_usdt: 'bg-gray-200 text-gray-700',
  ajuste_eur: 'bg-gray-200 text-gray-700',
  ajuste_ars_cash: 'bg-gray-200 text-gray-700',
  ajuste_ars_tt: 'bg-gray-200 text-gray-700',
  ajuste_usa: 'bg-gray-200 text-gray-700',
  prestamo_ars: 'bg-indigo-100 text-indigo-800',
  prestamo_ars_tt: 'bg-indigo-100 text-indigo-800',
  prestamo_usdt: 'bg-indigo-100 text-indigo-800',
  prestamo_usd: 'bg-indigo-100 text-indigo-800',
}

// Which operation types use porcentaje
export const USES_PORCENTAJE: OperationType[] = [
  'bajada_cable', 'subida_cable', 'compra_usdt_cash', 'venta_usdt_cash'
]
