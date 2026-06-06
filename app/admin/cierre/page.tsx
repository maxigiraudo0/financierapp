'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sumDeltas, ZERO_DELTA, type StockDelta } from '@/lib/deltas'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Cierre {
  id: string; fecha: string; saldo_usd_cash: number; saldo_usd_transfer: number
  saldo_usdt: number; saldo_eur: number; saldo_pesos_transfer: number
  saldo_pesos_cash: number; saldo_cuentas_usa: number
  saldo_calle_usd: number; saldo_calle_ars: number
  notas: string; cerrado: boolean
}

const today = new Date().toISOString().split('T')[0]
const emptyForm = {
  fecha: today, saldo_usd_cash: '', saldo_usd_transfer: '', saldo_usdt: '',
  saldo_eur: '', saldo_pesos_transfer: '', saldo_pesos_cash: '',
  saldo_cuentas_usa: '', saldo_calle_usd: '', saldo_calle_ars: '', notas: ''
}

export default function CierrePage() {
  const [cierres, setCierres] = useState<Cierre[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [cerrandoLote, setCerrandoLote] = useState(false)

  useEffect(() => { loadCierres() }, [])

  // Calcula los saldos actuales (igual que el dashboard) y genera el cierre de hoy
  const cerrarLote = async () => {
    if (!confirm('¿Generar el cierre de hoy con los saldos actuales del sistema?')) return
    setCerrandoLote(true)

    // 1. Último cierre como base
    const { data: cierresPrev } = await supabase.from('cierres_diarios')
      .select('*').eq('cerrado', true).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(1)
    const prev = cierresPrev?.[0] || null

    // 2. Saldos iniciales de cuentas (si no hay cierre previo)
    const { data: cuentasUsa } = await supabase.from('cuentas_usa').select('saldo_inicial')
    const usaInicial = (cuentasUsa || []).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0)
    const { data: cuentasTt } = await supabase.from('cuentas_pesos_tt').select('saldo_inicial')
    const ttInicial = (cuentasTt || []).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0)

    // 3. Operaciones NO archivadas (las del lote en curso)
    const cols = 'tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, medio, pendiente, costo_wire, wire_absorbe, comision_usd'
    const { data: ops } = await supabase.from('operaciones').select(cols).eq('archivado', false)

    const base: StockDelta = prev ? {
      usd: (prev.saldo_usd_cash || 0) + (prev.saldo_usd_transfer || 0),
      usdt: prev.saldo_usdt || 0, eur: prev.saldo_eur || 0,
      ars_cash: prev.saldo_pesos_cash || 0, ars_tt: prev.saldo_pesos_transfer || 0,
      usa: prev.saldo_cuentas_usa || 0,
    } : { ...ZERO_DELTA, usa: usaInicial, ars_tt: ttInicial }

    const d = ops ? sumDeltas(ops.map(o => ({
      tipo: o.tipo, monto_usd: Number(o.monto_usd) || 0, monto_usdt: Number(o.monto_usdt) || 0,
      monto_pesos: Number(o.monto_pesos) || 0, monto_eur: Number(o.monto_eur) || 0,
      medio: o.medio, pendiente: o.pendiente,
      costo_wire: Number(o.costo_wire) || null, wire_absorbe: o.wire_absorbe, comision_usd: Number(o.comision_usd) || null,
    }))) : { ...ZERO_DELTA }

    // 4. Calle (neto me deben - le debo)
    const { data: calle } = await supabase.from('saldo_calle').select('moneda, monto, direccion').eq('activo', true)
    const netoCalle = (m: string) => (calle || []).filter(c => c.moneda === m)
      .reduce((s, c) => s + (c.direccion === 'deben' ? c.monto : -c.monto), 0)

    const payload = {
      fecha: today,
      saldo_usd_cash: base.usd + d.usd,
      saldo_usd_transfer: 0,
      saldo_usdt: base.usdt + d.usdt,
      saldo_eur: base.eur + d.eur,
      saldo_pesos_transfer: base.ars_tt + d.ars_tt,
      saldo_pesos_cash: base.ars_cash + d.ars_cash,
      saldo_cuentas_usa: base.usa + d.usa,
      saldo_calle_usd: netoCalle('USD'),
      saldo_calle_ars: netoCalle('ARS'),
      notas: 'Cierre automático',
      cerrado: true,
    }
    const { error } = await supabase.from('cierres_diarios').upsert(payload, { onConflict: 'fecha' })
    if (error) { setCerrandoLote(false); alert(error.message); return }

    // 5. Archivar las operaciones del lote (quedan guardadas pero salen del cálculo activo)
    await supabase.from('operaciones').update({ archivado: true }).eq('archivado', false)

    setCerrandoLote(false)
    alert('✓ Lote cerrado. Las operaciones quedaron archivadas y el próximo día arranca desde este cierre.')
    loadCierres()
  }

  const loadCierres = async () => {
    const { data } = await supabase.from('cierres_diarios').select('*').order('fecha', { ascending: false }).limit(60)
    if (data) setCierres(data)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const payload = {
      fecha: form.fecha,
      saldo_usd_cash: parseFloat(form.saldo_usd_cash) || 0,
      saldo_usd_transfer: parseFloat(form.saldo_usd_transfer) || 0,
      saldo_usdt: parseFloat(form.saldo_usdt) || 0,
      saldo_eur: parseFloat(form.saldo_eur) || 0,
      saldo_pesos_transfer: parseFloat(form.saldo_pesos_transfer) || 0,
      saldo_pesos_cash: parseFloat(form.saldo_pesos_cash) || 0,
      saldo_cuentas_usa: parseFloat(form.saldo_cuentas_usa) || 0,
      saldo_calle_usd: parseFloat(form.saldo_calle_usd) || 0,
      saldo_calle_ars: parseFloat(form.saldo_calle_ars) || 0,
      notas: form.notas || null,
      cerrado: true,
    }
    const { error } = await supabase.from('cierres_diarios').upsert(payload, { onConflict: 'fecha' })
    if (error) { alert(error.message); setSaving(false); return }
    setShowForm(false); setForm({ ...emptyForm, fecha: today }); setSaving(false); loadCierres()
  }

  const f = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 })

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">📋 Cierre Diario</h1>
          <p className="text-gray-500 text-sm mt-1">Snapshot de saldos al cierre del día</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={cerrarLote} disabled={cerrandoLote}>
            {cerrandoLote ? 'Cerrando...' : '✓ Cerrar Lote (automático)'}
          </button>
          <button className="btn-secondary" onClick={() => { setShowForm(true); setForm({...emptyForm, fecha: today}) }}>
            + Cierre manual
          </button>
        </div>
      </div>

      <div className="card mb-6 bg-[#f0fdf9] border border-[#2EDBB8]/30 text-sm text-gray-600">
        💡 <strong>Cerrar Lote</strong> toma automáticamente los saldos actuales del sistema (los mismos del dashboard) y genera el cierre de hoy. Usalo una vez que conciliaste que todo está OK.
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-2">Cierre del día</h2>
            <p className="text-sm text-gray-500 mb-6">Ingresá los saldos chequeados al cierre</p>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Fecha</label>
                <input className="input" type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} required />
              </div>

              <div className="bg-green-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-1">💵 USD</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">USD Cash</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_usd_cash} onChange={e => setForm({...form, saldo_usd_cash: e.target.value})} /></div>
                  <div><label className="label">USD Transfer</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_usd_transfer} onChange={e => setForm({...form, saldo_usd_transfer: e.target.value})} /></div>
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1">◎ USDT / 🇪🇺 EUR</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">USDT</label><input className="input" type="number" step="0.0001" placeholder="0.00" value={form.saldo_usdt} onChange={e => setForm({...form, saldo_usdt: e.target.value})} /></div>
                  <div><label className="label">Euros</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_eur} onChange={e => setForm({...form, saldo_eur: e.target.value})} /></div>
                </div>
              </div>

              <div className="bg-orange-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-orange-700 uppercase tracking-wide mb-1">💰 Pesos</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Pesos Transfer</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_pesos_transfer} onChange={e => setForm({...form, saldo_pesos_transfer: e.target.value})} /></div>
                  <div><label className="label">Pesos Cash</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_pesos_cash} onChange={e => setForm({...form, saldo_pesos_cash: e.target.value})} /></div>
                </div>
              </div>

              <div className="bg-purple-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-1">🇺🇸 Cuentas USA</div>
                <div><label className="label">Total Cuentas USA (USD)</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_cuentas_usa} onChange={e => setForm({...form, saldo_cuentas_usa: e.target.value})} /></div>
              </div>

              <div className="bg-red-50 rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">🚶 En la Calle</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Calle USD</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_calle_usd} onChange={e => setForm({...form, saldo_calle_usd: e.target.value})} /></div>
                  <div><label className="label">Calle ARS</label><input className="input" type="number" step="0.01" placeholder="0.00" value={form.saldo_calle_ars} onChange={e => setForm({...form, saldo_calle_ars: e.target.value})} /></div>
                </div>
              </div>

              <div>
                <label className="label">Notas del cierre</label>
                <textarea className="input" rows={2} placeholder="Observaciones del día..." value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} />
              </div>

              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Cerrando...' : '✓ Cerrar Día'}</button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lista de cierres */}
      <div className="space-y-4">
        {cierres.length === 0 && <div className="card text-center text-gray-400 py-12">No hay cierres registrados todavía</div>}
        {cierres.map(c => (
          <div key={c.id} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="text-lg font-bold text-[#1a1a2e]">
                  {format(new Date(c.fecha + 'T12:00:00'), "EEEE dd 'de' MMMM yyyy", { locale: es })}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-bold ${c.cerrado ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {c.cerrado ? '✓ Cerrado' : 'Borrador'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm md:grid-cols-5">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">USD Cash</div>
                <div className="font-bold">${f(c.saldo_usd_cash)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">USD Transfer</div>
                <div className="font-bold">${f(c.saldo_usd_transfer)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">USDT</div>
                <div className="font-bold">◎{f(c.saldo_usdt)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">EUR</div>
                <div className="font-bold">€{f(c.saldo_eur)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Pesos TT</div>
                <div className="font-bold">${f(c.saldo_pesos_transfer)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Pesos Cash</div>
                <div className="font-bold">${f(c.saldo_pesos_cash)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Cuentas USA</div>
                <div className="font-bold">${f(c.saldo_cuentas_usa)}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <div className="text-xs text-red-400 mb-1">Calle USD</div>
                <div className="font-bold text-red-700">${f(c.saldo_calle_usd)}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <div className="text-xs text-red-400 mb-1">Calle ARS</div>
                <div className="font-bold text-red-700">${f(c.saldo_calle_ars)}</div>
              </div>
            </div>
            {c.notas && <div className="mt-3 text-sm text-gray-500 bg-yellow-50 px-3 py-2 rounded-lg">📝 {c.notas}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
