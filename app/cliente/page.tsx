'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Movimiento {
  id: string
  fecha: string
  moneda: string
  monto: number
  direccion: string  // 'deben' (le debe a la financiera) | 'debo' (la financiera le debe)
  descripcion: string
  conciliado: boolean
}

const MONEDAS = ['USD', 'ARS', 'USDT', 'EUR']

export default function ClientePage() {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroMoneda, setFiltroMoneda] = useState('')

  useEffect(() => {
    const role = localStorage.getItem('role')
    const id = localStorage.getItem('clienteId')
    const nom = localStorage.getItem('clienteNombre')
    if (role !== 'cliente' || !id) { router.replace('/login'); return }
    setNombre(nom || '')
    setClienteId(id)
    loadData(id)
  }, [router])

  const loadData = async (id: string) => {
    const { data } = await supabase
      .from('saldo_calle')
      .select('id, fecha, moneda, monto, direccion, descripcion, conciliado, activo')
      .eq('cliente_id', id)
      .order('fecha', { ascending: false })
    if (data) setMovs(data as unknown as Movimiento[])
    setLoading(false)
  }

  const toggleConciliado = async (id: string, actual: boolean) => {
    setMovs(ms => ms.map(m => m.id === id ? { ...m, conciliado: !actual } : m))
    await supabase.from('saldo_calle').update({ conciliado: !actual }).eq('id', id)
  }

  const logout = () => { localStorage.clear(); router.push('/login') }

  // Saldo neto por moneda (desde la óptica del cliente):
  // 'deben' = el cliente le debe a la financiera → negativo para el cliente
  // 'debo'  = la financiera le debe al cliente → positivo (a favor)
  const saldoPorMoneda = (m: string) => {
    return movs
      .filter(x => x.moneda === m && x.activo !== false)
      .reduce((s, x) => s + (x.direccion === 'debo' ? x.monto : -x.monto), 0)
  }

  const f = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  const movsFiltrados = filtroMoneda ? movs.filter(m => m.moneda === filtroMoneda) : movs
  const pendientesConciliar = movs.filter(m => !m.conciliado && m.activo !== false).length

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#2EDBB8] flex items-center justify-center text-[#1a1a2e] font-bold">$</div>
          <div>
            <div className="text-white font-bold text-sm">Financiera</div>
            <div className="text-gray-400 text-xs">Estado de cuenta</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white text-sm font-medium">{nombre}</span>
          <button onClick={logout} className="text-gray-400 hover:text-white text-sm transition-colors">Salir →</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Hola, {nombre.split(' ')[0]} 👋</h1>
          <p className="text-gray-400 text-sm mt-1">Tu estado de cuenta y movimientos</p>
        </div>

        {/* Saldos netos */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {MONEDAS.map(m => {
            const saldo = saldoPorMoneda(m)
            if (saldo === 0) return null
            const aFavor = saldo > 0
            return (
              <div key={m} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${aFavor ? 'text-[#2EDBB8]' : 'text-red-400'}`}>
                  {m}
                </div>
                <div className="text-xl font-bold text-white">
                  {m === 'USDT' ? '◎' : m === 'EUR' ? '€' : '$'}{f(Math.abs(saldo), m === 'ARS' ? 0 : 2)}
                </div>
                <div className={`text-xs mt-1 ${aFavor ? 'text-[#2EDBB8]' : 'text-red-400'}`}>
                  {aFavor ? 'A tu favor' : 'Debés'}
                </div>
              </div>
            )
          })}
          {MONEDAS.every(m => saldoPorMoneda(m) === 0) && (
            <div className="col-span-4 bg-white/5 border border-white/10 rounded-2xl p-6 text-center text-gray-400">
              Sin saldo pendiente
            </div>
          )}
        </div>

        {/* Filtros + conciliación */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button onClick={() => setFiltroMoneda('')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!filtroMoneda ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-white/5 text-gray-400'}`}>Todas</button>
            {MONEDAS.map(m => (
              <button key={m} onClick={() => setFiltroMoneda(m)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${filtroMoneda === m ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'bg-white/5 text-gray-400'}`}>{m}</button>
            ))}
          </div>
          {pendientesConciliar > 0 && (
            <span className="text-xs text-yellow-400">{pendientesConciliar} sin conciliar</span>
          )}
        </div>

        {/* Movimientos */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-white font-bold">Movimientos</h2>
            <span className="text-gray-400 text-sm">{movsFiltrados.length}</span>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12">Cargando...</div>
          ) : movsFiltrados.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No hay movimientos</div>
          ) : (
            <div className="divide-y divide-white/5">
              {movsFiltrados.map(m => {
                const aFavor = m.direccion === 'debo'
                const cancelado = m.activo === false
                return (
                  <div key={m.id} className={`px-6 py-4 flex items-center justify-between gap-4 hover:bg-white/5 transition-colors ${cancelado ? 'opacity-40' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Checkbox conciliar */}
                      <button
                        onClick={() => toggleConciliado(m.id, m.conciliado)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center text-xs flex-shrink-0 transition-colors ${m.conciliado ? 'bg-[#2EDBB8] text-[#1a1a2e]' : 'border border-white/20 text-transparent hover:border-[#2EDBB8]'}`}
                        title={m.conciliado ? 'Conciliado' : 'Marcar como conciliado'}
                      >✓</button>
                      <div className="min-w-0">
                        <div className="text-sm text-gray-200 truncate">{m.descripcion || (aFavor ? 'Saldo a favor' : 'Saldo a pagar')}</div>
                        <div className="text-xs text-gray-500">
                          {format(new Date(m.fecha + 'T12:00:00'), "dd 'de' MMM yyyy", { locale: es })}
                          {cancelado && <span className="ml-2 text-green-400">• saldado</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-mono font-bold ${aFavor ? 'text-[#2EDBB8]' : 'text-red-400'}`}>
                        {aFavor ? '+' : '-'}{m.moneda === 'USDT' ? '◎' : m.moneda === 'EUR' ? '€' : '$'}{f(m.monto, m.moneda === 'ARS' ? 0 : 2)}
                      </div>
                      <div className="text-xs text-gray-500">{m.moneda} · {aFavor ? 'a tu favor' : 'debés'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-center text-gray-500 text-xs mt-6">
          Tildá cada movimiento para conciliarlo. Ante cualquier diferencia, contactá a tu operador.
        </p>
      </div>
    </div>
  )
}
