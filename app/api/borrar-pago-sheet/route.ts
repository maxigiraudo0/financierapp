import { NextRequest, NextResponse } from 'next/server'
import { getSheetsClient } from '@/lib/google'
import { supabase } from '@/lib/supabase'

// Limpia la entrega (H y J) de una fila del sheet del cliente
export async function POST(req: NextRequest) {
  try {
    const { cliente_id, fila, rango } = await req.json()
    if (!cliente_id || (!fila && !rango)) return NextResponse.json({ ok: false, skip: 'falta dato' })

    const { data: cli } = await supabase.from('clientes').select('sheet_id, sheet_gid').eq('id', cliente_id).single()
    if (!cli?.sheet_id || !cli?.sheet_gid) return NextResponse.json({ ok: false, skip: 'sin sheet' })

    const sheets = await getSheetsClient(false)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: cli.sheet_id, fields: 'sheets.properties' })
    const sheet = meta.data.sheets?.find(s => String(s.properties?.sheetId) === String(cli.sheet_gid))
    if (!sheet) return NextResponse.json({ ok: false, skip: 'sin solapa' })
    const title = sheet.properties?.title || ''

    const rangeA1 = rango ? `'${title}'!${rango}` : `'${title}'!H${fila}:J${fila}`
    await sheets.spreadsheets.values.clear({ spreadsheetId: cli.sheet_id, range: rangeA1 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
