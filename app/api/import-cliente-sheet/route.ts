import { NextRequest, NextResponse } from 'next/server'
import { getSheetsClient } from '@/lib/google'
import { supabase } from '@/lib/supabase'

function parseMonto(v: unknown): number {
  if (typeof v === 'number') return v
  if (!v) return 0
  const t = String(v).replace(/\$/g, '').replace(/\s/g, '').replace(/,/g, '').trim()
  const n = parseFloat(t)
  return isNaN(n) ? 0 : n
}

export async function POST(req: NextRequest) {
  try {
    const { cliente_id, sheet_id, gid, celda, auto_mes } = await req.json()
    if (!cliente_id || !sheet_id || !gid) return NextResponse.json({ error: 'Falta cliente_id, sheet_id o gid' }, { status: 400 })
    const cell = (celda || 'J10').toUpperCase()

    const sheets = await getSheetsClient(true)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheet_id, fields: 'sheets.properties' })
    const allSheets = meta.data.sheets || []

    // Elegir solapa: por mes actual (auto) o por gid
    let sheet
    if (auto_mes) {
      const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
      const now = new Date()
      const mesActual = MESES[now.getMonth()]
      const anio2 = String(now.getFullYear()).slice(-2)
      const cand = allSheets.filter(s => (s.properties?.title || '').toUpperCase().includes(mesActual))
      sheet = cand.find(s => (s.properties?.title || '').includes(anio2)) || cand[0]
    }
    if (!sheet) sheet = allSheets.find(s => String(s.properties?.sheetId) === String(gid))
    if (!sheet) return NextResponse.json({ error: `No encontré la solapa` }, { status: 400 })
    const title = sheet.properties?.title || ''
    const gidUsado = String(sheet.properties?.sheetId)

    // Leer la celda puntual (ej J10)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheet_id, range: `'${title}'!${cell}`, valueRenderOption: 'UNFORMATTED_VALUE',
    })
    const valor = parseMonto(resp.data.values?.[0]?.[0])

    // Reemplazar el saldo "le debo USD" generado desde el sheet del cliente
    await supabase.from('saldo_calle').delete().eq('cliente_id', cliente_id).eq('origen', 'cliente_sheet')
    if (valor > 0) {
      await supabase.from('saldo_calle').insert({
        cliente_id, moneda: 'USD', monto: Math.round(valor * 100) / 100,
        direccion: 'debo', descripcion: `Liquidación USD (sheet, ${cell})`,
        fecha: new Date().toISOString().split('T')[0], activo: true, origen: 'cliente_sheet',
      })
    }
    // Guardar config en el cliente
    await supabase.from('clientes').update({ sheet_id, sheet_gid: gidUsado, sheet_celda: cell }).eq('id', cliente_id)

    return NextResponse.json({ ok: true, solapa: title, celda: cell, valor })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
