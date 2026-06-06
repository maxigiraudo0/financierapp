'use client'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Cliente { id: string; nombre: string }
interface SaldoCalle {
  id: string; cliente_id: string | null; moneda: string; monto: number
  descripcion: string; fecha: string; activo: boolean; direccion: string
  clientes: { nombre: string } | null
}
interface ClienteResumen {
  cliente_id: string | null; nombre: string
  deben_usd: number; debo_usd: number
  deben_ars: number; debo_ars: number
  deben_usdt: number; debo_usdt: number
  deben_eur: number; debo_eur: number
  registros: SaldoCalle[]
}

const today = new Date().toISOString().split('T')[0]

export default function CallePage() {
  const [saldos, setSaldos] = useState<SaldoCalle[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showForm, setShowForm] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<ClienteResumen | null>(null)
  const [form, setForm] = useState({
    cliente_id: '', deben_usd: '', debo_usd: '',
    deben_ars: '', debo_ars: '', deben_usdt: '', debo_usdt: '',
    deben_eur: '', debo_eur: '', descripcion: '', fecha: today
  })
  const [pagoForm, setPagoForm] = useState({ deben_usd:'', debo_usd:'', deben_ars:'', debo_ars:'', deben_usdt:'', debo_usdt:'', deben_eur:'', debo_eur:'', descripcion:'', fecha: today })
  const [saving, setSaving] = useState(false)
  const [savingPago, setSavingPago] = useState(false)
  const [soloActivos, setSoloActivos] = useState(true)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase.from('saldo_calle')
        .select('id, cliente_id, moneda, monto, descripcion, fecha, activo, direccion, clientes(nombre)')
        .order('fecha', { ascending: false }),
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    if (s) setSaldos(s as unknown as SaldoCalle[])
    if (c) setClientes(c)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const registros: any[] = []
    const add = (dir: string, moneda: string, val: string) => {
      const m = parseFloat(val)
      if (m > 0) registros.push({ cliente_id: form.cliente_id || null, moneda, monto: m, direccion: dir, descripcion: form.descripcion || null, fecha: form.fecha, activo: true })
    }
    add('deben','USD',form.deben_usd); add('debo','USD',form.debo_usd)
    add('deben','ARS',form.deben_ars); add('debo','ARS',form.debo_ars)
    add('deben','USDT',form.deben_usdt); add('debo','USDT',form.debo_usdt)
    add('deben','EUR',form.deben_eur); add('debo','EUR',form.debo_eur)
    if (registros.length === 0) { setSaving(false); setShowForm(false); return }
    const { error } = await supabase.from('saldo_calle').insert(registros)
    if (error) { alert(error.message); setSaving(false); return }
    setShowForm(false)
    setForm({ cliente_id:'',deben_usd:'',debo_usd:'',deben_ars:'',debo_ars:'',deben_usdt:'',debo_usdt:'',deben_eur:'',debo_eur:'',descripcion:'',fecha:today })
    setSaving(false); loadAll()
  }

  const handlePago = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clienteSeleccionado) return
    setSavingPago(true)

    // Borrar todos los registros actuales del cliente
    for (const reg of clienteSeleccionado.registros) {
      await supabase.from('saldo_calle').delete().eq('id', reg.id)
    }

    // Insertar los nuevos valores
    const registros: any[] = []
    const add = (dir: string, moneda: string, val: string) => {
      const m = parseFloat(val)
      if (m > 0) registros.push({
        cliente_id: clienteSeleccionado.cliente_id,
        moneda, monto: m, direccion: dir,
        descripcion: pagoForm.descripcion || null,
        fecha: pagoForm.fecha, activo: true
      })
    }
    add('deben','USD',  pagoForm.deben_usd)
    add('debo', 'USD',  pagoForm.debo_usd)
    add('deben','ARS',  pagoForm.deben_ars)
    add('debo', 'ARS',  pagoForm.debo_ars)
    add('deben','USDT', pagoForm.deben_usdt)
    add('debo', 'USDT', pagoForm.debo_usdt)
    add('deben','EUR',  pagoForm.deben_eur)
    add('debo', 'EUR',  pagoForm.debo_eur)

    if (registros.length > 0) {
      const { error } = await supabase.from('saldo_calle').insert(registros)
      if (error) { alert('Error: ' + error.message); setSavingPago(false); return }
    }

    setSavingPago(false)
    setClienteSeleccionado(null)
    setPagoForm({ deben_usd:'',debo_usd:'',deben_ars:'',debo_ars:'',deben_usdt:'',debo_usdt:'',deben_eur:'',debo_eur:'',descripcion:'',fecha:today })
    loadAll()
  }

  const handleDeleteCliente = async (registros: SaldoCalle[]) => {
    if (!confirm('¿Eliminar todos los registros de este cliente?')) return
    for (const r of registros) await supabase.from('saldo_calle').delete().eq('id', r.id)
    loadAll()
  }

  // Agrupar por cliente — solo activos + pagos
  const resumenMap: Record<string, ClienteResumen> = {}
  saldos.forEach(s => {
    const key = s.cliente_id || 'gen'
    const nombre = s.clientes?.nombre || '— General —'
    if (!resumenMap[key]) resumenMap[key] = { cliente_id: s.cliente_id || null, nombre, deben_usd:0,debo_usd:0,deben_ars:0,debo_ars:0,deben_usdt:0,debo_usdt:0,deben_eur:0,debo_eur:0, registros:[] }
    const r = resumenMap[key]
    r.registros.push(s)
    if (!s.activo) return // pagos no suman al saldo
    const sign = s.direccion === 'deben' ? 1 : -1
    // Si es pago, resta
    const isPago = s.direccion.startsWith('pago_')
    if (isPago) return
    if (s.direccion === 'deben') {
      if (s.moneda === 'USD')  r.deben_usd  += s.monto
      if (s.moneda === 'ARS')  r.deben_ars  += s.monto
      if (s.moneda === 'USDT') r.deben_usdt += s.monto
      if (s.moneda === 'EUR')  r.deben_eur  += s.monto
    } else {
      if (s.moneda === 'USD')  r.debo_usd  += s.monto
      if (s.moneda === 'ARS')  r.debo_ars  += s.monto
      if (s.moneda === 'USDT') r.debo_usdt += s.monto
      if (s.moneda === 'EUR')  r.debo_eur  += s.monto
    }
  })

  const resumen = Object.values(resumenMap)
    .filter(r => soloActivos ? (r.deben_usd+r.debo_usd+r.deben_ars+r.debo_ars+r.deben_usdt+r.debo_usdt+r.deben_eur+r.debo_eur) > 0 : true)
    .sort((a,b) => a.nombre.localeCompare(b.nombre))

  const tot = resumen.reduce((acc,r) => ({
    deben_usd: acc.deben_usd+r.deben_usd, debo_usd: acc.debo_usd+r.debo_usd,
    deben_ars: acc.deben_ars+r.deben_ars, debo_ars: acc.debo_ars+r.debo_ars,
  }), { deben_usd:0,debo_usd:0,deben_ars:0,debo_ars:0 })

  const f = (n: number, dec=2) => n.toLocaleString('es-AR',{minimumFractionDigits:dec,maximumFractionDigits:dec})
  const fv = (n: number) => n === 0 ? null : n > 0 ? `$${f(n)}` : `-$${f(Math.abs(n))}`

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">🚶 En la Calle</h1>
          <p className="text-gray-500 text-sm mt-1">Saldos pendientes por cliente</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} className="rounded" />
            Solo con saldo
          </label>
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ Cargar</button>
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-5 border-l-4 border-green-400 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">✅ Me deben USD</div>
          <div className="text-2xl font-bold text-green-600">${f(tot.deben_usd)}</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border-l-4 border-red-400 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">❌ Debo USD</div>
          <div className="text-2xl font-bold text-red-500">${f(tot.debo_usd)}</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border-l-4 border-green-300 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">✅ Me deben ARS</div>
          <div className="text-2xl font-bold text-green-600">${f(tot.deben_ars, 0)}</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border-l-4 border-red-300 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">❌ Debo ARS</div>
          <div className="text-2xl font-bold text-red-500">${f(tot.debo_ars, 0)}</div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#1a1a2e] text-white">
              <th className="px-5 py-4 text-left font-semibold">Cliente</th>
              <th className="px-4 py-4 text-right font-semibold text-green-300">Me deben USD</th>
              <th className="px-4 py-4 text-right font-semibold text-red-300">Debo USD</th>
              <th className="px-4 py-4 text-right font-semibold text-green-300">Me deben ARS</th>
              <th className="px-4 py-4 text-right font-semibold text-red-300">Debo ARS</th>
              <th className="px-4 py-4 text-right font-semibold text-gray-400 text-xs">USDT / EUR</th>
              <th className="px-4 py-4 text-center font-semibold text-xs text-gray-400">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((r, i) => (
              <tr key={r.cliente_id || 'gen'}
                className={`border-b border-gray-50 hover:bg-[#f0fdf9] transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-5 py-4">
                  <span className="font-semibold text-[#1a1a2e]">{r.nombre}</span>
                </td>
                <td className="px-4 py-4 text-right font-mono font-bold text-green-600">
                  {r.deben_usd > 0 ? `$${f(r.deben_usd)}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-4 text-right font-mono font-bold text-red-500">
                  {r.debo_usd > 0 ? `$${f(r.debo_usd)}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-4 text-right font-mono text-green-600">
                  {r.deben_ars > 0 ? `$${f(r.deben_ars,0)}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-4 text-right font-mono text-red-500">
                  {r.debo_ars > 0 ? `$${f(r.debo_ars,0)}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-4 text-right text-xs text-gray-400 space-y-0.5">
                  {r.deben_usdt > 0 && <div className="text-green-500">+◎{f(r.deben_usdt)}</div>}
                  {r.debo_usdt > 0  && <div className="text-red-400">-◎{f(r.debo_usdt)}</div>}
                  {r.deben_eur > 0  && <div className="text-green-500">+€{f(r.deben_eur)}</div>}
                  {r.debo_eur > 0   && <div className="text-red-400">-€{f(r.debo_eur)}</div>}
                  {!r.deben_usdt && !r.debo_usdt && !r.deben_eur && !r.debo_eur && <span className="text-gray-200">—</span>}
                </td>
                <td className="px-4 py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => { setClienteSeleccionado(r); setPagoForm({ deben_usd: r.deben_usd > 0 ? String(r.deben_usd) : '', debo_usd: r.debo_usd > 0 ? String(r.debo_usd) : '', deben_ars: r.deben_ars > 0 ? String(r.deben_ars) : '', debo_ars: r.debo_ars > 0 ? String(r.debo_ars) : '', deben_usdt: r.deben_usdt > 0 ? String(r.deben_usdt) : '', debo_usdt: r.debo_usdt > 0 ? String(r.debo_usdt) : '', deben_eur: r.deben_eur > 0 ? String(r.deben_eur) : '', debo_eur: r.debo_eur > 0 ? String(r.debo_eur) : '', descripcion:'', fecha:today }) }}
                      className="bg-[#2EDBB8] text-[#1a1a2e] text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-[#25c4a4] transition-colors"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => handleDeleteCliente(r.registros)}
                      className="text-red-300 hover:text-red-600 hover:bg-red-50 text-xs px-2 py-1.5 rounded-lg transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {resumen.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">No hay saldos pendientes</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-[#1a1a2e] text-white font-bold">
              <td className="px-5 py-4 text-sm">TOTAL</td>
              <td className="px-4 py-4 text-right font-mono text-green-300">${f(tot.deben_usd)}</td>
              <td className="px-4 py-4 text-right font-mono text-red-300">${f(tot.debo_usd)}</td>
              <td className="px-4 py-4 text-right font-mono text-green-300">${f(tot.deben_ars,0)}</td>
              <td className="px-4 py-4 text-right font-mono text-red-300">${f(tot.debo_ars,0)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Modal Pago */}
      {clienteSeleccionado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-[#1a1a2e] px-6 py-5">
              <div className="text-xs font-bold text-[#2EDBB8] uppercase tracking-wide mb-1">Editar Saldo</div>
              <div className="text-xl font-bold text-white">{clienteSeleccionado.nombre}</div>
            </div>

            {/* Saldo actual */}
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Saldo Actual</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {clienteSeleccionado.deben_usd > 0 && <div className="bg-green-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Me deben USD</div><div className="font-bold text-green-600">${f(clienteSeleccionado.deben_usd)}</div></div>}
                {clienteSeleccionado.debo_usd > 0  && <div className="bg-red-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Debo USD</div><div className="font-bold text-red-500">${f(clienteSeleccionado.debo_usd)}</div></div>}
                {clienteSeleccionado.deben_ars > 0 && <div className="bg-green-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Me deben ARS</div><div className="font-bold text-green-600">${f(clienteSeleccionado.deben_ars,0)}</div></div>}
                {clienteSeleccionado.debo_ars > 0  && <div className="bg-red-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Debo ARS</div><div className="font-bold text-red-500">${f(clienteSeleccionado.debo_ars,0)}</div></div>}
                {clienteSeleccionado.deben_usdt > 0 && <div className="bg-blue-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Me deben USDT</div><div className="font-bold text-blue-600">◎{f(clienteSeleccionado.deben_usdt)}</div></div>}
                {clienteSeleccionado.debo_usdt > 0  && <div className="bg-blue-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Debo USDT</div><div className="font-bold text-blue-500">◎{f(clienteSeleccionado.debo_usdt)}</div></div>}
                {clienteSeleccionado.deben_eur > 0 && <div className="bg-yellow-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Me deben EUR</div><div className="font-bold text-yellow-600">€{f(clienteSeleccionado.deben_eur)}</div></div>}
                {clienteSeleccionado.debo_eur > 0  && <div className="bg-yellow-50 rounded-lg p-3"><div className="text-xs text-gray-400 mb-1">Debo EUR</div><div className="font-bold text-yellow-500">€{f(clienteSeleccionado.debo_eur)}</div></div>}
              </div>
            </div>

            {/* Form edicion */}
            <form onSubmit={handlePago} className="px-6 py-5 space-y-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Editá los saldos</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-green-600">Me deben USD</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.deben_usd} onChange={e => setPagoForm({...pagoForm,deben_usd:e.target.value})} />
                </div>
                <div>
                  <label className="label text-red-500">Debo USD</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.debo_usd} onChange={e => setPagoForm({...pagoForm,debo_usd:e.target.value})} />
                </div>
                <div>
                  <label className="label text-green-600">Me deben ARS</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.deben_ars} onChange={e => setPagoForm({...pagoForm,deben_ars:e.target.value})} />
                </div>
                <div>
                  <label className="label text-red-500">Debo ARS</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.debo_ars} onChange={e => setPagoForm({...pagoForm,debo_ars:e.target.value})} />
                </div>
                <div>
                  <label className="label text-green-600">Me deben USDT</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.deben_usdt} onChange={e => setPagoForm({...pagoForm,deben_usdt:e.target.value})} />
                </div>
                <div>
                  <label className="label text-red-500">Debo USDT</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.debo_usdt} onChange={e => setPagoForm({...pagoForm,debo_usdt:e.target.value})} />
                </div>
                <div>
                  <label className="label text-green-600">Me deben EUR</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.deben_eur} onChange={e => setPagoForm({...pagoForm,deben_eur:e.target.value})} />
                </div>
                <div>
                  <label className="label text-red-500">Debo EUR</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={pagoForm.debo_eur} onChange={e => setPagoForm({...pagoForm,debo_eur:e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Fecha</label>
                  <input className="input" type="date" value={pagoForm.fecha} onChange={e => setPagoForm({...pagoForm, fecha: e.target.value})} />
                </div>
                <div>
                  <label className="label">Nota</label>
                  <input className="input" placeholder="Detalle..." value={pagoForm.descripcion} onChange={e => setPagoForm({...pagoForm, descripcion: e.target.value})} />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" className="btn-primary flex-1 py-3" disabled={savingPago}>
                  {savingPago ? 'Guardando...' : '✓ Guardar'}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setClienteSeleccionado(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nuevo Saldo */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-1">Cargar Saldo en la Calle</h2>
            <p className="text-sm text-gray-500 mb-5">Dejá en blanco lo que no aplique</p>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Cliente</label>
                <select className="input" value={form.cliente_id} onChange={e => setForm({...form, cliente_id: e.target.value})}>
                  <option value="">— Seleccionar —</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="border border-gray-100 rounded-xl p-4">
                <div className="text-xs font-bold text-gray-500 uppercase mb-3">💵 USD</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label text-green-600">Me deben</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.deben_usd} onChange={e => setForm({...form,deben_usd:e.target.value})} /></div>
                  <div><label className="label text-red-500">Debo</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.debo_usd} onChange={e => setForm({...form,debo_usd:e.target.value})} /></div>
                </div>
              </div>
              <div className="border border-gray-100 rounded-xl p-4">
                <div className="text-xs font-bold text-gray-500 uppercase mb-3">💵 ARS</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label text-green-600">Me deben</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.deben_ars} onChange={e => setForm({...form,deben_ars:e.target.value})} /></div>
                  <div><label className="label text-red-500">Debo</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.debo_ars} onChange={e => setForm({...form,debo_ars:e.target.value})} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-gray-100 rounded-xl p-4">
                  <div className="text-xs font-bold text-gray-500 uppercase mb-3">◎ USDT</div>
                  <div><label className="label text-green-600">Me deben</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.deben_usdt} onChange={e => setForm({...form,deben_usdt:e.target.value})} /></div>
                  <div className="mt-2"><label className="label text-red-500">Debo</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.debo_usdt} onChange={e => setForm({...form,debo_usdt:e.target.value})} /></div>
                </div>
                <div className="border border-gray-100 rounded-xl p-4">
                  <div className="text-xs font-bold text-gray-500 uppercase mb-3">🇪🇺 EUR</div>
                  <div><label className="label text-green-600">Me deben</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.deben_eur} onChange={e => setForm({...form,deben_eur:e.target.value})} /></div>
                  <div className="mt-2"><label className="label text-red-500">Debo</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.debo_eur} onChange={e => setForm({...form,debo_eur:e.target.value})} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Fecha</label><input className="input" type="date" value={form.fecha} onChange={e => setForm({...form,fecha:e.target.value})} /></div>
                <div><label className="label">Descripción</label><input className="input" placeholder="Detalle..." value={form.descripcion} onChange={e => setForm({...form,descripcion:e.target.value})} /></div>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving?'Guardando...':'Guardar'}</button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
