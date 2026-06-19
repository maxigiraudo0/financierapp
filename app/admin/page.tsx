'use client'
import { useEffect, useState } from 'react'
import { supabase, OPERATION_LABELS, OPERATION_COLORS, type OperationType } from '@/lib/supabase'
import { sumDeltas, computeDelta, ZERO_DELTA, type StockDelta } from '@/lib/deltas'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const today = new Date().toISOString().split('T')[0]

interface Cierre {
  fecha: string
  saldo_usd_cash: number; saldo_usd_transfer: number
  saldo_usdt: number; saldo_eur: number
  saldo_pesos_transfer: number; saldo_pesos_cash: number
  saldo_cuentas_usa: number
}

interface Calle { deben_usd: number; debo_usd: number; deben_ars: number; debo_ars: number; deben_usdt: number; debo_usdt: number }
interface Operacion {
  id: string; tipo: string; monto_usd: number; monto_usdt: number
  monto_pesos: number; monto_eur: number; comision_usd: number
  fecha: string; descripcion: string; clientes: { nombre: string } | null
}

const emptySaldos = { usd: '', usdt: '', eur: '', ars_cash: '', ars_tt: '', usa: '' }
const emptyCalle = { deben_usd: '', debo_usd: '', deben_ars: '', debo_ars: '' }

