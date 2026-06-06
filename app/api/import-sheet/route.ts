import { NextRequest, NextResponse } from 'next/server'
import { getSheetsClient } from '@/lib/google'
import { supabase } from '@/lib/supabase'

const DEFAULT_SHEET_ID = '1I4a2J_xJyP5kJQgOwDEvFDGzmZVbOfzz4MRGX6F5sfY'

function parseMonto(v: unknown): number {
  if (typeof v === 'number') return v
  if (!v) return 0
  let t = String(v).replace(/\$/g, '').replace(/\s/g, '').trim()
  t = t.replace(/,/g, '')
  const n = parseFloat(t)
  return isNaN(n) ? 0 : n
}

function parseFecha(v: unknown): string {
  const today = new Date().toISOString().split('T')[0]
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (!m) return today
  const d = m[1].padStart(2, '0'); const mes = m[2].padStart(2, '0')
  let anio = m[3] || '2026'; if (anio.length === 2) anio = '20' + anio
  return `${anio}-${mes}-${d}`
}

export async function POST(req: NextRequest) {
  try {
    const { gid, cuenta_pesos_id, sheet_id, auto_mes } = await req.json()
    if (!cuenta_pesos_id) return NextResponse.json({ error: 'Falta cuenta_pesos_id' }, { status: 400 })
    const SHEET_ID = sheet_id || DEFAULT_SHEET_ID

    const sheets = await getSheetsClient(true)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' })
    const allSheets = meta.data.sheets || []

    // 1. Elegir solapa: por mes actual (auto) o por gid
    const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
    const now = new Date()
    const mesActual = MESES[now.getMonth()]
    const anio2 = String(now.getFullYear()).slice(-2)

    let sheet: typeof allSheets[number] | undefined
    if (auto_mes) {
      // Buscar solapa cuyo título contenga el mes actual (preferir con año)
      const candidatas = allSheets.filter(s => (s.properties?.title || '').toUpperCase().includes(mesActual))
      sheet = candidatas.find(s => (s.properties?.title || '').includes(anio2)) || candidatas[0]
    }
    if (!sheet && gid) sheet = allSheets.find(s => String(s.properties?.sheetId) === String(gid))
    if (!sheet) {
      return NextResponse.json({ error: auto_mes ? `No encontré una solapa de ${mesActual} en el sheet` : `No encontré la solapa con gid ${gid}` }, { status: 400 })
    }
    const title = sheet.properties?.title || ''
    const gidUsado = String(sheet.properties?.sheetId)

    // 2. Leer todos los valores de la solapa (valores calculados, en vivo)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${title}'!A1:Z2000`,
      valueRenderOption: 'FORMATTED_VALUE',
    })
    const rows = resp.data.values || []

    // 3. SALDO oficial: buscar la etiqueta exacta "SALDO" y tomar el primer número a su derecha
    let saldoOficial = 0
    for (const row of rows) {
      const idx = (row || []).findIndex(c => String(c).trim().toUpperCase() === 'SALDO')
      if (idx >= 0) {
        for (let k = idx + 1; k < row.length; k++) {
          const n = parseMonto(row[k])
          if (n !== 0 || String(row[k]).trim() !== '') { saldoOficial = n; break }
        }
        break
      }
    }

    // 4. Clientes para matchear
    const { data: clientes } = await supabase.from('clientes').select('id, nombre')
    const mapCli = new Map((clientes || []).map(c => [c.nombre.toLowerCase().trim(), c.id]))
    const fechaRe = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/

    // 4b. Auto-crear clientes que figuran en el sheet y no existen
    const nombresSheet = new Set<string>()
    for (let i = 1; i < rows.length; i++) {
      const c = rows[i] || []
      if (fechaRe.test(String(c[0] || '')) && parseMonto(c[1]) > 0 && String(c[3] || '').trim()) nombresSheet.add(String(c[3]).trim())
      if (fechaRe.test(String(c[11] || '')) && parseMonto(c[12]) > 0 && String(c[13] || '').trim()) nombresSheet.add(String(c[13]).trim())
    }
    const faltantes = [...nombresSheet].filter(n => !mapCli.has(n.toLowerCase().trim()))
    if (faltantes.length > 0) {
      const nuevos = faltantes.map(n => ({
        nombre: n,
        email: n.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) + '_' + Math.random().toString(36).slice(2, 6) + '@reca.local',
        password_hash: 'temp123', activo: true,
      }))
      const { data: creados } = await supabase.from('clientes').insert(nuevos).select('id, nombre')
      ;(creados || []).forEach(c => mapCli.set(c.nombre.toLowerCase().trim(), c.id))
    }

    // 5. Parsear movimientos: ingresos col0-3, egresos col11-14 (con TC)
    const filas: Record<string, unknown>[] = []
    const deudaPorCliente = new Map<string, number>()
    const pendientes: Record<string, unknown>[] = []
    for (let i = 1; i < rows.length; i++) {
      const c = rows[i] || []
      if (fechaRe.test(String(c[0] || ''))) {
        const monto = parseMonto(c[1])
        if (monto > 0) {
          const cli = String(c[3] || '')
          const cliId = mapCli.get(cli.toLowerCase().trim()) || null
          filas.push({ tipo: 'ajuste_ars_tt', monto_pesos: monto, cuenta_pesos_id,
            cliente_id: cliId,
            descripcion: `IN: ${c[2] || cli}`.trim(), fecha: parseFecha(c[0]), pagado: true, origen: 'sheet' })
        }
      }
      if (fechaRe.test(String(c[11] || ''))) {
        const monto = parseMonto(c[12])
        if (monto > 0) {
          const cli = String(c[13] || '')
          const cliId = mapCli.get(cli.toLowerCase().trim()) || null
          filas.push({ tipo: 'gasto_ars_tt', monto_pesos: monto, cuenta_pesos_id,
            cliente_id: cliId,
            descripcion: `OUT: ${cli}`.trim(), fecha: parseFecha(c[11]), pagado: true, origen: 'sheet' })
          // TC en col 14 → USD = ARS / TC → deuda "le debo" al cliente
          const tc = parseMonto(c[14])
          if (cliId && tc > 0) {
            // Matchea cliente y tiene TC → deuda automática
            deudaPorCliente.set(cliId, (deudaPorCliente.get(cliId) || 0) + monto / tc)
          } else {
            // No matchea o falta TC → a la bandeja de pendientes
            pendientes.push({
              cuenta_pesos_id, fecha: parseFecha(c[11]),
              monto_ars: monto, cliente_sheet: cli.trim() || '(sin nombre)',
              tc: tc > 0 ? tc : null, procesado: false,
            })
          }
        }
      }
    }

    const hoy = new Date().toISOString().split('T')[0]
    const calleRows: Record<string, unknown>[] = []
    // Egresos → me deben USD (el cliente te debe los USD que compró)
    for (const [cliId, usd] of deudaPorCliente) {
      if (usd <= 0.001) continue
      calleRows.push({
        cliente_id: cliId, moneda: 'USD', monto: Math.round(usd * 100) / 100,
        direccion: 'deben', descripcion: `Compra USD reca (${title})`,
        fecha: hoy, activo: true, origen: 'sheet', ref_cuenta: cuenta_pesos_id,
      })
    }

    // 6. Reemplazar import previo
    await supabase.from('operaciones').delete().eq('cuenta_pesos_id', cuenta_pesos_id).eq('origen', 'sheet')
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from('operaciones').insert(filas.slice(i, i + 500))
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 6b. Reemplazar deudas de calle generadas desde el sheet para esta reca
    await supabase.from('saldo_calle').delete().eq('ref_cuenta', cuenta_pesos_id).eq('origen', 'sheet')
    if (calleRows.length > 0) {
      await supabase.from('saldo_calle').insert(calleRows)
    }

    // 6c. Refrescar bandeja de egresos pendientes (no procesados) de esta reca
    await supabase.from('egresos_pendientes').delete().eq('cuenta_pesos_id', cuenta_pesos_id).eq('procesado', false)
    if (pendientes.length > 0) {
      await supabase.from('egresos_pendientes').insert(pendientes)
    }

    // 7. Ajustar saldo_inicial para que el saldo de la app = J16 oficial
    const ingresos = filas.filter(f => f.tipo === 'ajuste_ars_tt').reduce((s, f) => s + (f.monto_pesos as number), 0)
    const egresos = filas.filter(f => f.tipo === 'gasto_ars_tt').reduce((s, f) => s + (f.monto_pesos as number), 0)
    const netoMovs = ingresos - egresos
    const saldoInicial = saldoOficial - netoMovs  // el resto (enviado vs recibido, no acreditados, etc.)
    await supabase.from('cuentas_pesos_tt').update({ saldo_inicial: saldoInicial, sheet_gid: gidUsado, sheet_id: SHEET_ID }).eq('id', cuenta_pesos_id)

    return NextResponse.json({ ok: true, solapa: title, importadas: filas.length, ingresos, egresos, saldo_oficial: saldoOficial, deudas_usd: deudaPorCliente.size, pendientes: pendientes.length })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || String(e) }, { status: 500 })
  }
}
