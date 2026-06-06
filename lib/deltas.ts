/**
 * Lógica desde la perspectiva de LA FINANCIERA.
 * Cada operación de trading tiene dos "patas":
 *   - recibo: entra a una caja
 *   - entrego: sale de una caja
 * Si una pata queda pendiente (no se entregó/cobró), esa pata NO mueve la caja
 * (se registra en "En la Calle" en su lugar).
 */

export type CajaKey = 'usd' | 'usdt' | 'eur' | 'ars_cash' | 'ars_tt' | 'usa'

export interface StockDelta {
  usd: number
  usdt: number
  eur: number
  ars_cash: number
  ars_tt: number
  usa: number
}

export const ZERO_DELTA: StockDelta = { usd: 0, usdt: 0, eur: 0, ars_cash: 0, ars_tt: 0, usa: 0 }

interface Op {
  tipo: string
  monto_usd: number
  monto_usdt: number
  monto_pesos: number
  monto_eur: number
  medio?: string | null
  pendiente?: string | null  // 'me_deben' | 'le_debo' | 'ok' | null
  costo_wire?: number | null
  wire_absorbe?: string | null
  comision_usd?: number | null
}

interface Leg { caja: CajaKey; v: number }

// Devuelve las patas de una operación de trading (o null si no es trading)
function tradeLegs(op: Op): { recibo: Leg; entrego: Leg } | null {
  const usd = op.monto_usd || 0
  const usdt = op.monto_usdt || 0
  const pesos = op.monto_pesos || 0
  const eur = op.monto_eur || 0
  switch (op.tipo) {
    case 'compra_usd_cash':     return { recibo: {caja:'usd',v:usd},   entrego: {caja:'ars_cash',v:pesos} }
    case 'venta_usd_cash':      return { recibo: {caja:'ars_cash',v:pesos}, entrego: {caja:'usd',v:usd} }
    case 'compra_usd_transfer': return { recibo: {caja:'usd',v:usd},   entrego: {caja:'ars_tt',v:pesos} }
    case 'venta_usd_transfer':  return { recibo: {caja:'ars_tt',v:pesos}, entrego: {caja:'usd',v:usd} }
    case 'compra_usdt_cash':    return { recibo: {caja:'usdt',v:usdt}, entrego: {caja:'usd',v:usd} }
    case 'venta_usdt_cash':     return { recibo: {caja:'usd',v:usd},   entrego: {caja:'usdt',v:usdt} }
    case 'compra_usdt_pesos':   return { recibo: {caja:'usdt',v:usdt}, entrego: {caja:'ars_tt',v:pesos} }
    case 'venta_usdt_pesos':    return { recibo: {caja:'ars_tt',v:pesos}, entrego: {caja:'usdt',v:usdt} }
    case 'compra_eur_ars':      return { recibo: {caja:'eur',v:eur},   entrego: {caja:'ars_cash',v:pesos} }
    case 'venta_eur_ars':       return { recibo: {caja:'ars_cash',v:pesos}, entrego: {caja:'eur',v:eur} }
    case 'compra_eur_usd':      return { recibo: {caja:'eur',v:eur},   entrego: {caja:'usd',v:usd} }
    case 'venta_eur_usd':       return { recibo: {caja:'usd',v:usd},   entrego: {caja:'eur',v:eur} }
    case 'bajada_cable_pesos':    return { recibo: {caja:'usa',v:usd},   entrego: {caja:'ars_cash',v:pesos} } // entra USA, sale pesos cash
    case 'bajada_cable_pesos_tt': return { recibo: {caja:'usa',v:usd},   entrego: {caja:'ars_tt',v:pesos} }   // entra USA, sale pesos TT
    case 'subida_cable':        return { recibo: {caja:'usd',v:usd},   entrego: {caja:'usa',v:usd} }  // sale de cuenta USA
    case 'subida_cable_usdt':   return { recibo: {caja:'usdt',v:usdt}, entrego: {caja:'usa',v:usd} } // mando cable USA, me pagan USDT
    default: return null
  }
}

