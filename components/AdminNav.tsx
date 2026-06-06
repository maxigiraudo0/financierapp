'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'

const links = [
  { href: '/admin', label: 'Dashboard', icon: '📊' },
  { href: '/admin/clientes', label: 'Clientes', icon: '👥' },
  { href: '/admin/operaciones', label: 'Operaciones', icon: '💱' },
  { href: '/admin/mesa', label: 'Mesa / Arbitraje', icon: '🔀' },
  { href: '/admin/cuentas', label: 'Cuentas', icon: '🏦' },
  { href: '/admin/calle', label: 'En la Calle', icon: '🚶' },
  { href: '/admin/cierre', label: 'Cierre Diario', icon: '📋' },
]

export default function AdminNav() {
  const pathname = usePathname()
  const router = useRouter()

  const logout = () => {
    localStorage.clear()
    router.push('/login')
  }

  return (
    <aside className="w-60 min-h-screen bg-[#1a1a2e] flex flex-col fixed left-0 top-0">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#2EDBB8] flex items-center justify-center text-[#1a1a2e] font-bold text-lg">$</div>
          <div>
            <div className="text-white font-bold text-sm">Financiera</div>
            <div className="text-[#2EDBB8] text-xs">Panel Admin</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {links.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
              pathname === link.href
                ? 'bg-[#2EDBB8] text-[#1a1a2e]'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            )}
          >
            <span>{link.icon}</span>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="p-4">
        <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
          <span>🚪</span> Salir
        </button>
      </div>
    </aside>
  )
}
