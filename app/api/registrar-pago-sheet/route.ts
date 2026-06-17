import { NextRequest, NextResponse } from 'next/server'
import { getSheetsClient } from '@/lib/google'
import { supabase } from '@/lib/supabase'

const colLetter = (i: number) => String.fromCharCode(65 + i) // 0->A, 7->H, 9->J...

export async function POST(req: NextRequest) {
  try {
    const { cliente_id, fecha, monto_usd, fila: filaFija } = await req.json()
    if (!cliente_id || !monto_usd) return NextResponse.json({ error: 'Falta cliente_id o monto_usd' }, { status: 400 })

    const { data: cli } = await supabase.from('clientes').select('sheet_id, sheet_gid, sheet_col_fecha, sheet_col_monto, sheet_col_concepto, sheet_fila_inicio').eq('id', cliente_id).single()
    if (!cli?.sheet_id || !cli?.sheet_gid) return NextResponse.json({ ok: false, skip: 'sin sheet' })

    const sheets = await getSheetsClient(false)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: cli.sheet_id, fields: 'sheets.properties' })
    const sheet = meta.data.sheets?.find(s => String(s.properties?.sheetId) === String(cli.sheet_gid))
    if (!sheet) return NextResponse.json({ error: 'No encontré la solapa del cliente' }, { status: 400 })
    const title = sheet.properties?.title || ''

    // Leer grilla para detectar el layout de entregas
    const grid = (await sheets.spreadsheets.values.get({ spreadsheetId: cli.sheet_id, range: `'${title}'!A1:N80` })).data.values || []
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()

    let fechaCol = -1, montoCol = -1, conceptoCol = -1, startRow = -1, endRow = 9999

    // Config explícita del cliente (si está cargada) tiene prioridad
    const colIdx = (letra?: string | null) => letra ? letra.toUpperCase().charCodeAt(0) - 65 : -1
    if (cli.sheet_col_fecha && cli.sheet_col_monto && cli.sheet_fila_inicio) {
      fechaCol = colIdx(cli.sheet_col_fecha)
      montoCol = colIdx(cli.sheet_col_monto)
      conceptoCol = colIdx(cli.sheet_col_concepto)
      startRow = cli.sheet_fila_inicio
    }

    // Layout A (Bartolucci): header con FECHA/CONCEPTO/MONTO
    if (startRow === -1)
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || []
      const cIdx = row.findIndex(c => norm(c) === 'CONCEPTO')
      if (cIdx >= 0) {
        conceptoCol = cIdx
        // FECHA a la izquierda, MONTO a la derecha en la misma fila
        for (let k = 0; k < row.length; k++) {
          if (norm(row[k]) === 'FECHA') fechaCol = k
          if (norm(row[k]) === 'MONTO') montoCol = k
        }
        if (fechaCol === -1) fechaCol = cIdx - 1
        if (montoCol === -1) montoCol = cIdx + 1
        startRow = r + 2 // 1-indexed, fila siguiente al header
        break
      }
    }

    // Layout B (USD: Mascanfroni/Fix): rótulo "ENTREGAS USD" en col H, monto en J
    if (startRow === -1) {
      for (let r = 0; r < grid.length; r++) {
        const h = norm(grid[r]?.[7])
        if (h.includes('ENTREGAS')) { fechaCol = 7; montoCol = 9; startRow = r + 2 }
        if (h === 'SALDO' && startRow !== -1 && endRow === 9999) endRow = r // 1-indexed exclusivo
      }
    }

    if (startRow === -1) return NextResponse.json({ error: 'No encontré la zona de entregas en el sheet del cliente' }, { status: 400 })

    // Fila destino
    const d = new Date((fecha || new Date().toISOString().split('T')[0]) + 'T12:00:00')
    const fechaTxt = `${d.getDate()}/${d.getMonth() + 1}`

    // Anti-duplicado: si ya hay una entrega con MISMA fecha y MISMO monto (cargada
    // a mano en el sheet), no la volvemos a escribir.
    const parseNum = (v: unknown) => {
      const t = String(v ?? '').replace(/[$\s]/g, '').replace(/,/g, '')
      const n = parseFloat(t); return isNaN(n) ? NaN : n
    }
    const diaMes = (v: unknown) => {
      const m = String(v ?? '').match(/(\d{1,2})\D+(\d{1,2})/)
      return m ? `${+m[1]}/${+m[2]}` : ''
    }
    const objetivo = Number(monto_usd)
    for (let r = startRow; r <= Math.min(endRow + 1, 200); r++) {
      const row = grid[r - 1] || []
      const fOk = diaMes(row[fechaCol]) === fechaTxt
      const mCell = parseNum(row[montoCol])
      if (fOk && !isNaN(mCell) && Math.abs(mCell - objetivo) < 1) {
        return NextResponse.json({ ok: true, skip: 'ya cargada manualmente en el sheet', fila: r, monto: objetivo })
      }
    }

    let fila = filaFija || -1
    if (!filaFija) {
      for (let r = startRow; r <= endRow + 1 && r < 200; r++) {
        const v = grid[r - 1]?.[fechaCol]
        if (!v || String(v).trim() === '') { fila = r; break }
      }
      if (fila === -1) return NextResponse.json({ error: 'No hay espacio libre en la zona de entregas' }, { status: 400 })
    }

    // Escribir
    await sheets.spreadsheets.values.update({ spreadsheetId: cli.sheet_id, range: `'${title}'!${colLetter(fechaCol)}${fila}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[fechaTxt]] } })
    if (conceptoCol >= 0) {
      await sheets.spreadsheets.values.update({ spreadsheetId: cli.sheet_id, range: `'${title}'!${colLetter(conceptoCol)}${fila}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [['entrega eft']] } })
    }
    await sheets.spreadsheets.values.update({ spreadsheetId: cli.sheet_id, range: `'${title}'!${colLetter(montoCol)}${fila}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[Number(monto_usd)]] } })

    const rango = `${colLetter(fechaCol)}${fila}:${colLetter(montoCol)}${fila}`
    return NextResponse.json({ ok: true, fila, rango, monto: Number(monto_usd) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
