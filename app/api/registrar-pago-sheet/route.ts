import { NextRequest, NextResponse } from 'next/server'
import { getSheetsClient } from '@/lib/google'
import { supabase } from '@/lib/supabase'

// Registra una entrega USD (pago) en el sheet del cliente: H=fecha, J=monto, desde fila 6
export async function POST(req: NextRequest) {
  try {
    const { cliente_id, fecha, monto_usd } = await req.json()
    if (!cliente_id || !monto_usd) return NextResponse.json({ error: 'Falta cliente_id o monto_usd' }, { status: 400 })

    // Config del sheet del cliente
    const { data: cli } = await supabase.from('clientes').select('sheet_id, sheet_gid').eq('id', cliente_id).single()
    if (!cli?.sheet_id || !cli?.sheet_gid) {
      return NextResponse.json({ ok: false, skip: 'El cliente no tiene sheet vinculado' })
    }

    const sheets = await getSheetsClient(false)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: cli.sheet_id, fields: 'sheets.properties' })
    const sheet = meta.data.sheets?.find(s => String(s.properties?.sheetId) === String(cli.sheet_gid))
    if (!sheet) return NextResponse.json({ error: 'No encontré la solapa del cliente' }, { status: 400 })
    const title = sheet.properties?.title || ''

    // Buscar primera fila libre en la zona de entregas (H6:H9, la fila 10 es SALDO)
    const FILA_INI = 6, FILA_FIN = 9
    const colH = await sheets.spreadsheets.values.get({ spreadsheetId: cli.sheet_id, range: `'${title}'!H${FILA_INI}:H${FILA_FIN}` })
    const filas = colH.data.values || []
    let libre = -1
    for (let r = FILA_INI; r <= FILA_FIN; r++) {
      const v = filas[r - FILA_INI]?.[0]
      if (!v || String(v).trim() === '') { libre = r; break }
    }
    if (libre === -1) {
      return NextResponse.json({ error: `No hay espacio libre en entregas (H${FILA_INI}:H${FILA_FIN}). Ampliá la zona en el sheet.` }, { status: 400 })
    }

    // Fecha en formato d/m
    const d = new Date((fecha || new Date().toISOString().split('T')[0]) + 'T12:00:00')
    const fechaTxt = `${d.getDate()}/${d.getMonth() + 1}`

    // Escribir H (fecha) y J (monto USD) en esa fila
    await sheets.spreadsheets.values.update({
      spreadsheetId: cli.sheet_id, range: `'${title}'!H${libre}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [[fechaTxt]] },
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId: cli.sheet_id, range: `'${title}'!J${libre}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [[Number(monto_usd)]] },
    })

    return NextResponse.json({ ok: true, fila: libre, fecha: fechaTxt, monto: Number(monto_usd) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
