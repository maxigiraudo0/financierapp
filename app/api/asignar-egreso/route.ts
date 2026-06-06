import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Asigna un egreso pendiente a un cliente → genera deuda "le debo USD"
export async function POST(req: NextRequest) {
  try {
    const { pendiente_id, cliente_id, tc, moneda } = await req.json()
    if (!pendiente_id || !cliente_id) {
      return NextResponse.json({ error: 'Falta pendiente_id o cliente_id' }, { status: 400 })
    }
    const mon = moneda === 'ARS' ? 'ARS' : 'USD'
    if (mon === 'USD' && !tc) return NextResponse.json({ error: 'Falta TC para deuda en USD' }, { status: 400 })

    const { data: pend } = await supabase.from('egresos_pendientes').select('*').eq('id', pendiente_id).single()
    if (!pend) return NextResponse.json({ error: 'Egreso pendiente no encontrado' }, { status: 404 })

    // ARS directo → deuda en pesos | USD → monto/TC
    const monto = mon === 'ARS' ? Number(pend.monto_ars) : Number(pend.monto_ars) / Number(tc)
    const desc = mon === 'ARS' ? 'Egreso reca asignado (ARS)' : `Egreso reca asignado (TC ${tc})`

    const { error: e1 } = await supabase.from('saldo_calle').insert({
      cliente_id, moneda: mon, monto: Math.round(monto * 100) / 100,
      direccion: 'deben', descripcion: desc,
      fecha: pend.fecha, activo: true, origen: 'sheet_asignado', ref_cuenta: pend.cuenta_pesos_id,
    })
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    await supabase.from('egresos_pendientes').update({ procesado: true }).eq('id', pendiente_id)

    return NextResponse.json({ ok: true, monto, moneda: mon })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
