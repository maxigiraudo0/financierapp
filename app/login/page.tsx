'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Admin login
    if (email === 'admin' && password === (process.env.NEXT_PUBLIC_ADMIN_PASS || 'admin123')) {
      localStorage.setItem('role', 'admin')
      router.push('/admin')
      return
    }

    // Cliente login
    const { data: cliente, error: err } = await supabase
      .from('clientes')
      .select('id, nombre, password_hash, activo')
      .eq('email', email)
      .single()

    if (err || !cliente) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }

    if (!cliente.activo) {
      setError('Tu cuenta está desactivada. Contactá a tu operador.')
      setLoading(false)
      return
    }

    if (cliente.password_hash !== password) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }

    localStorage.setItem('role', 'cliente')
    localStorage.setItem('clienteId', cliente.id)
    localStorage.setItem('clienteNombre', cliente.nombre)
    router.push('/cliente')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1a2e]">
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#2EDBB8] mb-4">
            <svg className="w-8 h-8 text-[#1a1a2e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Financiera</h1>
          <p className="text-gray-400 text-sm mt-1">Accedé a tu cuenta</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Email / Usuario</label>
              <input
                className="input"
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
              />
            </div>
            <div>
              <label className="label">Contraseña</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
