'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CuentaUSA { id: string; nombre: string; banco: string; notas: string; activa: boolean; saldo_inicial: number }
interface CuentaPesos { id: string; nombre: string; alias: string; cbu: string; notas: string; activa: boolean; saldo_inicial: number; sheet_gid?: string; sheet_id?: string }

export default function CuentasPage() {
  const [cuentasUSA, setCuentasUSA] = useState<CuentaUSA[]>([])
  const [cuentasPesos, setCuentasPesos] = useState<CuentaPesos[]>([])
  const [movsPorCuenta, setMovsPorCuenta] = useState<Record<string, number>>({})
  const [showUSA, setShowUSA] = useState(false)
  const [showPesos, setShowPesos] = useState(false)
  const [formUSA, setFormUSA] = useState({ nombre: '', banco: '', notas: '', saldo_inicial: '' })
  const [formPesos, setFormPesos] = useState({ nombre: '', alias: '', cbu: '', notas: '', saldo_inicial: '' })
  const [movsPorPesos, setMovsPorPesos] = useState<Record<string, number>>({})
  const [noAcredPorCuenta, setNoAcredPorCuenta] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  // Detalle de cuenta USA
  const [detalle, setDetalle] = useState<CuentaUSA | null>(null)
  const [movsDetalle, setMovsDetalle] = useState<Array<{id:string;tipo:string;monto_usd:number;descripcion:string;fecha:string;clientes:{nombre:string}|null}>>([])
  const [clientesList, setClientesList] = useState<Array<{id:string;nombre:string}>>([])
  const today = new Date().toISOString().split('T')[0]
  const [movForm, setMovForm] = useState({ tipo: 'bajada_cable', monto: '', cliente_id: '', descripcion: '', fecha: today })

  useEffect(() => { loadAll() }, [])

  const abrirDetalle = async (c: CuentaUSA) => {
    setDetalle(c)
    setMovForm({ tipo: 'bajada_cable', monto: '', cliente_id: '', descripcion: '', fecha: today })
    const [{ data }, { data: cls }] = await Promise.all([
      supabase.from('operaciones')
        .select('id, tipo, monto_usd, descripcion, fecha, clientes(nombre)')
        .eq('cuenta_usa_id', c.id)
        .in('tipo', ['bajada_cable','bajada_cable_pesos','bajada_cable_pesos_tt','subida_cable','subida_cable_usdt'])
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    setMovsDetalle((data as unknown as typeof movsDetalle) || [])
    if (cls) setClientesList(cls)
  }

  const guardarMov = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detalle) return
    const { error } = await supabase.from('operaciones').insert({
      tipo: movForm.tipo,
      monto_usd: parseFloat(movForm.monto) || 0,
      cuenta_usa_id: detalle.id,
      cliente_id: movForm.cliente_id || null,
      descripcion: movForm.descripcion || null,
      fecha: movForm.fecha,
      pagado: true,
    })
    if (error) { alert(error.message); return }
    await abrirDetalle(detalle)
    await loadAll()
    setMovForm({ tipo: 'bajada_cable', monto: '', cliente_id: '', descripcion: '', fecha: today })
  }

  const borrarMov = async (id: string) => {
    if (!confirm('¿Eliminar movimiento?')) return
    await supabase.from('operaciones').delete().eq('id', id)
    if (detalle) await abrirDetalle(detalle)
    await loadAll()
  }

  // ── Detalle de cuenta Pesos TT (recaudadora) ──
  const [detallePesos, setDetallePesos] = useState<CuentaPesos | null>(null)
  const [movsPesos, setMovsPesos] = useState<Array<{id:string;tipo:string;monto_pesos:number;descripcion:string;fecha:string;clientes:{nombre:string}|null}>>([])
  const [movPForm, setMovPForm] = useState({ sentido: 'ingreso', monto: '', titular: '', cliente_id: '', fecha: today })
  const [gidInput, setGidInput] = useState('')
  const [importando, setImportando] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Bandeja de egresos pendientes
  interface Pend { id: string; cuenta_pesos_id: string; fecha: string; monto_ars: number; cliente_sheet: string; tc: number | null }
  const [pendientes, setPendientes] = useState<Pend[]>([])
  const [asignForm, setAsignForm] = useState<Record<string, { cliente_id: string; tc: string; moneda: string }>>({})

  const loadPendientes = async () => {
    const { data } = await supabase.from('egresos_pendientes').select('*').eq('procesado', false).order('fecha')
    if (data) {
      setPendientes(data as Pend[])
      const f: Record<string, { cliente_id: string; tc: string; moneda: string }> = {}
      ;(data as Pend[]).forEach(p => { f[p.id] = { cliente_id: '', tc: p.tc ? String(p.tc) : '', moneda: 'USD' } })
      setAsignForm(f)
    }
  }

  // Bandeja de ingresos pendientes de acreditar
  interface IngPend { id: string; cuenta_pesos_id: string; fecha: string; monto_ars: number; nombre_ticket: string }
  const [ingPendientes, setIngPendientes] = useState<IngPend[]>([])
  const [acredForm, setAcredForm] = useState<Record<string, string>>({})

  const loadIngresosPendientes = async () => {
    const { data } = await supabase.from('ingresos_pendientes').select('*').eq('procesado', false).order('fecha')
    if (data) {
      setIngPendientes(data as IngPend[])
      const f: Record<string, string> = {}
      ;(data as IngPend[]).forEach(p => { f[p.id] = '' })
      setAcredForm(f)
    }
  }

  const acreditarIngreso = async (p: IngPend) => {
    const cliente_id = acredForm[p.id]
    if (!cliente_id) { alert('Elegí cliente'); return }
    const res = await fetch('/api/acreditar-ingreso', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendiente_id: p.id, cliente_id }),
    })
    const json = await res.json()
    if (!res.ok) { alert('Error: ' + json.error); return }
    await loadIngresosPendientes()
  }

  const asignarEgreso = async (p: Pend) => {
    const form = asignForm[p.id]
    if (!form?.cliente_id) { alert('Elegí cliente'); return }
    if (form.moneda === 'USD' && !form.tc) { alert('Poné el TC o cambiá a ARS'); return }
    const res = await fetch('/api/asignar-egreso', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendiente_id: p.id, cliente_id: form.cliente_id, tc: parseFloat(form.tc), moneda: form.moneda }),
    })
    const json = await res.json()
    if (!res.ok) { alert('Error: ' + json.error); return }
    await loadPendientes()
  }

  // Importa todas las recaudadoras + sheets de cliente configurados
  const importarTodas = async (silencioso = false) => {
    const conGid = cuentasPesos.filter(c => c.sheet_gid)
    if (!silencioso) setSyncMsg('Sincronizando...')
    let ok = 0, tot = 0
    // Recaudadoras
    for (const c of conGid) {
      tot++
      try {
        const res = await fetch('/api/import-sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gid: c.sheet_gid, sheet_id: c.sheet_id, cuenta_pesos_id: c.id, auto_mes: true }),
        })
        if (res.ok) ok++
      } catch {}
    }
    // Sheets de cliente (liquidación J10)
    const { data: clientesSheet } = await supabase.from('clientes').select('id, sheet_id, sheet_gid, sheet_celda, sheet_moneda').not('sheet_id', 'is', null)
    for (const cl of (clientesSheet || [])) {
      tot++
      try {
        const res = await fetch('/api/import-cliente-sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: cl.id, sheet_id: cl.sheet_id, gid: cl.sheet_gid, celda: cl.sheet_celda || 'J10', moneda: cl.sheet_moneda || 'ARS' }),
        })
        if (res.ok) ok++
      } catch {}
    }
    if (tot === 0) { setSyncMsg(''); return }
    await loadAll()
    setSyncMsg(`✓ Actualizado ${ok}/${tot} · ${new Date().toLocaleTimeString('es-AR')}`)
  }

  // Auto-sync cada 10 minutos mientras la app está abierta
  useEffect(() => {
    const id = setInterval(() => importarTodas(true), 10 * 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentasPesos])

  // Extrae spreadsheetId y gid de una URL de Google Sheets (o de un gid suelto)
  const parseSheetUrl = (input: string): { sheet_id?: string; gid?: string } => {
    const t = input.trim()
    if (/^\d+$/.test(t)) return { gid: t } // solo gid
    const idM = t.match(/\/d\/([a-zA-Z0-9_-]+)/)
    const gidM = t.match(/[?#&]gid=(\d+)/)
    return { sheet_id: idM?.[1], gid: gidM?.[1] }
  }

  const importarSheet = async () => {
    if (!detallePesos || !gidInput) { alert('Pegá la URL de la solapa del Sheet'); return }
    setImportando(true)
    try {
      const { sheet_id, gid } = parseSheetUrl(gidInput)
      if (!gid) { alert('No pude leer el gid de la URL'); setImportando(false); return }
      const res = await fetch('/api/import-sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid, sheet_id, cuenta_pesos_id: detallePesos.id }),
      })
      const json = await res.json()
      if (!res.ok) { alert('Error: ' + json.error); setImportando(false); return }
      alert(`✓ Solapa: ${json.solapa}\nImportadas ${json.importadas} filas.\nIngresos: $${(json.ingresos||0).toLocaleString('es-AR')}\nEgresos: $${(json.egresos||0).toLocaleString('es-AR')}\nSALDO: $${(json.saldo_oficial||0).toLocaleString('es-AR')}`)
      await abrirDetallePesos(detallePesos)
      await loadAll()
    } catch (e) { alert('Error: ' + e) }
    setImportando(false)
  }

  const abrirDetallePesos = async (c: CuentaPesos) => {
    setDetallePesos(c)
    setGidInput(c.sheet_id && c.sheet_gid ? `https://docs.google.com/spreadsheets/d/${c.sheet_id}/edit#gid=${c.sheet_gid}` : (c.sheet_gid || ''))
    setMovPForm({ sentido: 'ingreso', monto: '', titular: '', cliente_id: '', fecha: today })
    const [{ data }, { data: cls }] = await Promise.all([
      supabase.from('operaciones')
        .select('id, tipo, monto_pesos, descripcion, fecha, clientes(nombre)')
        .eq('cuenta_pesos_id', c.id)
        .in('tipo', ['ajuste_ars_tt','gasto_ars_tt'])
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    setMovsPesos((data as unknown as typeof movsPesos) || [])
    if (cls) setClientesList(cls)
  }

  const guardarMovPesos = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detallePesos) return
    const tipo = movPForm.sentido === 'ingreso' ? 'ajuste_ars_tt' : 'gasto_ars_tt'
    const { error } = await supabase.from('operaciones').insert({
      tipo,
      monto_pesos: parseFloat(movPForm.monto) || 0,
      cuenta_pesos_id: detallePesos.id,
      cliente_id: movPForm.cliente_id || null,
      descripcion: movPForm.titular || null,
      fecha: movPForm.fecha,
      pagado: true,
    })
    if (error) { alert(error.message); return }
    await abrirDetallePesos(detallePesos)
    await loadAll()
    setMovPForm({ sentido: 'ingreso', monto: '', titular: '', cliente_id: '', fecha: today })
  }

  const borrarMovPesos = async (id: string) => {
    if (!confirm('¿Eliminar movimiento?')) return
    await supabase.from('operaciones').delete().eq('id', id)
    if (detallePesos) await abrirDetallePesos(detallePesos)
    await loadAll()
  }

  const loadAll = async () => {
    const [{ data: usa }, { data: pesos }, { data: ops }, { data: noAcred }] = await Promise.all([
      supabase.from('cuentas_usa').select('*').order('nombre'),
      supabase.from('cuentas_pesos_tt').select('*').order('nombre'),
      supabase.from('operaciones').select('cuenta_usa_id, cuenta_pesos_id, tipo, monto_usd, monto_pesos, comision_usd, costo_wire, wire_absorbe').or('tipo.in.(bajada_cable,bajada_cable_pesos,bajada_cable_pesos_tt,subida_cable,subida_cable_usdt,bajada_cable_usdt),cuenta_pesos_id.not.is.null'),
      supabase.from('saldo_calle').select('ref_cuenta, monto').eq('origen', 'ingreso_pendiente').eq('activo', true),
    ])
    if (usa) setCuentasUSA(usa)
    if (pesos) setCuentasPesos(pesos)
    // Tickets no acreditados por recaudadora
    const na: Record<string, number> = {}
    ;(noAcred || []).forEach(r => { if (r.ref_cuenta) na[r.ref_cuenta] = (na[r.ref_cuenta] || 0) + Number(r.monto) })
    setNoAcredPorCuenta(na)
    // Movimientos cuentas USA
    const movs: Record<string, number> = {}
    const movsP: Record<string, number> = {}
    if (ops) ops.forEach(o => {
      // USA
      if (o.cuenta_usa_id) {
        let delta = (o.tipo === 'bajada_cable' || o.tipo === 'bajada_cable_pesos' || o.tipo === 'bajada_cable_pesos_tt' || o.tipo === 'bajada_cable_usdt')
          ? (o.monto_usd || 0)   // entra USD a la cuenta USA
          : (o.tipo === 'subida_cable'
              ? -((o.monto_usd || 0) - (o.comision_usd || 0))   // sale el neto (monto − comisión)
              : -(o.monto_usd || 0))
        if (o.tipo === 'subida_cable_usdt' && o.wire_absorbe === 'financiera' && o.costo_wire) delta -= o.costo_wire
        movs[o.cuenta_usa_id] = (movs[o.cuenta_usa_id] || 0) + delta
      }
      // Pesos TT (efecto sobre ARS TT)
      if (o.cuenta_pesos_id) {
        const p = o.monto_pesos || 0
        let dp = 0
        if (['venta_usd_transfer','venta_usdt_pesos','ajuste_ars_tt'].includes(o.tipo)) dp = p
        else if (['compra_usd_transfer','compra_usdt_pesos','bajada_cable_pesos_tt','gasto_ars_tt'].includes(o.tipo)) dp = -p
        movsP[o.cuenta_pesos_id] = (movsP[o.cuenta_pesos_id] || 0) + dp
      }
    })
    setMovsPorCuenta(movs)
    setMovsPorPesos(movsP)
    loadPendientes()
    loadIngresosPendientes()
    const { data: cls } = await supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre')
    if (cls) setClientesList(cls)
  }

  const saldoCuenta = (c: CuentaUSA) => (c.saldo_inicial || 0) + (movsPorCuenta[c.id] || 0)
  const saldoPesos = (c: CuentaPesos) => (c.saldo_inicial || 0) + (movsPorPesos[c.id] || 0)
  const totalUSA = cuentasUSA.reduce((s, c) => s + saldoCuenta(c), 0)
  const totalPesos = cuentasPesos.reduce((s, c) => s + saldoPesos(c), 0)
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const saveUSA = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const { error } = await supabase.from('cuentas_usa').insert({
      nombre: formUSA.nombre, banco: formUSA.banco, notas: formUSA.notas,
      saldo_inicial: parseFloat(formUSA.saldo_inicial) || 0,
    })
    if (error) { alert(error.message); setSaving(false); return }
    setShowUSA(false); setFormUSA({ nombre: '', banco: '', notas: '', saldo_inicial: '' }); setSaving(false); loadAll()
  }

  const savePesos = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const { error } = await supabase.from('cuentas_pesos_tt').insert({
      nombre: formPesos.nombre, alias: formPesos.alias, cbu: formPesos.cbu, notas: formPesos.notas,
      saldo_inicial: parseFloat(formPesos.saldo_inicial) || 0,
    })
    if (error) { alert(error.message); setSaving(false); return }
    setShowPesos(false); setFormPesos({ nombre: '', alias: '', cbu: '', notas: '', saldo_inicial: '' }); setSaving(false); loadAll()
  }

  const toggleUSA = async (id: string, activa: boolean) => {
    await supabase.from('cuentas_usa').update({ activa: !activa }).eq('id', id); loadAll()
  }
  const togglePesos = async (id: string, activa: boolean) => {
    await supabase.from('cuentas_pesos_tt').update({ activa: !activa }).eq('id', id); loadAll()
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Cuentas</h1>
        <p className="text-gray-500 text-sm mt-1">Cuentas USA y Cuentas Pesos TT</p>
      </div>

      {/* Bandeja de egresos pendientes de asignar */}
      {pendientes.length > 0 && (
        <div className="card mb-6 border-2 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">⚠️</span>
            <h2 className="font-bold text-yellow-800">Egresos pendientes de asignar ({pendientes.length})</h2>
          </div>
          <p className="text-xs text-yellow-700 mb-4">Estos egresos del sheet no matchearon un cliente o no tenían TC. Asigná cliente y TC para generar la deuda en USD.</p>
          <div className="space-y-2">
            {pendientes.map(p => (
              <div key={p.id} className="bg-white rounded-lg p-3 grid grid-cols-7 gap-3 items-end text-sm">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Fecha</div>
                  <div className="font-medium">{new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Monto ARS</div>
                  <div className="font-mono font-bold">${p.monto_ars.toLocaleString('es-AR')}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Reca · En sheet</div>
                  <div className="text-gray-600"><span className="font-semibold text-[#1a1a2e]">{cuentasPesos.find(c => c.id === p.cuenta_pesos_id)?.nombre || '—'}</span> · {p.cliente_sheet}</div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">Cliente app</label>
                  <select className="input text-xs" value={asignForm[p.id]?.cliente_id || ''} onChange={e => setAsignForm({...asignForm, [p.id]: {...asignForm[p.id], cliente_id: e.target.value}})}>
                    <option value="">—</option>
                    {clientesList.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">Moneda</label>
                  <select className="input text-xs" value={asignForm[p.id]?.moneda || 'USD'} onChange={e => setAsignForm({...asignForm, [p.id]: {...asignForm[p.id], moneda: e.target.value}})}>
                    <option value="USD">USD (con TC)</option>
                    <option value="ARS">ARS directo</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">TC</label>
                  <input className="input text-xs" type="number" step="0.01" placeholder="1430" disabled={asignForm[p.id]?.moneda === 'ARS'}
                    value={asignForm[p.id]?.tc || ''} onChange={e => setAsignForm({...asignForm, [p.id]: {...asignForm[p.id], tc: e.target.value}})} />
                </div>
                <button onClick={() => asignarEgreso(p)} className="btn-primary text-xs py-2">
                  {asignForm[p.id]?.moneda === 'ARS'
                    ? `Asignar ($${p.monto_ars.toLocaleString('es-AR')} ARS)`
                    : `Asignar ${asignForm[p.id]?.tc ? `(US$${(p.monto_ars/parseFloat(asignForm[p.id].tc)).toFixed(0)})` : ''}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Cuentas USA */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#1a1a2e] flex items-center gap-2">🇺🇸 Cuentas USA</h2>
            <button className="btn-primary text-sm px-3 py-1.5" onClick={() => setShowUSA(true)}>+ Agregar</button>
          </div>

          {showUSA && (
            <div className="card mb-4 border-[#2EDBB8] border">
              <form onSubmit={saveUSA} className="space-y-3">
                <div><label className="label">Nombre</label><input className="input" value={formUSA.nombre} onChange={e => setFormUSA({...formUSA, nombre: e.target.value})} required /></div>
                <div><label className="label">Banco</label><input className="input" placeholder="Ej: Wise, Bank of America..." value={formUSA.banco} onChange={e => setFormUSA({...formUSA, banco: e.target.value})} /></div>
                <div><label className="label">Saldo inicial (USD)</label><input className="input" type="number" step="0.01" placeholder="0.00" value={formUSA.saldo_inicial} onChange={e => setFormUSA({...formUSA, saldo_inicial: e.target.value})} /></div>
                <div><label className="label">Notas</label><input className="input" value={formUSA.notas} onChange={e => setFormUSA({...formUSA, notas: e.target.value})} /></div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary flex-1 text-sm" disabled={saving}>Guardar</button>
                  <button type="button" className="btn-secondary flex-1 text-sm" onClick={() => setShowUSA(false)}>Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {/* Total USA */}
          <div className="card mb-3 text-white flex items-center justify-between" style={{ backgroundColor: '#1a1a2e' }}>
            <span className="text-xs font-bold text-[#2EDBB8] uppercase tracking-wide">Total Cuentas USA</span>
            <span className="text-xl font-bold">${fmt(totalUSA)}</span>
          </div>

          <div className="card">
            {cuentasUSA.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No hay cuentas USA cargadas</p>
            ) : (
              <div className="space-y-3">
                {cuentasUSA.map(c => (
                  <div key={c.id} onClick={() => abrirDetalle(c)} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-1"><span className="text-gray-300 text-xs">▶</span>{c.nombre}</div>
                      {c.banco && <div className="text-xs text-gray-400 pl-3">{c.banco}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm text-[#1a1a2e]">${fmt(saldoCuenta(c))}</div>
                        {movsPorCuenta[c.id] ? <div className="text-[10px] text-gray-400">inicial ${fmt(c.saldo_inicial || 0)}</div> : null}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); toggleUSA(c.id, c.activa) }} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${c.activa ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                        {c.activa ? 'Activa' : 'Inactiva'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cuentas Pesos TT */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#1a1a2e] flex items-center gap-2">🏦 Cuentas Pesos TT</h2>
            <div className="flex items-center gap-2">
              <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => importarTodas(false)}>🔄 Actualizar del Sheet</button>
              <button className="btn-primary text-sm px-3 py-1.5" onClick={() => setShowPesos(true)}>+ Agregar</button>
            </div>
          </div>
          {syncMsg && <div className="text-xs text-gray-500 mb-2">{syncMsg}</div>}

          {showPesos && (
            <div className="card mb-4 border-[#2EDBB8] border">
              <form onSubmit={savePesos} className="space-y-3">
                <div><label className="label">Nombre / Titular</label><input className="input" value={formPesos.nombre} onChange={e => setFormPesos({...formPesos, nombre: e.target.value})} required /></div>
                <div><label className="label">Alias</label><input className="input" placeholder="Alias CBU/CVU..." value={formPesos.alias} onChange={e => setFormPesos({...formPesos, alias: e.target.value})} /></div>
                <div><label className="label">CBU/CVU</label><input className="input" value={formPesos.cbu} onChange={e => setFormPesos({...formPesos, cbu: e.target.value})} /></div>
                <div><label className="label">Saldo inicial (ARS)</label><input className="input" type="number" step="0.01" placeholder="0.00" value={formPesos.saldo_inicial} onChange={e => setFormPesos({...formPesos, saldo_inicial: e.target.value})} /></div>
                <div><label className="label">Notas</label><input className="input" value={formPesos.notas} onChange={e => setFormPesos({...formPesos, notas: e.target.value})} /></div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary flex-1 text-sm" disabled={saving}>Guardar</button>
                  <button type="button" className="btn-secondary flex-1 text-sm" onClick={() => setShowPesos(false)}>Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {/* Total Pesos TT */}
          <div className="card mb-3 text-white flex items-center justify-between" style={{ backgroundColor: '#1a1a2e' }}>
            <span className="text-xs font-bold text-[#2EDBB8] uppercase tracking-wide">Total Cuentas Pesos TT</span>
            <span className="text-xl font-bold">${fmt(totalPesos)}</span>
          </div>

          {/* Tickets no acreditados (se descuentan) */}
          {(() => {
            const totalNA = cuentasPesos.reduce((s, c) => s + (noAcredPorCuenta[c.id] || 0), 0)
            if (totalNA <= 0) return null
            return (
              <div className="card mb-3 border-2 border-amber-300 bg-amber-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">🎫 Total Tickets No Acreditados</span>
                  <span className="text-lg font-bold text-amber-700">− ${fmt(totalNA)}</span>
                </div>
                <div className="space-y-1">
                  {cuentasPesos.filter(c => (noAcredPorCuenta[c.id] || 0) > 0).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-xs text-gray-600">
                      <span>{c.nombre}</span>
                      <span className="font-mono">− ${fmt(noAcredPorCuenta[c.id] || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          <div className="card">
            {cuentasPesos.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No hay cuentas pesos TT cargadas</p>
            ) : (
              <div className="space-y-3">
                {cuentasPesos.map(c => (
                  <div key={c.id} onClick={() => abrirDetallePesos(c)} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-1"><span className="text-gray-300 text-xs">▶</span>{c.nombre}</div>
                      {c.alias && <div className="text-xs text-gray-400 pl-3">{c.alias}</div>}
                      {c.cbu && <div className="text-xs text-gray-300 font-mono pl-3">{c.cbu}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm text-[#1a1a2e]">${fmt(saldoPesos(c))}</div>
                        {movsPorPesos[c.id] ? <div className="text-[10px] text-gray-400">inicial ${fmt(c.saldo_inicial || 0)}</div> : null}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); togglePesos(c.id, c.activa) }} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${c.activa ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                        {c.activa ? 'Activa' : 'Inactiva'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal detalle cuenta USA */}
      {detalle && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetalle(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-[#1a1a2e] px-6 py-5 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-white">{detalle.nombre}</div>
                <div className="text-xs text-gray-400">{detalle.banco}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[#2EDBB8] uppercase font-bold">Saldo actual</div>
                <div className="text-2xl font-bold text-white">${fmt(saldoCuenta(detalle))}</div>
                <div className="text-[10px] text-gray-400">inicial ${fmt(detalle.saldo_inicial || 0)}</div>
              </div>
            </div>

            {/* Form nuevo movimiento */}
            <form onSubmit={guardarMov} className="px-6 py-4 bg-gray-50 border-b border-gray-100 grid grid-cols-5 gap-3 items-end">
              <div>
                <label className="label">Movimiento</label>
                <select className="input" value={movForm.tipo} onChange={e => setMovForm({...movForm, tipo: e.target.value})}>
                  <option value="bajada_cable">↓ Bajada (entra)</option>
                  <option value="subida_cable">↑ Subida (sale)</option>
                </select>
              </div>
              <div>
                <label className="label">Monto USD</label>
                <input className="input" type="number" step="0.01" placeholder="0.00" value={movForm.monto} onChange={e => setMovForm({...movForm, monto: e.target.value})} required />
              </div>
              <div>
                <label className="label">Cliente</label>
                <select className="input" value={movForm.cliente_id} onChange={e => setMovForm({...movForm, cliente_id: e.target.value})}>
                  <option value="">—</option>
                  {clientesList.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Fecha</label>
                <input className="input" type="date" value={movForm.fecha} onChange={e => setMovForm({...movForm, fecha: e.target.value})} />
              </div>
              <button type="submit" className="btn-primary text-sm">+ Cargar</button>
            </form>

            {/* Lista movimientos */}
            <div className="px-6 py-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Movimientos ({movsDetalle.length})</div>
              {movsDetalle.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">Sin movimientos de cable en esta cuenta</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {movsDetalle.map(m => {
                    const entra = m.tipo === 'bajada_cable' || m.tipo === 'bajada_cable_pesos' || m.tipo === 'bajada_cable_pesos_tt'
                    return (
                      <div key={m.id} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${entra ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {entra ? '↓ Bajada' : '↑ Subida'}
                          </span>
                          <div>
                            <div className="text-sm text-gray-700 font-medium">{m.clientes?.nombre || '—'}</div>
                            <div className="text-xs text-gray-400">{new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-AR')}{m.descripcion ? ` · ${m.descripcion}` : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold text-sm ${entra ? 'text-green-600' : 'text-red-500'}`}>
                            {entra ? '+' : '-'}${fmt(m.monto_usd)}
                          </span>
                          <button onClick={() => borrarMov(m.id)} className="text-red-300 hover:text-red-600 text-xs">✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100">
              <button onClick={() => setDetalle(null)} className="btn-secondary w-full">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle cuenta Pesos TT (recaudadora) */}
      {detallePesos && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetallePesos(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-[#1a1a2e] px-6 py-5 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-white">{detallePesos.nombre}</div>
                <div className="text-xs text-gray-400">Recaudadora · Pesos TT</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[#2EDBB8] uppercase font-bold">Saldo actual</div>
                <div className="text-2xl font-bold text-white">${fmt(saldoPesos(detallePesos))}</div>
                <div className="text-[10px] text-gray-400">inicial ${fmt(detallePesos.saldo_inicial || 0)}</div>
              </div>
            </div>

            {/* Importar del Sheet */}
            <div className="px-6 py-4 bg-[#f0fdf9] border-b border-gray-100">
              <div className="text-xs font-bold text-[#1a6b5a] uppercase tracking-wide mb-2">📥 Importar del Google Sheet</div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="label">URL de la solapa del mes</label>
                  <input className="input" placeholder="Pegá el link completo del Google Sheet de la solapa" value={gidInput} onChange={e => setGidInput(e.target.value)} />
                </div>
                <button type="button" onClick={importarSheet} disabled={importando} className="btn-primary text-sm disabled:opacity-50">
                  {importando ? 'Importando...' : 'Importar'}
                </button>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">Pegá la URL completa de la solapa (con …/d/ID/…#gid=…). Funciona con cualquier Sheet compartido con la cuenta de servicio. Reemplaza la importación anterior.</div>
            </div>

            {/* Form depósito/movimiento manual */}
            <form onSubmit={guardarMovPesos} className="px-6 py-4 bg-gray-50 border-b border-gray-100 grid grid-cols-5 gap-3 items-end">
              <div>
                <label className="label">Mov.</label>
                <select className="input" value={movPForm.sentido} onChange={e => setMovPForm({...movPForm, sentido: e.target.value})}>
                  <option value="ingreso">↓ Ingreso</option>
                  <option value="egreso">↑ Egreso</option>
                </select>
              </div>
              <div>
                <label className="label">Monto ARS</label>
                <input className="input" type="number" step="0.01" placeholder="0.00" value={movPForm.monto} onChange={e => setMovPForm({...movPForm, monto: e.target.value})} required />
              </div>
              <div>
                <label className="label">Titular</label>
                <input className="input" placeholder="Quién deposita" value={movPForm.titular} onChange={e => setMovPForm({...movPForm, titular: e.target.value})} />
              </div>
              <div>
                <label className="label">Cliente</label>
                <select className="input" value={movPForm.cliente_id} onChange={e => setMovPForm({...movPForm, cliente_id: e.target.value})}>
                  <option value="">—</option>
                  {clientesList.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <button type="submit" className="btn-primary text-sm">+ Cargar</button>
            </form>
            <div className="px-6 pb-2 -mt-2">
              <input className="input text-xs" type="date" value={movPForm.fecha} onChange={e => setMovPForm({...movPForm, fecha: e.target.value})} style={{maxWidth:'180px'}} />
            </div>

            <div className="px-6 py-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Movimientos ({movsPesos.length})</div>
              {movsPesos.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">Sin movimientos cargados</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {movsPesos.map(m => {
                    const entra = m.tipo === 'ajuste_ars_tt'
                    return (
                      <div key={m.id} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${entra ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {entra ? '↓ Ingreso' : '↑ Egreso'}
                          </span>
                          <div>
                            <div className="text-sm text-gray-700 font-medium">{m.descripcion || '—'}</div>
                            <div className="text-xs text-gray-400">{new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-AR')}{m.clientes?.nombre ? ` · ${m.clientes.nombre}` : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold text-sm ${entra ? 'text-green-600' : 'text-red-500'}`}>
                            {entra ? '+' : '-'}${fmt(m.monto_pesos)}
                          </span>
                          <button onClick={() => borrarMovPesos(m.id)} className="text-red-300 hover:text-red-600 text-xs">✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100">
              <button onClick={() => setDetallePesos(null)} className="btn-secondary w-full">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