export default function AdminDashboard() {
  const [stock, setStock] = useState<StockDelta & { base_fecha: string | null }>({ ...ZERO_DELTA, base_fecha: null })
  const [calle, setCalle] = useState<Calle>({ deben_usd: 0, debo_usd: 0, deben_ars: 0, debo_ars: 0, deben_usdt: 0, debo_usdt: 0 })
  const [tc, setTc] = useState(1425)
  const [tcArsCash, setTcArsCash] = useState(1425)
  const [tcArsTt, setTcArsTt] = useState(1425)
  const [tcUsdt, setTcUsdt] = useState(1)
  const [tcUsa, setTcUsa] = useState(1)
  const [tcEur, setTcEur] = useState(1.08)
  // Borrador de los TC (se editan libremente y se aplican al tocar "Guardar")
  const [tcDraft, setTcDraft] = useState({ ars_cash: '', ars_tt: '', usdt: '', usa: '', eur: '' })
  const [tcGuardado, setTcGuardado] = useState(false)
  const [ultimasOps, setUltimasOps] = useState<Operacion[]>([])
  const [stats, setStats] = useState({ clientes: 0, operaciones: 0, ops_hoy: 0 })
  const [loading, setLoading] = useState(true)
  const [showSaldos, setShowSaldos] = useState(false)
  const [saldosForm, setSaldosForm] = useState(emptySaldos)
  const [savingSaldos, setSavingSaldos] = useState(false)
  const [showCalle, setShowCalle] = useState(false)
  const [calleForm, setCalleForm] = useState(emptyCalle)
  const [savingCalle, setSavingCalle] = useState(false)

  useEffect(() => { loadData() }, [])

  // Cargar TC guardados
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('tc_config') || '{}')
      const v = {
        ars_cash: s.tcArsCash ?? 1425, ars_tt: s.tcArsTt ?? 1425,
        usdt: s.tcUsdt ?? 1, usa: s.tcUsa ?? 1, eur: s.tcEur ?? 1.08,
      }
      if (s.tc) setTc(s.tc)
      setTcArsCash(v.ars_cash); setTcArsTt(v.ars_tt)
      setTcUsdt(v.usdt); setTcUsa(v.usa); setTcEur(v.eur)
      setTcDraft({ ars_cash: String(v.ars_cash), ars_tt: String(v.ars_tt), usdt: String(v.usdt), usa: String(v.usa), eur: String(v.eur) })
    } catch {}
  }, [])

  const guardarTC = () => {
    const n = (x: string, d: number) => { const v = parseFloat(x); return Number.isFinite(v) ? v : d }
    setTcArsCash(n(tcDraft.ars_cash, 1425))
    setTcArsTt(n(tcDraft.ars_tt, 1425))
    setTcUsdt(n(tcDraft.usdt, 1))
    setTcUsa(n(tcDraft.usa, 1))
    setTcEur(n(tcDraft.eur, 1.08))
    setTcGuardado(true)
    setTimeout(() => setTcGuardado(false), 2000)
  }
  useEffect(() => {
    localStorage.setItem('tc_config', JSON.stringify({ tc, tcArsCash, tcArsTt, tcUsdt, tcUsa, tcEur }))
  }, [tc, tcArsCash, tcArsTt, tcUsdt, tcUsa, tcEur])

  const loadData = async () => {
    try {
      // 1. Último cierre (cualquier fecha) como base
      const { data: cierres } = await supabase
        .from('cierres_diarios')
        .select('*')
        .eq('cerrado', true)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)

      const ultimoCierre: Cierre | null = cierres?.[0] || null

      // 2. Operaciones NO archivadas (las del lote en curso)
      const cols = 'tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, medio, pendiente, costo_wire, wire_absorbe, comision_usd, cuenta_pesos_id'
      const { data: ops, error: opsErr } = await supabase.from('operaciones').select(cols).eq('archivado', false)
      if (opsErr) console.error('Error ops:', opsErr)

      // Saldos iniciales de cuentas (solo se usan como base si NO hay cierre previo)
      const { data: cuentasUsa } = await supabase.from('cuentas_usa').select('saldo_inicial')
      const usaInicial = (cuentasUsa || []).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0)
      const { data: cuentasTt } = await supabase.from('cuentas_pesos_tt').select('saldo_inicial')
      const ttInicial = (cuentasTt || []).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0)

      // 3. Calcular stock
      const base: StockDelta = ultimoCierre ? {
        usd:      (ultimoCierre.saldo_usd_cash || 0) + (ultimoCierre.saldo_usd_transfer || 0),
        usdt:     ultimoCierre.saldo_usdt || 0,
        eur:      ultimoCierre.saldo_eur || 0,
        ars_cash: ultimoCierre.saldo_pesos_cash || 0,
        ars_tt:   ultimoCierre.saldo_pesos_transfer || 0,
        usa:      ultimoCierre.saldo_cuentas_usa || 0,
      } : { ...ZERO_DELTA, usa: usaInicial, ars_tt: ttInicial }

      const deltas = ops ? sumDeltas(ops.map(o => ({
        tipo: o.tipo,
        monto_usd: Number(o.monto_usd) || 0,
        monto_usdt: Number(o.monto_usdt) || 0,
        monto_pesos: Number(o.monto_pesos) || 0,
        monto_eur: Number(o.monto_eur) || 0,
        medio: (o as { medio?: string | null }).medio,
        pendiente: (o as { pendiente?: string | null }).pendiente,
        costo_wire: Number((o as { costo_wire?: number | null }).costo_wire) || null,
        wire_absorbe: (o as { wire_absorbe?: string | null }).wire_absorbe,
        comision_usd: Number((o as { comision_usd?: number | null }).comision_usd) || null,
      }))) : { ...ZERO_DELTA }

      // Caja ARS TT = SALDO FINAL de cada recaudadora = saldo_inicial + TODOS sus
      // movimientos (archivados o no). No depende del cierre/lote ni de la Mesa
      // (esos pesos ya están dentro de las recaudadoras).
      const { data: recaOps } = await supabase.from('operaciones')
        .select('tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, medio, pendiente')
        .not('cuenta_pesos_id', 'is', null)
      const ttDeltaRecas = (recaOps || []).reduce((s, o) => s + computeDelta({
        tipo: o.tipo,
        monto_usd: Number(o.monto_usd) || 0,
        monto_usdt: Number(o.monto_usdt) || 0,
        monto_pesos: Number(o.monto_pesos) || 0,
        monto_eur: Number(o.monto_eur) || 0,
        medio: (o as { medio?: string | null }).medio,
        pendiente: (o as { pendiente?: string | null }).pendiente,
      }).ars_tt, 0)

      setStock({
        usd:      base.usd      + deltas.usd,
        usdt:     base.usdt     + deltas.usdt,
        eur:      base.eur      + deltas.eur,
        ars_cash: base.ars_cash + deltas.ars_cash,
        ars_tt:   ttInicial     + ttDeltaRecas,
        usa:      base.usa      + deltas.usa,
        base_fecha: ultimoCierre?.fecha || null,
      })

    // 4. Saldo calle
    const { data: calleData } = await supabase
      .from('saldo_calle').select('moneda, monto, direccion').eq('activo', true)

    if (calleData) {
      setCalle({
        deben_usd: calleData.filter(c => c.moneda === 'USD' && c.direccion === 'deben').reduce((a, c) => a + c.monto, 0),
        debo_usd:  calleData.filter(c => c.moneda === 'USD' && c.direccion === 'debo').reduce((a, c) => a + c.monto, 0),
        deben_ars: calleData.filter(c => c.moneda === 'ARS' && c.direccion === 'deben').reduce((a, c) => a + c.monto, 0),
        debo_ars:  calleData.filter(c => c.moneda === 'ARS' && c.direccion === 'debo').reduce((a, c) => a + c.monto, 0),
        deben_usdt: calleData.filter(c => c.moneda === 'USDT' && c.direccion === 'deben').reduce((a, c) => a + c.monto, 0),
        debo_usdt:  calleData.filter(c => c.moneda === 'USDT' && c.direccion === 'debo').reduce((a, c) => a + c.monto, 0),
      })
    }

    // 5. Stats
    const [{ data: clientes }, { data: todasOps }, { data: opsHoy }] = await Promise.all([
      supabase.from('clientes').select('id'),
      supabase.from('operaciones').select('id', { count: 'exact', head: true }),
      supabase.from('operaciones').select('id', { count: 'exact', head: true })
        .eq('fecha', new Date().toISOString().split('T')[0]),
    ])

    setStats({
      clientes: clientes?.length || 0,
      operaciones: (todasOps as unknown as { count: number })?.length || 0,
      ops_hoy: (opsHoy as unknown as { count: number })?.length || 0,
    })

    // 6. Últimas ops
    const { data: ultimas } = await supabase
      .from('operaciones')
      .select('id, tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, comision_usd, fecha, descripcion, clientes(nombre)')
      .order('created_at', { ascending: false })
      .limit(12)
      if (ultimas) setUltimasOps(ultimas as unknown as Operacion[])

    } catch (err) {
      console.error('Error en loadData:', err)
    } finally {
      setLoading(false)
    }
  }

  const guardarCalle = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingCalle(true)
    // Borra registros generales anteriores (sin cliente_id, con descripcion 'total_general')
    await supabase.from('saldo_calle').delete().is('cliente_id', null).eq('descripcion', 'total_general')
    const registros = []
    if (calleForm.deben_usd) registros.push({ moneda: 'USD', monto: parseFloat(calleForm.deben_usd), direccion: 'deben', descripcion: 'total_general', fecha: today, activo: true })
    if (calleForm.debo_usd)  registros.push({ moneda: 'USD', monto: parseFloat(calleForm.debo_usd),  direccion: 'debo',  descripcion: 'total_general', fecha: today, activo: true })
    if (calleForm.deben_ars) registros.push({ moneda: 'ARS', monto: parseFloat(calleForm.deben_ars), direccion: 'deben', descripcion: 'total_general', fecha: today, activo: true })
    if (calleForm.debo_ars)  registros.push({ moneda: 'ARS', monto: parseFloat(calleForm.debo_ars),  direccion: 'debo',  descripcion: 'total_general', fecha: today, activo: true })
    if (registros.length > 0) {
      const { error } = await supabase.from('saldo_calle').insert(registros)
      if (error) { alert('Error: ' + error.message); setSavingCalle(false); return }
    }
    setSavingCalle(false)
    setShowCalle(false)
    setCalleForm(emptyCalle)
    await loadData()
  }

  const abrirSaldos = async (editar = false) => {
    if (editar) {
      // Cargar valores actuales del día
      const tipos = ['saldo_inicial_usd','saldo_inicial_usdt','saldo_inicial_eur','saldo_inicial_pesos_cash','saldo_inicial_pesos_tt','saldo_inicial_cuenta_usa']
      const { data } = await supabase.from('operaciones').select('tipo,monto_usd,monto_usdt,monto_pesos,monto_eur').in('tipo', tipos).eq('fecha', today)
      if (data) {
        const get = (tipo: string) => data.find(o => o.tipo === tipo)
        setSaldosForm({
          usd:      String(get('saldo_inicial_usd')?.monto_usd || ''),
          usdt:     String(get('saldo_inicial_usdt')?.monto_usdt || ''),
          eur:      String(get('saldo_inicial_eur')?.monto_eur || ''),
          ars_cash: String(get('saldo_inicial_pesos_cash')?.monto_pesos || ''),
          ars_tt:   String(get('saldo_inicial_pesos_tt')?.monto_pesos || ''),
          usa:      String(get('saldo_inicial_cuenta_usa')?.monto_usd || ''),
        })
      }
    } else {
      setSaldosForm(emptySaldos)
    }
    setShowSaldos(true)
  }

  const cargarSaldosIniciales = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSaldos(true)

    // Borrar saldos iniciales existentes de hoy y reemplazar
    const tipos = ['saldo_inicial_usd','saldo_inicial_usdt','saldo_inicial_eur','saldo_inicial_pesos_cash','saldo_inicial_pesos_tt','saldo_inicial_cuenta_usa']
    await supabase.from('operaciones').delete().in('tipo', tipos).eq('fecha', today)

    const ops = []
    if (saldosForm.usd)      ops.push({ tipo: 'saldo_inicial_usd',        monto_usd: parseFloat(saldosForm.usd),        monto_usdt: 0, monto_pesos: 0, monto_eur: 0, fecha: today })
    if (saldosForm.usdt)     ops.push({ tipo: 'saldo_inicial_usdt',       monto_usdt: parseFloat(saldosForm.usdt),      monto_usd: 0,  monto_pesos: 0, monto_eur: 0, fecha: today })
    if (saldosForm.eur)      ops.push({ tipo: 'saldo_inicial_eur',        monto_eur: parseFloat(saldosForm.eur),        monto_usd: 0,  monto_usdt: 0,  monto_pesos: 0, fecha: today })
    if (saldosForm.ars_cash) ops.push({ tipo: 'saldo_inicial_pesos_cash', monto_pesos: parseFloat(saldosForm.ars_cash), monto_usd: 0,  monto_usdt: 0,  monto_eur: 0, fecha: today })
    if (saldosForm.ars_tt)   ops.push({ tipo: 'saldo_inicial_pesos_tt',   monto_pesos: parseFloat(saldosForm.ars_tt),   monto_usd: 0,  monto_usdt: 0,  monto_eur: 0, fecha: today })
    if (saldosForm.usa)      ops.push({ tipo: 'saldo_inicial_cuenta_usa', monto_usd: parseFloat(saldosForm.usa),        monto_usdt: 0, monto_pesos: 0, monto_eur: 0, fecha: today })

    if (ops.length > 0) {
      const { error } = await supabase.from('operaciones').insert(ops)
      if (error) { alert('Error: ' + error.message); setSavingSaldos(false); return }
    }

    setSavingSaldos(false)
    setShowSaldos(false)
    setSaldosForm(emptySaldos)
    await loadData()
  }

  const f = (n: number, dec = 2) => {
    const x = Number(n)
    return (Number.isFinite(x) ? x : 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  }

  const num = (v: number | string | null | undefined, d = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  const div = (a: number, t: number) => (t > 0 ? a / t : 0)   // evita /0
  const totalUSD = num(stock.usd)
    + num(stock.usa) * num(tcUsa, 1)
    + num(stock.usdt) * num(tcUsdt, 1)
    + num(stock.eur) * num(tcEur, 1)
    + div(num(stock.ars_cash), num(tcArsCash))
    + div(num(stock.ars_tt), num(tcArsTt))
  const netCalle = (num(calle.deben_usd) - num(calle.debo_usd))
    + div(num(calle.deben_ars) - num(calle.debo_ars), num(tcArsTt))  // calle ARS al TC de ARS TT (blue)
    + (num(calle.deben_usdt) - num(calle.debo_usdt)) * num(tcUsdt, 1)
  const totalGlobal = totalUSD + netCalle

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {stock.base_fecha
              ? `Base: cierre del ${format(new Date(stock.base_fecha + 'T12:00:00'), "dd/MM/yyyy")} + operaciones desde entonces`
              : 'Sin cierre base — mostrando todas las operaciones'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => abrirSaldos(false)} className="btn-primary text-sm px-4 py-2">📥 Saldos Iniciales</button>
          <button onClick={() => abrirSaldos(true)} className="btn-secondary text-sm px-4 py-2">✏️ Editar Saldos</button>
          <button onClick={() => setShowCalle(true)} className="btn-secondary text-sm px-4 py-2">🚶 Cargar Calle</button>
          <button onClick={loadData} className="btn-secondary text-sm px-3 py-2">↻</button>
        </div>
      </div>

      {/* Modal Calle */}
      {showCalle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold mb-1">🚶 Cargar Saldo en la Calle</h2>
            <p className="text-sm text-gray-500 mb-6">Totales generales — reemplaza los valores anteriores</p>
            <form onSubmit={guardarCalle} className="space-y-4">
              <div className="bg-green-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-1">✅ Me deben (ingresos)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Me deben USD</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00"
                      value={calleForm.deben_usd} onChange={e => setCalleForm({...calleForm, deben_usd: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Me deben ARS</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00"
                      value={calleForm.deben_ars} onChange={e => setCalleForm({...calleForm, deben_ars: e.target.value})} />
                  </div>
                </div>
              </div>
              <div className="bg-red-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">❌ Debo (egresos)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Debo USD</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00"
                      value={calleForm.debo_usd} onChange={e => setCalleForm({...calleForm, debo_usd: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Debo ARS</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00"
                      value={calleForm.debo_ars} onChange={e => setCalleForm({...calleForm, debo_ars: e.target.value})} />
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1" disabled={savingCalle}>
                  {savingCalle ? 'Guardando...' : '✓ Confirmar'}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowCalle(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Saldos Iniciales */}
      {showSaldos && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold mb-1">
              {saldosForm.usd || saldosForm.usdt || saldosForm.eur || saldosForm.ars_cash || saldosForm.ars_tt || saldosForm.usa ? '✏️ Editar Saldos Iniciales' : '📥 Cargar Saldos Iniciales'}
            </h2>
            <p className="text-sm text-gray-500 mb-6">Reemplaza los saldos iniciales de hoy. Dejá en blanco los que no uses.</p>
            <form onSubmit={cargarSaldosIniciales} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">💵 USD</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.usd} onChange={e => setSaldosForm({...saldosForm, usd: e.target.value})} />
                </div>
                <div>
                  <label className="label">◎ USDT</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.usdt} onChange={e => setSaldosForm({...saldosForm, usdt: e.target.value})} />
                </div>
                <div>
                  <label className="label">🇪🇺 EUR</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.eur} onChange={e => setSaldosForm({...saldosForm, eur: e.target.value})} />
                </div>
                <div>
                  <label className="label">🇺🇸 Cuentas USA</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.usa} onChange={e => setSaldosForm({...saldosForm, usa: e.target.value})} />
                </div>
                <div>
                  <label className="label">💵 ARS Físico</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.ars_cash} onChange={e => setSaldosForm({...saldosForm, ars_cash: e.target.value})} />
                </div>
                <div>
                  <label className="label">📲 ARS TT</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={saldosForm.ars_tt} onChange={e => setSaldosForm({...saldosForm, ars_tt: e.target.value})} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1" disabled={savingSaldos}>
                  {savingSaldos ? 'Guardando...' : '✓ Confirmar'}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowSaldos(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CAJA FINAL DEL DIA */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px flex-1 bg-gray-200"></div>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Caja Final del Día</span>
        <div className="h-px flex-1 bg-gray-200"></div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card border-t-4 border-[#2EDBB8]">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">💵 Caja USD</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">${f(stock.usd)}</div>
          <div className="text-xs text-gray-400 mt-1">Cash + Transfer</div>
        </div>
        <div className="card border-t-4 border-blue-400">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">◎ Caja USDT</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">◎ {f(stock.usdt)}</div>
          <div className="text-xs text-gray-400 mt-1">Tether</div>
        </div>
        <div className="card border-t-4 border-yellow-400">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">🇪🇺 Caja EUR</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">€ {f(stock.eur)}</div>
          <div className="text-xs text-gray-400 mt-1">Euros</div>
        </div>
        <div className="card border-t-4 border-orange-400">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">💵 Caja ARS Físico</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">${f(stock.ars_cash, 0)}</div>
          <div className="text-xs text-gray-400 mt-1">Pesos efectivo</div>
        </div>
        <div className="card border-t-4 border-amber-400">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">📲 Caja ARS TT</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">${f(stock.ars_tt, 0)}</div>
          <div className="text-xs text-gray-400 mt-1">Pesos transferencia</div>
        </div>
        <div className="card border-t-4 border-purple-400">
          <div className="text-xs font-bold text-gray-400 uppercase mb-1">🇺🇸 Caja USA</div>
          <div className="text-2xl font-bold text-[#1a1a2e]">${f(stock.usa)}</div>
          <div className="text-xs text-gray-400 mt-1">Cuentas en USA</div>
        </div>
      </div>

      {/* Total + Calle */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card text-white" style={{ backgroundColor: '#1a1a2e' }}>
          <div className="text-xs font-bold text-[#2EDBB8] uppercase mb-1">🌐 TOTAL GLOBAL (en USD)</div>
          <div className="text-3xl font-bold">${f(totalGlobal)}</div>
          <div className="text-xs text-gray-400 mt-1">Cajas + En la Calle</div>
          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-gray-400 space-y-0.5">
            <div className="flex justify-between"><span>Solo cajas</span><span className="font-bold text-white">${f(totalUSD)}</span></div>
            <div className="flex justify-between"><span>Neto calle</span><span className={`font-bold ${netCalle >= 0 ? 'text-green-400' : 'text-red-400'}`}>{netCalle >= 0 ? '+' : ''}${f(netCalle)}</span></div>
            <div className="flex justify-between text-[10px] pt-1 text-gray-500"><span>ARS Fís ${tcArsCash.toLocaleString()} · ARS TT ${tcArsTt.toLocaleString()} · USDT {tcUsdt} · USA {tcUsa} · EUR {tcEur}</span></div>
          </div>
        </div>
        <div className="card border border-red-200 col-span-2">
          <div className="text-xs font-bold text-red-500 uppercase tracking-wide mb-3">🚶 En la Calle</div>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-400 mb-1">DEBEN USD</div>
              <div className="font-bold text-green-600">${f(calle.deben_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">DEBO USD</div>
              <div className="font-bold text-red-600">${f(calle.debo_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">DEBEN ARS</div>
              <div className="font-bold text-green-600">${f(calle.deben_ars, 0)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">DEBO ARS</div>
              <div className="font-bold text-red-600">${f(calle.debo_ars, 0)}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-red-100 flex justify-between">
            <span className="text-xs text-gray-400">Neto en USD</span>
            <span className={`font-bold ${netCalle >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {netCalle >= 0 ? '+' : ''}${f(netCalle)}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card text-center">
          <div className="text-3xl font-bold text-[#2EDBB8]">{stats.clientes}</div>
          <div className="text-sm text-gray-500 mt-1">Clientes</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-[#1a1a2e]">{stats.ops_hoy}</div>
          <div className="text-sm text-gray-500 mt-1">Operaciones hoy</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-gray-400">{stats.operaciones}</div>
          <div className="text-sm text-gray-500 mt-1">Total operaciones</div>
        </div>
      </div>

      {/* Panel de Cotizaciones */}
      <div className="card mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-[#1a1a2e]">💱 Cotizaciones (tipos de cambio)</h2>
          <button onClick={guardarTC} className="btn-primary text-sm px-5 py-2">
            {tcGuardado ? '✓ Guardado' : '💾 Guardar'}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="label">💵 ARS Físico ($/USD)</label>
            <input className="input" type="number" value={tcDraft.ars_cash}
              onChange={e => setTcDraft({ ...tcDraft, ars_cash: e.target.value })} />
          </div>
          <div>
            <label className="label">📲 ARS TT ($/USD)</label>
            <input className="input" type="number" value={tcDraft.ars_tt}
              onChange={e => setTcDraft({ ...tcDraft, ars_tt: e.target.value })} />
          </div>
          <div>
            <label className="label">◎ USDT (USD x USDT)</label>
            <input className="input" type="number" step="0.0001" value={tcDraft.usdt}
              onChange={e => setTcDraft({ ...tcDraft, usdt: e.target.value })} />
          </div>
          <div>
            <label className="label">🇺🇸 Caja USA (USD x USD)</label>
            <input className="input" type="number" step="0.0001" value={tcDraft.usa}
              onChange={e => setTcDraft({ ...tcDraft, usa: e.target.value })} />
          </div>
          <div>
            <label className="label">🇪🇺 EUR (USD x EUR)</label>
            <input className="input" type="number" step="0.0001" value={tcDraft.eur}
              onChange={e => setTcDraft({ ...tcDraft, eur: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">Editá los valores y tocá <strong>Guardar</strong> para aplicarlos al Total Global (no se recalcula mientras escribís).</p>
      </div>

      {/* Últimas ops */}
      <div className="card">
        <h2 className="font-bold text-[#1a1a2e] mb-4">Últimas Operaciones</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-3 font-semibold text-gray-500">Cliente</th>
                <th className="pb-3 font-semibold text-gray-500">Tipo</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USD</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USDT</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">EUR</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Pesos</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Comisión</th>
                <th className="pb-3 font-semibold text-gray-500">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ultimasOps.map(op => (
                <tr key={op.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium">{op.clientes?.nombre || <span className="text-gray-400 text-xs">Caja</span>}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${OPERATION_COLORS[op.tipo] || 'bg-gray-100'}`}>
                      {OPERATION_LABELS[op.tipo as OperationType] || op.tipo}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_usd ? `$${f(op.monto_usd)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_usdt ? `◎${f(op.monto_usdt)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_eur ? `€${f(op.monto_eur)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_pesos ? `$${f(op.monto_pesos, 0)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs text-green-600">{op.comision_usd ? `$${f(op.comision_usd)}` : '—'}</td>
                  <td className="py-3 text-gray-400 text-xs">{format(new Date(op.fecha + 'T12:00:00'), 'dd/MM/yy', { locale: es })}</td>
                </tr>
              ))}
              {ultimasOps.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">No hay operaciones todavía</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
