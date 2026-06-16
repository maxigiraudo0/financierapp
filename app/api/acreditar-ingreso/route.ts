import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Mantiene en la calle UNA deuda general "le debo ARS" por reca = los tickets
// que ingresaron pero todavía no se acreditaron a un cliente.
// Si se pasa `montoExplicito` (ej: celda "NO ACREDITADOS TOTAL" del sheet) se
// usa ese valor; si no, suma los tickets pendientes de la bandeja.
export async function recalcPendienteCalle(cuenta_pesos_id: string, montoExplicito?: number) {
  const { data: cuenta } = await supabase.from('cuentas_pesos_tt').select('nombre').eq('id', cuenta_pesos_id).single()
  let total: number
  if (typeof montoExplicito === 'number') {
    total = montoExplicito
  } else {
    const { data: pend } = await supabase.from('ingresos_pendientes')
      .select('monto_ars').eq('cuenta_pesos_id', cuenta_pesos_id).eq('procesado', false)
    total = (pend || []).reduce((s, p) => s + Number(p.monto_ars), 0)
  }
  await supabase.from('saldo_calle').delete().eq('ref_cuenta', cuenta_pesos_id).eq('origen', 'ingreso_pendiente')
  if (total > 0.001) {
    const clienteId = await getClienteSinAcreditar()
    await supabase.from('saldo_calle').insert({
      cliente_id: clienteId, moneda: 'ARS', monto: Math.round(total * 100) / 100,
      direccion: 'debo', descripcion: `Tickets sin acreditar (${cuenta?.nombre || 'reca'})`,
      fecha: new Date().toISOString().split('T')[0], activo: true,
      origen: 'ingreso_pendiente', ref_cuenta: cuenta_pesos_id,
    })
  }
}

// Cliente "comodín" que agrupa las deudas de tickets sin acreditar (busca o crea)
async function getClienteSinAcreditar(): Promise<string | null> {
  const { data: ex } = await supabase.from('clientes').select('id').eq('nombre', 'Tickets sin acreditar').maybeSingle()
  if (ex?.id) return ex.id
  const { data: nuevo } = await supabase.from('clientes')
    .insert({ nombre: 'Tickets sin acreditar', email: 'ticketssinacreditar@reca.local', password_hash: 'temp123', activo: true })
    .select('id').single()
  return nuevo?.id || null
}

// Acredita un ingreso pendiente a un cliente → genera crédito "le debo ARS"
// (la financiera le queda debiendo al cliente el ARS que depositó).
export async function POST(req: NextRequest) {
  try {
    const { pendiente_id, cliente_id } = await req.json()
    if (!pendiente_id || !cliente_id) {
      return NextResponse.json({ error: 'Falta pendiente_id o cliente_id' }, { status: 400 })
    }

    const { data: pend } = await supabase.from('ingresos_pendientes').select('*').eq('id', pendiente_id).single()
    if (!pend) return NextResponse.json({ error: 'Ingreso pendiente no encontrado' }, { status: 404 })

    const monto = Number(pend.monto_ars)
    const { error: e1 } = await supabase.from('saldo_calle').insert({
      cliente_id, moneda: 'ARS', monto: Math.round(monto * 100) / 100,
      direccion: 'debo', descripcion: `Acreditación ticket (${pend.nombre_ticket || 'sin nombre'})`,
      fecha: pend.fecha, activo: true, origen: 'ingreso_acreditado', ref_cuenta: pend.cuenta_pesos_id,
    })
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    await supabase.from('ingresos_pendientes').update({ procesado: true }).eq('id', pendiente_id)

    // Recalcular la deuda general "pendiente de acreditar" de esa reca
    await recalcPendienteCalle(pend.cuenta_pesos_id)

    return NextResponse.json({ ok: true, monto, moneda: 'ARS' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
