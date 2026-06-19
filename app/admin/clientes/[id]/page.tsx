'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, OPERATION_LABELS, OPERATION_COLORS, type OperationType } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Cliente { id: string; nombre: string; email: string; telefono: string; sheet_id?: string; sheet_gid?: string; sheet_celda?: string }
interface Operacion {
  id: string; tipo: string; monto_usd: number; monto_usdt: number
  monto_pesos: number; monto_eur: number; tipo_cambio: number
  pendiente: string | null; descripcion: string; fecha: string
}
interface Calle {
  id: string; moneda: string; monto: number; direccion: string
  descripcion: string; fecha: string; activo: boolean; conciliado: boolean
}

const MONEDAS = ['USD', 'ARS', 'USDT', 'EUR']

export default function ClienteDetallePage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [ops, setOps] = useState<Operacion[]>([])
  const [calle, setCalle] = useState<Calle[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'cuenta' | 'operaciones'>('cuenta')
  const [sheetUrl, setSheetUrl] = useState('')
  const [sheetCelda, setSheetCelda] = useState('J10')
  const [impSheet, setImpSheet] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState(false)

  const importarClienteSheet = async () => {
    const t = sheetUrl.trim()
    const idM = t.match(/\/d\/([a-zA-Z0-9_-]+)/)
    const gidM = t.match(/[?#&]gid=(\d+)/)
    if (!idM || !gidM) { alert('Pegá la URL completa del Sheet (con /d/ID y #gid=)'); return }
    setImpSheet(true)
    const res = await fetch('/api/import-cliente-sheet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: id, sheet_id: idM[1], gid: gidM[1], celda: sheetCelda.trim() || 'J10' }),
    })
    const json = await res.json()
    setImpSheet(false)
    if (!res.ok) { alert('Error: ' + json.error); return }
    alert(`✓ Solapa: ${json.solapa}\nCelda ${json.celda} = US$${(json.valor||0).toLocaleString('es-AR')}\nCargado como "le debo USD"`)
    load()
  }

  useEffect(() => { load() }, [id])

  const load = async () => {
    const [{ data: c }, { data: o }, { data: sc }] = await Promise.all([
      supabase.from('clientes').select('id, nombre, email, telefono, sheet_id, sheet_gid, sheet_celda').eq('id', id).single(),
      supabase.from('operaciones').select('id, tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, tipo_cambio, pendiente, descripcion, fecha').eq('cliente_id', id).order('fecha', { ascending: false }),
      supabase.from('saldo_calle').select('id, moneda, monto, direccion, descripcion, fecha, activo, conciliado').eq('cliente_id', id).order('fecha', { ascending: false }),
    ])
    if (c) {
      setCliente(c)
      if (c.sheet_celda) setSheetCelda(c.sheet_celda)
      if (c.sheet_id && c.sheet_gid) setSheetUrl(`https://docs.google.com/spreadsheets/d/${c.sheet_id}/edit#gid=${c.sheet_gid}`)
    }
    if (o) setOps(o as unknown as Operacion[])
    if (sc) setCalle(sc as unknown as Calle[])
    setLoading(false)
  }

  const f = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  const sym = (m: string) => m === 'USDT' ? '◎' : m === 'EUR' ? '€' : '$'

  // Saldo neto por moneda (deben - debo) — positivo = me debe
  const saldo = (m: string) => calle.filter(c => c.moneda === m && c.activo)
    .reduce((s, c) => s + (c.direccion === 'deben' ? c.monto : -c.monto), 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  if (!cliente) return <div className="text-center py-16 text-gray-400">Cliente no encontrado</div>

  return (
    <div>
      {/* Header */}
      <button onClick={() => router.push('/admin/clientes')} className="text-sm text-gray-400 hover:text-gray-600 mb-3">← Volver a clientes</button>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{cliente.nombre}</h1>
          <p className="text-gray-500 text-sm mt-1">{cliente.email}{cliente.telefono ? ` · ${cliente.telefono}` : ''}</p>
        </div>
        <button
          onClick={() => {
            const link = `${window.location.origin}/cuenta/${id}`
            navigator.clipboard?.writeText(link).then(() => setLinkCopiado(true)).catch(() => {})
            setTimeout(() => setLinkCopiado(false), 2500)
            window.prompt('Link de la cuenta del cliente (copialo y pasáselo):', link)
          }}
          className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
          {linkCopiado ? '✓ Link copiado' : '🔗 Generar link cliente'}
        </button>
      </div>

      {/* Saldos en la calle */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {MONEDAS.map(m => {
          const s = saldo(m)
          if (s === 0) return null
          const meDebe = s > 0
          return (
            <div key={m} className={`card border-l-4 ${meDebe ? 'border-green-400' : 'border-red-400'}`}>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{m}</div>
              <div className={`text-xl font-bold ${meDebe ? 'text-green-600' : 'text-red-500'}`}>{sym(m)}{f(Math.abs(s), m === 'ARS' ? 0 : 2)}</div>
              <div className="text-xs text-gray-400 mt-1">{meDebe ? 'Me debe' : 'Le debo'}</div>
            </div>
          )
        })}
        {MONEDAS.every(m => saldo(m) === 0) && (
          <div className="col-span-4 card text-center text-gray-400">Sin saldo pendiente</div>
        )}
      </div>

      {/* Sheet del cliente (liquidación USD) */}
      <div className="card mb-6 bg-[#f0fdf9] border border-[#2EDBB8]/40">
        <div className="text-xs font-bold text-[#1a6b5a] uppercase tracking-wide mb-3">📄 Sheet del cliente — liquidación USD</div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">URL del Sheet</label>
            <input className="input" placeholder="Pegá el link del Google Sheet del cliente" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} />
          </div>
          <div style={{width:'90px'}}>
            <label className="label">Celda</label>
            <input className="input" placeholder="J10" value={sheetCelda} onChange={e => setSheetCelda(e.target.value)} />
          </div>
          <button onClick={importarClienteSheet} disabled={impSheet} className="btn-primary text-sm disabled:opacity-50">
            {impSheet ? 'Leyendo...' : 'Importar'}
          </button>
        </div>
        <div className="text-[11px] text-gray-400 mt-1">Lee el valor de la celda (USD) y lo carga como <b>le debo USD</b> a este cliente. Se sincroniza en el auto-update. Compartí el sheet con la cuenta de servicio.</div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('cuenta')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${tab === 'cuenta' ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-white text-gray-500 border border-gray-200'}`}>
          Cuenta corriente ({calle.length})
        </button>
        <button onClick={() => setTab('operaciones')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${tab === 'operaciones' ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-white text-gray-500 border border-gray-200'}`}>
          Operaciones ({ops.length})
        </button>
      </div>

      {/* Cuenta corriente */}
      {tab === 'cuenta' && (
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-3 font-semibold text-gray-500">Fecha</th>
                <th className="pb-3 font-semibold text-gray-500">Concepto</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Monto</th>
                <th className="pb-3 font-semibold text-gray-500 text-center">Estado</th>
                <th className="pb-3 font-semibold text-gray-500 text-center">Conciliado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {calle.map(c => {
                const meDebe = c.direccion === 'deben'
                return (
                  <tr key={c.id} className={`hover:bg-gray-50 ${!c.activo ? 'opacity-40' : ''}`}>
                    <td className="py-3 text-gray-400 text-xs">{format(new Date(c.fecha + 'T12:00:00'), 'dd/MM/yy', { locale: es })}</td>
                    <td className="py-3 text-gray-600">{c.descripcion || (meDebe ? 'Saldo a cobrar' : 'Saldo a pagar')}</td>
                    <td className={`py-3 text-right font-mono font-bold ${meDebe ? 'text-green-600' : 'text-red-500'}`}>
                      {meDebe ? '+' : '-'}{sym(c.moneda)}{f(c.monto, c.moneda === 'ARS' ? 0 : 2)} <span className="text-gray-400 font-normal">{c.moneda}</span>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${c.activo ? (meDebe ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-gray-100 text-gray-500'}`}>
                        {c.activo ? (meDebe ? 'Me debe' : 'Le debo') : 'Saldado'}
                      </span>
                    </td>
                    <td className="py-3 text-center">{c.conciliado ? <span className="text-[#2EDBB8]">✓</span> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                )
              })}
              {calle.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-400">Sin movimientos en cuenta corriente</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Operaciones */}
      {tab === 'operaciones' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-3 font-semibold text-gray-500">Fecha</th>
                <th className="pb-3 font-semibold text-gray-500">Tipo</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USD</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USDT</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Pesos</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">T/C</th>
                <th className="pb-3 font-semibold text-gray-500">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ops.map(o => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="py-3 text-gray-400 text-xs">{format(new Date(o.fecha + 'T12:00:00'), 'dd/MM/yy', { locale: es })}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${OPERATION_COLORS[o.tipo] || 'bg-gray-100'}`}>{OPERATION_LABELS[o.tipo as OperationType] || o.tipo}</span>
                  </td>
                  <td className="py-3 text-right font-mono text-xs">{o.monto_usd ? `$${f(o.monto_usd)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{o.monto_usdt ? `◎${f(o.monto_usdt)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{o.monto_pesos ? `$${f(o.monto_pesos, 0)}` : '—'}</td>
                  <td className="py-3 text-right text-gray-400 text-xs">{o.tipo_cambio || '—'}</td>
                  <td className="py-3">
                    {o.pendiente === 'me_deben' && <span className="text-xs text-green-600 font-bold">Me debe</span>}
                    {o.pendiente === 'le_debo' && <span className="text-xs text-red-500 font-bold">Le debo</span>}
                    {!o.pendiente && <span className="text-xs text-gray-400">Completa</span>}
                  </td>
                </tr>
              ))}
              {ops.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">Sin operaciones</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
