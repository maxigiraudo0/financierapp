'use client'
import { useEffect, useState } from 'react'
import { supabase, OPERATION_LABELS, OPERATION_COLORS, OPERATION_GROUPS, USES_PORCENTAJE, type OperationType } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Cliente { id: string; nombre: string }
interface CuentaUSA { id: string; nombre: string; banco?: string }
interface CuentaPesos { id: string; nombre: string }
interface Operacion {
  id: string; tipo: string; monto_usd: number; monto_usdt: number
  monto_pesos: number; monto_eur: number; porcentaje: number
  comision_usd: number; tipo_cambio: number; descripcion: string
  fecha: string; cliente_id: string | null; clientes: { nombre: string } | null
  cuentas_usa: { nombre: string } | null
  cuentas_pesos_tt: { nombre: string } | null
  cuenta_usa_id?: string | null; cuenta_pesos_id?: string | null
  medio?: string | null; pendiente?: string | null
}

const today = new Date().toISOString().split('T')[0]
const emptyForm = {
  cliente_id: '', tipo: 'compra_usd_cash' as OperationType,
  monto_usd: '', monto_usdt: '', monto_pesos: '', monto_eur: '',
  porcentaje: '', comision_usd: '', tipo_cambio: '',
  cuenta_usa_id: '', cuenta_pesos_id: '',
  descripcion: '', fecha: today, pagado: true,
  medio: 'usd_cash', montoDeuda: '',
  pendiente: 'ok' as 'ok' | 'me_deben' | 'le_debo',
  costo_wire: '', wire_absorbe: 'financiera'
}

// Medios de pago → caja que se mueve
const MEDIOS = [
  { value: 'usd_cash',     label: '💵 USD Efectivo' },
  { value: 'usd_transfer', label: '💵 USD Transferencia' },
  { value: 'usdt',         label: '◎ USDT' },
  { value: 'pesos_cash',   label: '💵 Pesos Efectivo' },
  { value: 'pesos_tt',     label: '📲 Pesos Transferencia' },
  { value: 'eur',          label: '🇪🇺 Euros' },
  { value: 'cuenta_usa',   label: '🇺🇸 Cuenta USA' },
]

// Medios válidos según la moneda de la deuda (evita pagar una deuda ARS con USD, etc.)
const MEDIOS_POR_MONEDA: Record<string, string[]> = {
  USD:  ['usd_cash', 'usd_transfer', 'cuenta_usa'],
  ARS:  ['pesos_cash', 'pesos_tt'],
  USDT: ['usdt'],
  EUR:  ['eur'],
}

