'use client'
import { useEffect, useState } from 'react'
import { supabase, OPERATION_LABELS, type OperationType } from '@/lib/supabase'

interface Cliente { id: string; nombre: string }

const today = new Date().toISOString().split('T')[0]

// Origen: operaciones que GENERAN un pool de pesos
const ORIGENES = [
  { value: 'venta_usdt_pesos', label: 'Venta USDT por Pesos TT', activo: 'usdt' },
  { value: 'venta_usd_transfer', label: 'Venta USD por Pesos TT', activo: 'usd' },
]

// Destino: operaciones que CONSUMEN pesos comprando moneda
const DESTINOS = [
  { value: 'compra_usd_transfer', label: 'Compra USD (TT)', resultado: 'usd' },
  { value: 'compra_usdt_pesos', label: 'Compra USDT', resultado: 'usdt' },
  { value: 'bajada_ars_cash', label: 'Bajada ARS efectivo', resultado: 'ars' },
]

interface Destino {
  cliente_id: string
  tipo: string
  tipo_cambio: string
  modo: 'pesos' | 'usd'
  monto_ars: string
  monto_usd: string
  porcentaje: string
  estado: 'efectivo' | 'deuda'
}

export default function MesaPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Origen
  const [origenTipo, setOrigenTipo] = useState('venta_usdt_pesos')
  const [origenCliente, setOrigenCliente] = useState('')
  const [origenModo, setOrigenModo] = useState<'usd' | 'pesos'>('usd')
  const [origenMonto, setOrigenMonto] = useState('')
  const [origenPesos, setOrigenPesos] = useState('')
  const [origenTC, setOrigenTC] = useState('')
  const [origenEntregado, setOrigenEntregado] = useState(true)
  const [fecha, setFecha] = useState(today)

  // Destinos
  const [destinos, setDestinos] = useState<Destino[]>([])

  useEffect(() => {
    supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre')
      .then(({ data }) => { if (data) setClientes(data) })
  }, [])

  const f = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

  const origenActivo = ORIGENES.find(o => o.value === origenTipo)?.activo || 'usdt'
  const origenTCnum = parseFloat(origenTC) || 0
  const montoVendido = origenModo === 'usd' ? (parseFloat(origenMonto) || 0) : (origenTCnum > 0 ? (parseFloat(origenPesos) || 0) / origenTCnum : 0)
  const totalPool = origenModo === 'usd' ? (parseFloat(origenMonto) || 0) * origenTCnum : (parseFloat(origenPesos) || 0)

  const esBajadaArs = (d: Destino) => d.tipo === 'bajada_ars_cash'
  const montoBajada = (d: Destino) => parseFloat(d.monto_ars) || 0  // pesos de la bajada
  const arsDestino = (d: Destino) => {
    if (esBajadaArs(d)) return 0  // no consume el pool de la venta
    const tc = parseFloat(d.tipo_cambio) || 0
    if (d.modo === 'usd') return (parseFloat(d.monto_usd) || 0) * tc
    return parseFloat(d.monto_ars) || 0
  }
  const resultadoDestino = (d: Destino) => {
    const tc = parseFloat(d.tipo_cambio) || 0
    if (d.modo === 'usd') return parseFloat(d.monto_usd) || 0
    return tc > 0 ? (parseFloat(d.monto_ars) || 0) / tc : 0
  }

  const asignado = destinos.reduce((s, d) => s + arsDestino(d), 0)
  const restante = totalPool - asignado

  const comisionDestino = (d: Destino) => {
    const base = esBajadaArs(d) ? montoBajada(d) : resultadoDestino(d)
    return (base * (parseFloat(d.porcentaje) || 0)) / 100
  }

  const addDestino = () => setDestinos([...destinos, { cliente_id: '', tipo: 'compra_usd_transfer', tipo_cambio: '', modo: 'pesos', monto_ars: restante > 0 ? restante.toFixed(2) : '', monto_usd: '', porcentaje: '', estado: 'efectivo' }])
  const updateDestino = (i: number, patch: Partial<Destino>) => setDestinos(ds => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  const removeDestino = (i: number) => setDestinos(ds => ds.filter((_, idx) => idx !== i))

  const handleGuardar = async () => {
    if (!origenTC || (origenModo === 'usd' && !origenMonto) || (origenModo === 'pesos' && !origenPesos)) { alert('Completá el origen (monto/pesos y tipo de cambio)'); return }
    if (!origenEntregado && !origenCliente) { alert('Si no entregaste, elegí el cliente al que le debés'); return }
    setSaving(true); setMsg('')

    // 1. Operación origen
    const origenPayload: Record<string, unknown> = {
      cliente_id: origenCliente || null,
      tipo: origenTipo,
      tipo_cambio: parseFloat(origenTC),
      monto_pesos: totalPool,
      fecha, pagado: origenEntregado,
      pendiente: origenEntregado ? null : 'le_debo',
    }
    if (origenActivo === 'usdt') origenPayload.monto_usdt = montoVendido
    else origenPayload.monto_usd = montoVendido

    const { error: e1 } = await supabase.from('operaciones').insert(origenPayload)
    if (e1) { alert('Error origen: ' + e1.message); setSaving(false); return }

    if (!origenEntregado && origenCliente) {
      const monedaOrig = origenActivo === 'usdt' ? 'USDT' : 'USD'
      await supabase.from('saldo_calle').insert({
        cliente_id: origenCliente, moneda: monedaOrig, monto: montoVendido,
        direccion: 'debo', descripcion: `Venta en mesa no entregada (${monedaOrig})`,
        fecha, activo: true,
      })
    }

    // 2. Destinos
    for (const d of destinos) {
      // ── Bajada ARS efectivo: el cliente paga pesos (efectivo → sube caja ARS
      // físico; deuda → me deben ARS). La comisión es ganancia en ARS. ──
      if (esBajadaArs(d)) {
        const monto = montoBajada(d)
        if (monto <= 0) continue
        const pct = parseFloat(d.porcentaje) || 0
        const comision = (monto * pct) / 100
        const neto = monto - comision  // la comisión descuenta del ARS; solo se registra
        const descBase = `Bajada ARS cash${pct > 0 ? ` — comisión ${pct}% ($${comision.toFixed(0)})` : ''}`
        if (d.estado === 'efectivo') {
          // Entra plata → suma a la Caja ARS Físico el NETO (la comisión NO suma a
          // ninguna caja, solo queda registrada en porcentaje/comision/descripción)
          const { error: eb } = await supabase.from('operaciones').insert({
            cliente_id: d.cliente_id || null, tipo: 'ajuste_ars_cash',
            monto_pesos: neto, fecha, pagado: true,
            porcentaje: pct > 0 ? pct : null, comision_usd: comision > 0 ? comision : null,
            descripcion: descBase,
          })
          if (eb) { alert('Error bajada: ' + eb.message); setSaving(false); return }
        } else if (d.cliente_id) {
          // Queda como deuda → me deben ARS por el NETO
          await supabase.from('saldo_calle').insert({
            cliente_id: d.cliente_id, moneda: 'ARS', monto: neto,
            direccion: 'deben', descripcion: descBase, fecha, activo: true,
          })
        }
        continue
      }
      const tc = parseFloat(d.tipo_cambio) || 0
      const ars = arsDestino(d)
      if (ars <= 0 || tc <= 0) continue
      const resultado = resultadoDestino(d)
      const esUsdt = d.tipo === 'compra_usdt_pesos'
      const pendiente = d.estado === 'deuda' ? 'me_deben' : null

      const pct = parseFloat(d.porcentaje) || 0
      const comision = (resultado * pct) / 100
      const payload: Record<string, unknown> = {
        cliente_id: d.cliente_id || null,
        tipo: d.tipo,
        tipo_cambio: tc,
        monto_pesos: ars,
        fecha,
        pendiente,
        pagado: d.estado === 'efectivo',
        porcentaje: pct > 0 ? pct : null,
        comision_usd: comision > 0 ? comision : null,
      }
      if (esUsdt) payload.monto_usdt = resultado
      else payload.monto_usd = resultado

      const { error: e2 } = await supabase.from('operaciones').insert(payload)
      if (e2) { alert('Error destino: ' + e2.message); setSaving(false); return }

      if (d.estado === 'deuda' && d.cliente_id) {
        await supabase.from('saldo_calle').insert({
          cliente_id: d.cliente_id,
          moneda: esUsdt ? 'USDT' : 'USD',
          monto: resultado,
          direccion: 'deben',
          descripcion: `${DESTINOS.find(x => x.value === d.tipo)?.label} @ ${tc}`,
          fecha, activo: true,
        })
      }
    }

    setSaving(false)
    setMsg('✓ Mesa guardada correctamente')
    setOrigenMonto(''); setOrigenPesos(''); setOrigenTC(''); setOrigenCliente(''); setDestinos([]); setOrigenEntregado(true)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">🔀 Mesa / Arbitraje</h1>
        <p className="text-gray-500 text-sm mt-1">Distribuí una venta entre varias compras a clientes</p>
      </div>

      {/* ORIGEN */}
      <div className="card mb-4 border-l-4 border-[#2EDBB8]">
        <div className="text-xs font-bold text-[#2EDBB8] uppercase tracking-wide mb-4">1 · Origen — venta que genera pesos</div>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="label">Tipo</label>
            <select className="input" value={origenTipo} onChange={e => setOrigenTipo(e.target.value)}>
              {ORIGENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cliente (quién compra)</label>
            <select className="input" value={origenCliente} onChange={e => setOrigenCliente(e.target.value)}>
              <option value="">— Opcional —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fecha</label>
            <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="label">Cargar por</label>
            <select className="input" value={origenModo} onChange={e => setOrigenModo(e.target.value as 'usd'|'pesos')}>
              <option value="usd">{origenActivo.toUpperCase()}</option>
              <option value="pesos">Pesos</option>
            </select>
          </div>
          <div>
            <label className="label">Tipo de cambio</label>
            <input className="input" type="number" step="0.01" placeholder="1500" value={origenTC} onChange={e => setOrigenTC(e.target.value)} />
          </div>
          {origenModo === 'usd' ? (
            <div>
              <label className="label">Monto {origenActivo.toUpperCase()}</label>
              <input className="input" type="number" step="0.01" placeholder="5000" value={origenMonto} onChange={e => setOrigenMonto(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="label">Pesos recibidos</label>
              <input className="input" type="number" step="0.01" placeholder="7500000" value={origenPesos} onChange={e => setOrigenPesos(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">{origenModo === 'usd' ? 'Pool de pesos' : `${origenActivo.toUpperCase()} vendidos`}</label>
            <div className="input bg-[#f0fdf9] font-bold text-[#1a1a2e] flex items-center">
              {origenModo === 'usd' ? `$ ${f(totalPool, 0)}` : `${origenActivo === 'usdt' ? '◎' : '$'}${f(montoVendido)}`}
            </div>
          </div>
        </div>

        {/* ¿Entregaste los USD/USDT? */}
        <div className="mt-4">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">¿Entregaste los {origenActivo.toUpperCase()}?</div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <button type="button" onClick={() => setOrigenEntregado(true)}
              className={`py-2 rounded-lg font-bold text-sm transition-colors ${origenEntregado ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
              ✓ Sí, los entregué
            </button>
            <button type="button" onClick={() => setOrigenEntregado(false)}
              className={`py-2 rounded-lg font-bold text-sm transition-colors ${!origenEntregado ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
              ✗ No, se los debo
            </button>
          </div>
          {!origenEntregado && (
            <div className="mt-2 text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg max-w-md">
              No descuenta de tu caja {origenActivo.toUpperCase()}. Queda como <strong>le debo {origenActivo.toUpperCase()}</strong> al cliente del origen (elegilo arriba).
            </div>
          )}
        </div>
      </div>

      {/* Barra de asignación */}
      {totalPool > 0 && (
        <div className="card mb-4 flex items-center justify-between">
          <div className="flex gap-8">
            <div><div className="text-xs text-gray-400">Pool</div><div className="font-bold">${f(totalPool, 0)}</div></div>
            <div><div className="text-xs text-gray-400">Asignado</div><div className="font-bold text-blue-600">${f(asignado, 0)}</div></div>
            <div><div className="text-xs text-gray-400">Restante</div><div className={`font-bold ${Math.abs(restante) < 1 ? 'text-green-600' : restante < 0 ? 'text-red-600' : 'text-orange-500'}`}>${f(restante, 0)}</div></div>
          </div>
          <button onClick={addDestino} className="btn-primary text-sm">+ Agregar compra</button>
        </div>
      )}

      {/* DESTINOS */}
      <div className="space-y-3 mb-6">
        {destinos.map((d, i) => (
          <div key={i} className="card border-l-4 border-orange-300">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-orange-500 uppercase tracking-wide">Compra #{i + 1}</div>
              <button onClick={() => removeDestino(i)} className="text-red-400 hover:text-red-600 text-xs">✕ Quitar</button>
            </div>
            <div className="grid grid-cols-7 gap-3 items-end">
              <div>
                <label className="label">Cliente</label>
                <select className="input" value={d.cliente_id} onChange={e => updateDestino(i, { cliente_id: e.target.value })}>
                  <option value="">—</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Compro</label>
                <select className="input" value={d.tipo} onChange={e => updateDestino(i, { tipo: e.target.value })}>
                  {DESTINOS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </div>
              {esBajadaArs(d) ? (
                <>
                  <div>
                    <label className="label">Comisión %</label>
                    <input className="input" type="number" step="0.01" placeholder="0" value={d.porcentaje} onChange={e => updateDestino(i, { porcentaje: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Pesos</label>
                    <input className="input" type="number" step="0.01" placeholder="500000" value={d.monto_ars} onChange={e => updateDestino(i, { monto_ars: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Neto ARS (− com.)</label>
                    <div className="input bg-gray-50 font-mono text-sm flex items-center">${f(montoBajada(d) - comisionDestino(d), 0)}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Cargar por</label>
                    <select className="input" value={d.modo} onChange={e => updateDestino(i, { modo: e.target.value as 'pesos'|'usd' })}>
                      <option value="pesos">Pesos</option>
                      <option value="usd">USD/USDT</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">T/C</label>
                    <input className="input" type="number" step="0.01" placeholder="1440" value={d.tipo_cambio} onChange={e => updateDestino(i, { tipo_cambio: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Comisión %</label>
                    <input className="input" type="number" step="0.01" placeholder="0" value={d.porcentaje} onChange={e => updateDestino(i, { porcentaje: e.target.value })} />
                  </div>
                  {d.modo === 'pesos' ? (
                    <div>
                      <label className="label">Pesos usados</label>
                      <input className="input" type="number" step="0.01" value={d.monto_ars} onChange={e => updateDestino(i, { monto_ars: e.target.value })} />
                    </div>
                  ) : (
                    <div>
                      <label className="label">{d.tipo === 'compra_usdt_pesos' ? 'USDT' : 'USD'} a comprar</label>
                      <input className="input" type="number" step="0.01" value={d.monto_usd} onChange={e => updateDestino(i, { monto_usd: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="label">{d.modo === 'pesos' ? 'Resultado' : 'Pesos usados'}</label>
                    <div className="input bg-gray-50 font-mono text-sm flex items-center">
                      {d.modo === 'pesos'
                        ? `${d.tipo === 'compra_usdt_pesos' ? '◎' : '$'}${f(resultadoDestino(d))}`
                        : `$${f(arsDestino(d), 0)}`}
                    </div>
                  </div>
                </>
              )}
            </div>
            {(parseFloat(d.porcentaje) || 0) > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                Comisión {d.porcentaje}%: <span className="font-bold text-[#1a1a2e]">{esBajadaArs(d) ? '$' : (d.tipo === 'compra_usdt_pesos' ? '◎' : 'US$')}{f(comisionDestino(d))}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" onClick={() => updateDestino(i, { estado: 'efectivo' })}
                className={`py-2 rounded-lg text-sm font-bold transition-colors ${d.estado === 'efectivo' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                💵 Entrega en efectivo
              </button>
              <button type="button" onClick={() => updateDestino(i, { estado: 'deuda' })}
                className={`py-2 rounded-lg text-sm font-bold transition-colors ${d.estado === 'deuda' ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-gray-100 text-gray-500'}`}>
                📝 Va a deuda (cuenta corriente)
              </button>
            </div>
          </div>
        ))}
      </div>

      {msg && <div className="mb-4 bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm font-medium">{msg}</div>}

      {totalPool > 0 && (
        <div className="flex gap-3">
          <button onClick={handleGuardar} disabled={saving} className="btn-primary px-8 py-3 disabled:opacity-50">
            {saving ? 'Guardando...' : '✓ Guardar Mesa'}
          </button>
          {Math.abs(restante) > 1 && (
            <span className="self-center text-sm text-orange-500">⚠️ Quedan ${f(restante, 0)} sin asignar</span>
          )}
        </div>
      )}
    </div>
  )
}
