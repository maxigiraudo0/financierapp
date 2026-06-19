'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Calle {
  id: string; moneda: string; monto: number; direccion: string
  descripcion: string; fecha: string
}

const SIM: Record<string, string> = { USD: 'US$', ARS: '$', USDT: '◎', EUR: '€' }

export default function CuentaClientePage() {
  const params = useParams()
  const id = params.id as string
  const [nombre, setNombre] = useState<string | null>(null)
  const [calle, setCalle] = useState<Calle[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [{ data: c }, { data: sc }] = await Promise.all([
        supabase.from('clientes').select('nombre').eq('id', id).single(),
        supabase.from('saldo_calle').select('id, moneda, monto, direccion, descripcion, fecha')
          .eq('cliente_id', id).eq('activo', true).order('fecha', { ascending: false }),
      ])
      if (!c) { setNotFound(true); setLoading(false); return }
      setNombre(c.nombre)
      setCalle((sc as Calle[]) || [])
      setLoading(false)
    }
    load()
  }, [id])

  const f = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

  // Neto por moneda (deben = a favor del cliente que le deben a la financiera? -> mostramos desde la óptica del cliente)
  // En la app: "deben" = el cliente le debe a la financiera; "debo" = la financiera le debe al cliente.
  const monedas = [...new Set(calle.map(c => c.moneda))]
  const netoPorMoneda = monedas.map(m => {
    const leDebenALaFin = calle.filter(c => c.moneda === m && c.direccion === 'deben').reduce((a, c) => a + Number(c.monto), 0)
    const laFinLeDebe = calle.filter(c => c.moneda === m && c.direccion === 'debo').reduce((a, c) => a + Number(c.monto), 0)
    // Saldo desde la óptica del cliente: positivo = a favor del cliente (la financiera le debe)
    const saldoCliente = laFinLeDebe - leDebenALaFin
    return { moneda: m, saldoCliente }
  })

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando...</div>
  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 p-6 text-center">
      Cuenta no encontrada. Verificá el link.
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1a1a2e] text-white">
        <div className="max-w-3xl mx-auto px-5 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#2EDBB8] flex items-center justify-center text-[#1a1a2e] font-bold text-lg">$</div>
          <div>
            <div className="font-bold">Cuenta Corriente</div>
            <div className="text-[#2EDBB8] text-sm">{nombre}</div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-6">
        {/* Saldos */}
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(netoPorMoneda.length, 1), 3)}, minmax(0, 1fr))` }}>
          {netoPorMoneda.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-gray-400 text-sm">Sin saldos.</div>
          )}
          {netoPorMoneda.map(({ moneda, saldoCliente }) => (
            <div key={moneda} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="text-xs font-bold text-gray-400 uppercase mb-1">{moneda}</div>
              <div className={`text-2xl font-bold ${saldoCliente > 0 ? 'text-green-600' : saldoCliente < 0 ? 'text-red-600' : 'text-[#1a1a2e]'}`}>
                {SIM[moneda] || ''}{f(Math.abs(saldoCliente), moneda === 'ARS' ? 0 : 2)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {saldoCliente > 0 ? 'A tu favor' : saldoCliente < 0 ? 'Debés' : 'Al día'}
              </div>
            </div>
          ))}
        </div>

        {/* Movimientos */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-bold text-[#1a1a2e] mb-4">Movimientos</h2>
          {calle.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No hay movimientos registrados.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {calle.map(c => {
                const aFavorCliente = c.direccion === 'debo' // la financiera le debe -> a favor del cliente
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#1a1a2e] truncate">{c.descripcion || 'Movimiento'}</div>
                      <div className="text-xs text-gray-400">{c.fecha ? format(new Date(c.fecha + 'T12:00:00'), "dd/MM/yyyy", { locale: es }) : ''}</div>
                    </div>
                    <div className={`text-sm font-bold whitespace-nowrap ${aFavorCliente ? 'text-green-600' : 'text-red-600'}`}>
                      {aFavorCliente ? '+' : '−'}{SIM[c.moneda] || ''}{f(Number(c.monto), c.moneda === 'ARS' ? 0 : 2)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Saldos informativos · {format(new Date(), "dd/MM/yyyy HH:mm", { locale: es })}</p>
      </div>
    </div>
  )
}