function aplicarMedio(d: StockDelta, medio: string | null | undefined, monto: number, signo: number) {
  switch (medio) {
    case 'usd_cash':
    case 'usd_transfer': d.usd += signo * monto; break
    case 'usdt':         d.usdt += signo * monto; break
    case 'pesos_cash':   d.ars_cash += signo * monto; break
    case 'pesos_tt':     d.ars_tt += signo * monto; break
    case 'eur':          d.eur += signo * monto; break
    case 'cuenta_usa':   d.usa += signo * monto; break
  }
}

export function computeDelta(op: Op): StockDelta {
  const d = { ...ZERO_DELTA }
  const { tipo, monto_usd: usd, monto_usdt: usdt, monto_pesos: pesos, monto_eur: eur } = op

  // ── Cobros / pagos de deuda ──
  if (tipo.startsWith('cobro_deuda_')) {
    aplicarMedio(d, op.medio, usd || usdt || pesos || eur, +1)
    return d
  }
  if (tipo.startsWith('pago_deuda_')) {
    aplicarMedio(d, op.medio, usd || usdt || pesos || eur, -1)
    return d
  }

  // ── Bajada de cable ──
  // Entra USD a la cuenta USA (monto recibido en banco) y entregás USD cash
  // menos la comisión (la comisión queda como ganancia).
  if (tipo === 'bajada_cable') {
    const cash = usd - (op.comision_usd || 0)
    if (op.pendiente !== 'me_deben') d.usa += usd          // entra al banco USA
    if (op.pendiente !== 'le_debo')  d.usd -= cash          // entregás cash
    return d
  }

  // ── Operaciones de trading (con patas) ──
  const legs = tradeLegs(op)
  if (legs) {
    // recibo entra (+), salvo que esté pendiente que me lo deban
    if (op.pendiente !== 'me_deben') d[legs.recibo.caja] += legs.recibo.v
    // entrego sale (-), salvo que esté pendiente que yo lo deba
    if (op.pendiente !== 'le_debo') d[legs.entrego.caja] -= legs.entrego.v
    // Wire absorbido por la financiera → gasto extra que sale de la caja USA
    if (op.tipo === 'subida_cable_usdt' && op.wire_absorbe === 'financiera' && op.costo_wire) {
      d.usa -= op.costo_wire
    }
    return d
  }

  // ── Saldos iniciales ──
  switch (tipo) {
    case 'saldo_inicial_usd':        d.usd      += usd;   break
    case 'saldo_inicial_usdt':       d.usdt     += usdt;  break
    case 'saldo_inicial_eur':        d.eur      += eur;   break
    case 'saldo_inicial_pesos_cash': d.ars_cash += pesos; break
    case 'saldo_inicial_pesos_tt':   d.ars_tt   += pesos; break
    case 'saldo_inicial_cuenta_usa': d.usa      += usd;   break
    case 'ajuste_saldo':
      d.usd += usd; d.usdt += usdt; d.eur += eur
      d.ars_cash += pesos; d.ars_tt += pesos; d.usa += usd
      break
    // Gastos (restan de la caja)
    case 'gasto_usd':       d.usd      -= usd;   break
    case 'gasto_usdt':      d.usdt     -= usdt;  break
    case 'gasto_ars_cash':  d.ars_cash -= pesos; break
    case 'gasto_ars_tt':    d.ars_tt   -= pesos; break
    case 'gasto_usa':       d.usa      -= usd;   break
    // Ajustes por caja (suman; usá monto negativo para restar)
    case 'ajuste_usd':      d.usd      += usd;   break
    case 'ajuste_usdt':     d.usdt     += usdt;  break
    case 'ajuste_eur':      d.eur      += eur;   break
    case 'ajuste_ars_cash': d.ars_cash += pesos; break
    case 'ajuste_ars_tt':   d.ars_tt   += pesos; break
    case 'ajuste_usa':      d.usa      += usd;   break
  }
  return d
}

export function sumDeltas(ops: Op[]): StockDelta {
  return ops.reduce((acc, op) => {
    const d = computeDelta(op)
    return {
      usd:      acc.usd      + d.usd,
      usdt:     acc.usdt     + d.usdt,
      eur:      acc.eur      + d.eur,
      ars_cash: acc.ars_cash + d.ars_cash,
      ars_tt:   acc.ars_tt   + d.ars_tt,
      usa:      acc.usa      + d.usa,
    }
  }, { ...ZERO_DELTA })
}