export default function OperacionesPage() {
  const [operaciones, setOperaciones] = useState<Operacion[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cuentasUSA, setCuentasUSA] = useState<CuentaUSA[]>([])
  const [cuentasPesos, setCuentasPesos] = useState<CuentaPesos[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterCliente, setFilterCliente] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [verArchivadas, setVerArchivadas] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [verArchivadas])

  // Tipos que calculan pesos = USD × TC
  const CALC_PESOS_DESDE_USD = ['compra_usd_cash','venta_usd_cash','compra_usd_transfer','venta_usd_transfer','bajada_cable_pesos','bajada_cable_pesos_tt']
  // Tipos que calculan pesos = USDT × TC
  const CALC_PESOS_DESDE_USDT = ['compra_usdt_pesos','venta_usdt_pesos']
  // Tipos que calculan pesos = EUR × TC
  const CALC_PESOS_DESDE_EUR = ['compra_eur_ars','venta_eur_ars']

  // Auto-calcular pesos desde USD × TC
  useEffect(() => {
    if (CALC_PESOS_DESDE_USD.includes(form.tipo) && form.monto_usd && form.tipo_cambio) {
      const pesos = parseFloat(form.monto_usd) * parseFloat(form.tipo_cambio)
      setForm(f => ({ ...f, monto_pesos: pesos.toFixed(2) }))
    }
  }, [form.monto_usd, form.tipo_cambio, form.tipo])

  // Auto-calcular pesos desde USDT × TC
  useEffect(() => {
    if (CALC_PESOS_DESDE_USDT.includes(form.tipo) && form.monto_usdt && form.tipo_cambio) {
      const pesos = parseFloat(form.monto_usdt) * parseFloat(form.tipo_cambio)
      setForm(f => ({ ...f, monto_pesos: pesos.toFixed(2) }))
    }
  }, [form.monto_usdt, form.tipo_cambio, form.tipo])

  // Auto-calcular pesos desde EUR × TC
  useEffect(() => {
    if (CALC_PESOS_DESDE_EUR.includes(form.tipo) && form.monto_eur && form.tipo_cambio) {
      const pesos = parseFloat(form.monto_eur) * parseFloat(form.tipo_cambio)
      setForm(f => ({ ...f, monto_pesos: pesos.toFixed(2) }))
    }
  }, [form.monto_eur, form.tipo_cambio, form.tipo])

  // Cable por USDT: autocompletar USDT recibido = cable enviado (editable)
  useEffect(() => {
    if ((form.tipo === 'subida_cable_usdt' || form.tipo === 'bajada_cable_usdt') && form.monto_usd) {
      setForm(f => ({ ...f, monto_usdt: f.monto_usd }))
    }
  }, [form.monto_usd, form.tipo])

  // Auto-calcular comisión cable/USDT
  useEffect(() => {
    if (USES_PORCENTAJE.includes(form.tipo) && form.monto_usd && form.porcentaje) {
      const comision = (parseFloat(form.monto_usd) * parseFloat(form.porcentaje)) / 100
      setForm(f => ({ ...f, comision_usd: comision.toFixed(2) }))
    }
  }, [form.monto_usd, form.porcentaje, form.tipo])

  // En cobros/pagos de deuda: forzar un medio acorde a la moneda de la deuda
  // (ej: deuda ARS → pesos; nunca caja USD)
  useEffect(() => {
    const esD = form.tipo.startsWith('cobro_deuda_') || form.tipo.startsWith('pago_deuda_')
    if (!esD) return
    const moneda = form.tipo.split('_')[2].toUpperCase()
    const validos = MEDIOS_POR_MONEDA[moneda] || []
    if (validos.length && !validos.includes(form.medio)) {
      setForm(f => ({ ...f, medio: validos[0] }))
    }
  }, [form.tipo, form.medio])

  const loadAll = async () => {
    const [{ data: ops, error: opsError }, { data: cls }, { data: cusas }, { data: cpesos }] = await Promise.all([
      supabase.from('operaciones')
        .select('id, tipo, monto_usd, monto_usdt, monto_pesos, monto_eur, porcentaje, comision_usd, tipo_cambio, descripcion, fecha, cliente_id, cuenta_usa_id, cuenta_pesos_id, medio, pendiente, clientes(nombre)')
        .eq('archivado', verArchivadas)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(300),
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('cuentas_usa').select('id, nombre, banco').eq('activa', true).order('nombre'),
      supabase.from('cuentas_pesos_tt').select('id, nombre').eq('activa', true).order('nombre'),
    ])
    if (opsError) console.error('Error cargando ops:', opsError)
    if (ops) setOperaciones(ops as unknown as Operacion[])
    if (cls) setClientes(cls)
    if (cusas) setCuentasUSA(cusas)
    if (cpesos) setCuentasPesos(cpesos)
    setLoading(false)
  }

  // Define qué recibe y qué entrega la financiera en cada operación
  // recibo = entra a mi caja | entrego = sale de mi caja
  const getLegs = (tipo: string) => {
    const usd = () => parseFloat(form.monto_usd) || 0
    const usdt = () => parseFloat(form.monto_usdt) || 0
    const pesos = () => parseFloat(form.monto_pesos) || 0
    const eur = () => parseFloat(form.monto_eur) || 0
    switch (tipo) {
      case 'compra_usd_cash':
      case 'compra_usd_transfer': return { recibo: {m:'USD',v:usd()}, entrego: {m:'ARS',v:pesos()} }
      case 'venta_usd_cash':
      case 'venta_usd_transfer':  return { recibo: {m:'ARS',v:pesos()}, entrego: {m:'USD',v:usd()} }
      case 'compra_usdt_cash':    return { recibo: {m:'USDT',v:usdt()}, entrego: {m:'USD',v:usd()} }
      case 'venta_usdt_cash':     return { recibo: {m:'USD',v:usd()}, entrego: {m:'USDT',v:usdt()} }
      case 'compra_usdt_pesos':   return { recibo: {m:'USDT',v:usdt()}, entrego: {m:'ARS',v:pesos()} }
      case 'venta_usdt_pesos':    return { recibo: {m:'ARS',v:pesos()}, entrego: {m:'USDT',v:usdt()} }
      case 'compra_eur_ars':      return { recibo: {m:'EUR',v:eur()}, entrego: {m:'ARS',v:pesos()} }
      case 'venta_eur_ars':       return { recibo: {m:'ARS',v:pesos()}, entrego: {m:'EUR',v:eur()} }
      case 'compra_eur_usd':      return { recibo: {m:'EUR',v:eur()}, entrego: {m:'USD',v:usd()} }
      case 'venta_eur_usd':       return { recibo: {m:'USD',v:usd()}, entrego: {m:'EUR',v:eur()} }
      case 'bajada_cable': {
        const cash = usd() - (parseFloat(form.comision_usd) || 0)
        return { recibo: {m:'USD',v:usd()}, entrego: {m:'USD',v:cash} }
      }
      case 'subida_cable':        return { recibo: {m:'USD',v:usd()}, entrego: {m:'USD',v:usd()} }
      case 'subida_cable_usdt':   return { recibo: {m:'USDT',v:usdt()}, entrego: {m:'USD',v:usd()} }
      default: return { recibo: {m:'',v:0}, entrego: {m:'',v:0} }
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const esDeuda = form.tipo.startsWith('cobro_deuda_') || form.tipo.startsWith('pago_deuda_')

    // Para cobros/pagos de deuda: el monto va al campo según el MEDIO elegido
    let mUsd = parseFloat(form.monto_usd) || 0
    let mUsdt = parseFloat(form.monto_usdt) || 0
    let mPesos = parseFloat(form.monto_pesos) || 0
    let mEur = parseFloat(form.monto_eur) || 0

    if (esDeuda) {
      const amt = parseFloat(form.montoDeuda) || 0
      mUsd = mUsdt = mPesos = mEur = 0
      if (['usd_cash','usd_transfer','cuenta_usa'].includes(form.medio)) mUsd = amt
      else if (form.medio === 'usdt') mUsdt = amt
      else if (['pesos_cash','pesos_tt'].includes(form.medio)) mPesos = amt
      else if (form.medio === 'eur') mEur = amt
    }

    const payload = {
      cliente_id: form.cliente_id || null,
      tipo: form.tipo,
      monto_usd: mUsd,
      monto_usdt: mUsdt,
      monto_pesos: mPesos,
      monto_eur: mEur,
      porcentaje: parseFloat(form.porcentaje) || null,
      comision_usd: parseFloat(form.comision_usd) || null,
      tipo_cambio: parseFloat(form.tipo_cambio) || null,
      cuenta_usa_id: form.cuenta_usa_id || null,
      cuenta_pesos_id: form.cuenta_pesos_id || null,
      medio: esDeuda ? form.medio : null,
      costo_wire: form.tipo === 'subida_cable_usdt' ? (parseFloat(form.costo_wire) || null) : null,
      wire_absorbe: form.tipo === 'subida_cable_usdt' ? form.wire_absorbe : null,
      pendiente: form.tipo.startsWith('prestamo_')
        ? (form.pagado ? null : 'no_entregado')
        : (esDeuda ? null : (form.pendiente === 'ok' ? null : form.pendiente)),
      descripcion: form.descripcion || null,
      fecha: form.fecha,
      pagado: esDeuda ? true : form.pendiente === 'ok',
    }

    // ── MODO EDICIÓN ── actualiza la operación (sin recalcular calle)
    if (editId) {
      const { error } = await supabase.from('operaciones').update(payload).eq('id', editId)
      if (error) { alert('Error al editar:\n' + JSON.stringify(error, null, 2)); setSaving(false); return }
      // Si es pago de deuda con entrega en sheet → actualizar esa fila
      if (form.tipo.startsWith('pago_deuda_') && form.cliente_id) {
        const { data: op } = await supabase.from('operaciones').select('sheet_fila').eq('id', editId).single()
        const montoPago = parseFloat(form.montoDeuda) || 0
        if (op?.sheet_fila && montoPago > 0) {
          try {
            await fetch('/api/registrar-pago-sheet', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cliente_id: form.cliente_id, fecha: form.fecha, monto_usd: montoPago, fila: op.sheet_fila }),
            })
          } catch {}
        }
      }
      setShowForm(false); setEditId(null); setForm({ ...emptyForm, fecha: today }); setSaving(false); loadAll()
      return
    }

    const { data: insertada, error } = await supabase.from('operaciones').insert(payload).select('id').single()
    if (error) { alert('Error al guardar:\n' + JSON.stringify(error, null, 2)); setSaving(false); return }
    const opId = insertada?.id

    // Si quedó algo pendiente → crear saldo en la calle automáticamente
    if (!esDeuda && form.pendiente !== 'ok' && form.cliente_id) {
      const legs = getLegs(form.tipo)
      // me_deben: el cliente no me entregó lo que YO RECIBO → me debe esa moneda
      // le_debo: yo no le entregué lo que YO ENTREGO → le debo esa moneda
      const leg = form.pendiente === 'me_deben' ? legs.recibo : legs.entrego
      const direccion = form.pendiente === 'me_deben' ? 'deben' : 'debo'
      if (leg.m && leg.v > 0) {
        await supabase.from('saldo_calle').insert({
          cliente_id: form.cliente_id,
          moneda: leg.m,
          monto: leg.v,
          direccion,
          descripcion: `${OPERATION_LABELS[form.tipo as OperationType]}${form.descripcion ? ' — ' + form.descripcion : ''}`,
          fecha: form.fecha,
          activo: true,
        })
      }
    }

    // Cobro/pago de deuda → reducir saldo en la calle; devuelve el excedente
    const reducirDeuda = async (moneda: string, direccion: string, monto: number): Promise<number> => {
      if (!form.cliente_id || monto <= 0) return 0
      const { data: saldos } = await supabase.from('saldo_calle')
        .select('id,monto').eq('cliente_id', form.cliente_id).eq('moneda', moneda).eq('direccion', direccion).eq('activo', true)
      let restante = monto
      for (const s of (saldos || [])) {
        if (restante <= 0) break
        if (s.monto <= restante) {
          await supabase.from('saldo_calle').update({ activo: false }).eq('id', s.id)
          restante -= s.monto
        } else {
          await supabase.from('saldo_calle').update({ monto: s.monto - restante }).eq('id', s.id)
          restante = 0
        }
      }
      return restante  // lo que sobró tras cancelar la deuda
    }

    // Crea el saldo inverso cuando hubo sobrepago
    const crearSobrante = async (moneda: string, direccion: string, monto: number) => {
      if (!form.cliente_id || monto <= 0.001) return
      await supabase.from('saldo_calle').insert({
        cliente_id: form.cliente_id, moneda, monto, direccion,
        descripcion: 'Sobrepago (saldo a favor)', fecha: form.fecha, activo: true,
      })
    }

    if (form.tipo.startsWith('cobro_deuda_')) {
      const moneda = form.tipo.replace('cobro_deuda_','').toUpperCase()
      // El cliente paga lo que me debe (reduce 'deben'); si paga de más → yo le debo ('debo')
      const sobra = await reducirDeuda(moneda, 'deben', parseFloat(form.montoDeuda) || 0)
      await crearSobrante(moneda, 'debo', sobra)
    }
    if (form.tipo.startsWith('pago_deuda_')) {
      const moneda = form.tipo.replace('pago_deuda_','').toUpperCase()
      const montoPago = parseFloat(form.montoDeuda) || 0
      // Yo pago lo que le debo (reduce 'debo'); si pago de más → me debe ('deben')
      const sobra = await reducirDeuda(moneda, 'debo', montoPago)
      await crearSobrante(moneda, 'deben', sobra)
      // Pago a cliente con sheet vinculado → registrar entrega en su sheet (USD o ARS)
      if (form.cliente_id && montoPago > 0) {
        try {
          const res = await fetch('/api/registrar-pago-sheet', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliente_id: form.cliente_id, fecha: form.fecha, monto_usd: montoPago }),
          })
          const j = await res.json()
          if (j?.fila && opId) {
            await supabase.from('operaciones').update({ sheet_fila: j.fila, sheet_rango: j.rango || null }).eq('id', opId)
          }
        } catch {}
      }
    }

    // Préstamo → el cliente queda debiendo (me deben) en la moneda prestada
    if (form.tipo.startsWith('prestamo_') && form.cliente_id) {
      const monedaPrest = form.tipo === 'prestamo_usd' ? 'USD' : form.tipo === 'prestamo_usdt' ? 'USDT' : 'ARS'
      const montoPrest = monedaPrest === 'USD' ? mUsd : monedaPrest === 'USDT' ? mUsdt : mPesos
      if (montoPrest > 0) {
        await supabase.from('saldo_calle').insert({
          cliente_id: form.cliente_id, moneda: monedaPrest, monto: montoPrest,
          direccion: 'deben', descripcion: `Préstamo ${monedaPrest}${form.descripcion ? ' — ' + form.descripcion : ''}`,
          fecha: form.fecha, activo: true,
        })
      }
    }

    setShowForm(false)
    setForm({ ...emptyForm, fecha: today })
    setSaving(false)
    loadAll()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta operación?')) return
    // Si la operación dejó una entrega en el sheet del cliente, limpiarla
    const { data: op } = await supabase.from('operaciones').select('cliente_id, sheet_fila, sheet_rango').eq('id', id).single()
    if ((op?.sheet_fila || op?.sheet_rango) && op?.cliente_id) {
      try {
        await fetch('/api/borrar-pago-sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: op.cliente_id, fila: op.sheet_fila, rango: op.sheet_rango }),
        })
      } catch {}
    }
    await supabase.from('operaciones').delete().eq('id', id)
    loadAll()
  }

  const handleEdit = (op: Operacion) => {
    const esD = op.tipo.startsWith('cobro_deuda_') || op.tipo.startsWith('pago_deuda_')
    setForm({
      cliente_id: op.cliente_id || '',
      tipo: op.tipo as OperationType,
      monto_usd: op.monto_usd ? String(op.monto_usd) : '',
      monto_usdt: op.monto_usdt ? String(op.monto_usdt) : '',
      monto_pesos: op.monto_pesos ? String(op.monto_pesos) : '',
      monto_eur: op.monto_eur ? String(op.monto_eur) : '',
      porcentaje: op.porcentaje ? String(op.porcentaje) : '',
      comision_usd: op.comision_usd ? String(op.comision_usd) : '',
      tipo_cambio: op.tipo_cambio ? String(op.tipo_cambio) : '',
      cuenta_usa_id: op.cuenta_usa_id || '',
      cuenta_pesos_id: op.cuenta_pesos_id || '',
      descripcion: op.descripcion || '',
      fecha: op.fecha,
      pagado: !op.pendiente,
      medio: op.medio || 'usd_cash',
      montoDeuda: esD ? String(op.monto_usd || op.monto_usdt || op.monto_pesos || op.monto_eur || '') : '',
      pendiente: (op.pendiente as 'me_deben' | 'le_debo') || 'ok',
      costo_wire: '', wire_absorbe: 'financiera',
    })
    setEditId(op.id)
    setShowForm(true)
  }

  const esDeuda = form.tipo.startsWith('cobro_deuda_') || form.tipo.startsWith('pago_deuda_')
  const esPrestamo = form.tipo.startsWith('prestamo_')
  const esCobro = form.tipo.startsWith('cobro_deuda_')
  const monedaDeuda = esDeuda ? form.tipo.split('_')[2].toUpperCase() : ''
  const mediosValidos = esDeuda ? MEDIOS.filter(m => (MEDIOS_POR_MONEDA[monedaDeuda] || []).includes(m.value)) : MEDIOS
  const usaPorcentaje = USES_PORCENTAJE.includes(form.tipo)
  const usaCuentaUSA = ['bajada_cable', 'bajada_cable_pesos', 'bajada_cable_pesos_tt', 'subida_cable', 'subida_cable_usdt', 'bajada_cable_usdt', 'saldo_inicial_cuenta_usa', 'ajuste_usa', 'gasto_usa'].includes(form.tipo)
  const esCableUsdt = form.tipo === 'subida_cable_usdt' || form.tipo === 'bajada_cable_usdt'
  const esCablePesos = form.tipo === 'bajada_cable_pesos' || form.tipo === 'bajada_cable_pesos_tt'
  const usaCuentaPesos = ['compra_usdt_pesos', 'venta_usdt_pesos', 'compra_usd_transfer', 'venta_usd_transfer', 'compra_eur_ars', 'venta_eur_ars', 'saldo_inicial_pesos_tt', 'saldo_inicial_pesos_cash'].includes(form.tipo)
  const usaUSDT = ['compra_usdt_cash', 'venta_usdt_cash', 'compra_usdt_pesos', 'venta_usdt_pesos', 'saldo_inicial_usdt', 'subida_cable_usdt', 'bajada_cable_usdt', 'gasto_usdt', 'ajuste_usdt', 'prestamo_usdt'].includes(form.tipo)
  const usaPesos = ['compra_usdt_pesos', 'venta_usdt_pesos', 'compra_usd_transfer', 'venta_usd_transfer', 'compra_eur_ars', 'venta_eur_ars', 'saldo_inicial_pesos_tt', 'saldo_inicial_pesos_cash', 'bajada_cable_pesos', 'bajada_cable_pesos_tt', 'gasto_ars_cash', 'gasto_ars_tt', 'ajuste_ars_cash', 'ajuste_ars_tt', 'prestamo_ars', 'prestamo_ars_tt'].includes(form.tipo)
  const usaEUR = ['compra_eur_ars', 'venta_eur_ars', 'compra_eur_usd', 'venta_eur_usd', 'saldo_inicial_eur', 'ajuste_eur'].includes(form.tipo)
  const usaUSD = ['compra_usd_cash', 'venta_usd_cash', 'compra_usd_transfer', 'venta_usd_transfer', 'bajada_cable', 'bajada_cable_pesos', 'bajada_cable_pesos_tt', 'subida_cable', 'subida_cable_usdt', 'bajada_cable_usdt', 'compra_usdt_cash', 'venta_usdt_cash', 'compra_eur_usd', 'venta_eur_usd', 'saldo_inicial_usd', 'saldo_inicial_cuenta_usa', 'ajuste_saldo', 'gasto_usd', 'gasto_usa', 'ajuste_usd', 'ajuste_usa', 'prestamo_usd'].includes(form.tipo)

  const filtered = operaciones.filter(o => {
    if (filterCliente && !o.clientes?.nombre.toLowerCase().includes(filterCliente.toLowerCase())) return false
    if (filterTipo && o.tipo !== filterTipo) return false
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Operaciones</h1>
          <p className="text-gray-500 text-sm mt-1">{operaciones.length} registradas</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={verArchivadas} onChange={e => setVerArchivadas(e.target.checked)} />
            Ver archivadas
          </label>
          <button className="btn-primary" onClick={() => { setEditId(null); setShowForm(true); setForm({ ...emptyForm, fecha: today }) }}>
            + Nueva Operación
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card mb-6 flex gap-4">
        <div className="flex-1">
          <label className="label">Cliente</label>
          <input className="input" placeholder="Buscar cliente..." value={filterCliente} onChange={e => setFilterCliente(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label">Tipo</label>
          <select className="input" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
            <option value="">Todos</option>
            {OPERATION_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map(t => <option key={t} value={t}>{OPERATION_LABELS[t]}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-6">{editId ? 'Editar Operación' : 'Nueva Operación'}</h2>
            <form onSubmit={handleSave} className="space-y-4">

              <div>
                <label className="label">Cliente</label>
                <select className="input" value={form.cliente_id} onChange={e => setForm({...form, cliente_id: e.target.value})}>
                  <option value="">— Sin cliente (caja general) —</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Tipo de operación</label>
                <select className="input" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as OperationType})} required>
                  {OPERATION_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.types.map(t => <option key={t} value={t}>{OPERATION_LABELS[t]}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* ===== BLOQUE COBRO / PAGO DE DEUDA ===== */}
              {esDeuda && (
                <>
                  <div className={`rounded-xl p-4 ${esCobro ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className={`text-xs font-bold uppercase tracking-wide mb-3 ${esCobro ? 'text-green-700' : 'text-red-600'}`}>
                      {esCobro ? `💰 El cliente te paga ${monedaDeuda} que te debía` : `💸 Le pagás ${monedaDeuda} que le debías`}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Monto {monedaDeuda}</label>
                        <input className="input" type="number" step="0.01" placeholder="0.00"
                          value={form.montoDeuda} onChange={e => setForm({...form, montoDeuda: e.target.value})} required />
                      </div>
                      <div>
                        <label className="label">{esCobro ? '¿Con qué te pagó?' : '¿Con qué le pagaste?'}</label>
                        <select className="input" value={form.medio} onChange={e => setForm({...form, medio: e.target.value})}>
                          {mediosValidos.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {esCobro
                        ? `Se descuenta de "me deben ${monedaDeuda}" y entra a la caja seleccionada.`
                        : `Se descuenta de "le debo ${monedaDeuda}" y sale de la caja seleccionada.`}
                    </div>
                  </div>
                </>
              )}

              {/* Montos (operaciones normales) */}
              {!esDeuda && (
              <div className="grid grid-cols-2 gap-3">
                {usaUSDT && form.tipo === 'bajada_cable_usdt' && (
                  <div>
                    <label className="label">USDT enviado</label>
                    <input className="input" type="number" step="0.0001" placeholder="0.0000" value={form.monto_usdt} onChange={e => setForm({...form, monto_usdt: e.target.value})} />
                  </div>
                )}
                {usaUSD && (
                  <div>
                    <label className="label">{form.tipo === 'bajada_cable_usdt' ? 'Cable recibido (USD)' : esCableUsdt ? 'Cable enviado (USD)' : (form.tipo === 'bajada_cable' || esCablePesos) ? 'USD recibido en cuenta USA' : 'Monto USD'}</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00" value={form.monto_usd} onChange={e => setForm({...form, monto_usd: e.target.value})} />
                  </div>
                )}
                {usaUSDT && form.tipo !== 'bajada_cable_usdt' && (
                  <div>
                    <label className="label">{esCableUsdt ? 'USDT recibido' : 'Monto USDT'}</label>
                    <input className="input" type="number" step="0.0001" placeholder="0.0000" value={form.monto_usdt} onChange={e => setForm({...form, monto_usdt: e.target.value})} />
                  </div>
                )}
                {usaPesos && (
                  <div>
                    <label className="label">
                      Monto Pesos ARS
                      {form.monto_pesos && <span className="text-[#2EDBB8] ml-1 font-normal normal-case">(auto)</span>}
                    </label>
                    <input className="input" type="number" step="0.01" placeholder="Se calcula con USD × TC"
                      value={form.monto_pesos} onChange={e => setForm({...form, monto_pesos: e.target.value})} />
                  </div>
                )}
                {usaEUR && (
                  <div>
                    <label className="label">Monto EUR</label>
                    <input className="input" type="number" step="0.01" placeholder="0.00" value={form.monto_eur} onChange={e => setForm({...form, monto_eur: e.target.value})} />
                  </div>
                )}
              </div>
              )}

              {/* Costo del wire (solo subida de cable por USDT) */}
              {form.tipo === 'subida_cable_usdt' && (
                <div className="bg-blue-50 p-4 rounded-xl grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Costo del wire (USD)</label>
                    <input className="input" type="number" step="0.01" placeholder="Ej: 25.00" value={form.costo_wire} onChange={e => setForm({...form, costo_wire: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">¿Quién lo absorbe?</label>
                    <select className="input" value={form.wire_absorbe} onChange={e => setForm({...form, wire_absorbe: e.target.value})}>
                      <option value="financiera">La financiera</option>
                      <option value="cliente">El cliente</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Porcentaje y comisión */}
              {!esDeuda && usaPorcentaje && (
                <div className="grid grid-cols-2 gap-3 bg-yellow-50 p-3 rounded-lg">
                  <div>
                    <label className="label">% Comisión</label>
                    <input className="input" type="number" step="0.01" placeholder="Ej: 1.5" value={form.porcentaje} onChange={e => setForm({...form, porcentaje: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Comisión USD (auto)</label>
                    <input className="input bg-gray-50" type="number" step="0.01" value={form.comision_usd} onChange={e => setForm({...form, comision_usd: e.target.value})} />
                  </div>
                </div>
              )}

              {/* USD cash a entregar (bajada de cable) */}
              {form.tipo === 'bajada_cable' && form.monto_usd && (
                <div className="bg-[#f0fdf9] p-3 rounded-lg flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">USD cash a entregar</span>
                  <span className="text-lg font-bold text-[#1a1a2e]">
                    ${((parseFloat(form.monto_usd) || 0) - (parseFloat(form.comision_usd) || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              {/* Tipo de cambio */}
              {!esDeuda && !['saldo_inicial_usd','saldo_inicial_usdt','saldo_inicial_cuenta_usa','saldo_inicial_eur','saldo_inicial_pesos_tt','saldo_inicial_pesos_cash','bajada_cable_usdt'].includes(form.tipo) && (
                <div>
                  <label className="label">Tipo de cambio</label>
                  <input className="input" type="number" step="0.01" placeholder="Ej: 1350.00" value={form.tipo_cambio} onChange={e => setForm({...form, tipo_cambio: e.target.value})} />
                </div>
              )}

              {/* Cuenta USA */}
              {usaCuentaUSA && cuentasUSA.length > 0 && (
                <div>
                  <label className="label">Cuenta USA</label>
                  <select className="input" value={form.cuenta_usa_id} onChange={e => setForm({...form, cuenta_usa_id: e.target.value})}>
                    <option value="">— Seleccionar cuenta —</option>
                    {cuentasUSA.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.banco ? ` — ${c.banco}` : ''}</option>)}
                  </select>
                </div>
              )}

              {/* Cuenta Pesos TT */}
              {usaCuentaPesos && cuentasPesos.length > 0 && (
                <div>
                  <label className="label">Cuenta Pesos TT</label>
                  <select className="input" value={form.cuenta_pesos_id} onChange={e => setForm({...form, cuenta_pesos_id: e.target.value})}>
                    <option value="">— Seleccionar cuenta —</option>
                    {cuentasPesos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Fecha</label>
                  <input className="input" type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} required />
                </div>
                <div>
                  <label className="label">Nota</label>
                  <input className="input" placeholder="Descripción opcional..." value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} />
                </div>
              </div>

              {/* Estado del préstamo */}
              {esPrestamo && (
                <div className="pt-2">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">¿Entregaste el dinero?</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setForm({...form, pagado: true})}
                      className={`py-3 rounded-xl font-bold text-sm transition-colors ${form.pagado ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      ✓ Sí, salió de la caja
                    </button>
                    <button type="button" onClick={() => setForm({...form, pagado: false})}
                      className={`py-3 rounded-xl font-bold text-sm transition-colors ${!form.pagado ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      ⏳ Todavía no
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    {form.pagado ? 'Descuenta de tu caja y queda como "me deben".' : 'No mueve la caja todavía, solo registra que el cliente te debe.'}
                  </div>
                </div>
              )}

              {/* Estado de la operación */}
              {!esDeuda && !esPrestamo && (() => {
                const legs = getLegs(form.tipo)
                return (
                  <div className="pt-2">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">¿Quedó algo pendiente?</div>
                    <div className="space-y-2">
                      <button type="button"
                        onClick={() => setForm({...form, pendiente: 'ok'})}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-colors ${form.pendiente === 'ok' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        ✓ Operación completa (todo entregado y cobrado)
                      </button>
                      {legs.recibo.m && (
                        <button type="button"
                          onClick={() => setForm({...form, pendiente: 'me_deben'})}
                          className={`w-full py-3 rounded-xl font-bold text-sm transition-colors ${form.pendiente === 'me_deben' ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-gray-100 text-gray-500'}`}>
                          ↑ El cliente me debe {legs.recibo.m} {legs.recibo.v > 0 ? legs.recibo.v.toLocaleString('es-AR') : ''}
                        </button>
                      )}
                      {legs.entrego.m && (
                        <button type="button"
                          onClick={() => setForm({...form, pendiente: 'le_debo'})}
                          className={`w-full py-3 rounded-xl font-bold text-sm transition-colors ${form.pendiente === 'le_debo' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                          ↓ Yo le debo {legs.entrego.m} {legs.entrego.v > 0 ? legs.entrego.v.toLocaleString('es-AR') : ''}
                        </button>
                      )}
                    </div>
                    {form.pendiente !== 'ok' && (
                      <div className="mt-2 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                        Se registra automáticamente en <strong>En la Calle</strong>
                        {!form.cliente_id && <span className="text-red-500"> — ⚠️ Seleccioná un cliente</span>}
                      </div>
                    )}
                  </div>
                )
              })()}

              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowForm(false); setEditId(null) }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-16">Cargando...</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-3 font-semibold text-gray-500">Fecha</th>
                <th className="pb-3 font-semibold text-gray-500">Cliente</th>
                <th className="pb-3 font-semibold text-gray-500">Tipo</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USD</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">USDT</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Pesos</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">EUR</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">%</th>
                <th className="pb-3 font-semibold text-gray-500 text-right">Comisión</th>
                <th className="pb-3 font-semibold text-gray-500">Nota</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(op => (
                <tr key={op.id} className="hover:bg-gray-50">
                  <td className="py-3 text-gray-500 whitespace-nowrap">{format(new Date(op.fecha + 'T12:00:00'), 'dd/MM/yy', { locale: es })}</td>
                  <td className="py-3 font-medium">{op.clientes?.nombre || <span className="text-gray-400 text-xs">Caja</span>}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${OPERATION_COLORS[op.tipo] || 'bg-gray-100 text-gray-600'}`}>
                      {OPERATION_LABELS[op.tipo as OperationType] || op.tipo}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_usd ? `$${op.monto_usd.toLocaleString('es-AR', {minimumFractionDigits:2})}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_usdt ? `◎${op.monto_usdt.toFixed(2)}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_pesos ? `$${op.monto_pesos.toLocaleString('es-AR')}` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs">{op.monto_eur ? `€${op.monto_eur.toFixed(2)}` : '—'}</td>
                  <td className="py-3 text-right text-xs">{op.porcentaje ? `${op.porcentaje}%` : '—'}</td>
                  <td className="py-3 text-right font-mono text-xs text-green-600">{op.comision_usd ? `$${op.comision_usd.toFixed(2)}` : '—'}</td>
                  <td className="py-3 text-gray-500 text-xs max-w-[100px] truncate">{op.descripcion || '—'}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => handleEdit(op)} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded font-medium text-gray-600">Editar</button>
                      <button onClick={() => handleDelete(op.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-gray-400">No hay operaciones</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
