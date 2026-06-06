'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Cliente {
  id: string
  nombre: string
  email: string
  telefono: string
  activo: boolean
  notas: string
  created_at: string
}

const emptyForm = { nombre: '', email: '', telefono: '', password_hash: '', notas: '' }

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { loadClientes() }, [])

  const loadClientes = async () => {
    const { data } = await supabase.from('clientes').select('*').order('nombre')
    if (data) setClientes(data)
    setLoading(false)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    if (editId) {
      const update: Record<string, string> = { nombre: form.nombre, email: form.email, telefono: form.telefono, notas: form.notas }
      if (form.password_hash) update.password_hash = form.password_hash
      await supabase.from('clientes').update(update).eq('id', editId)
    } else {
      await supabase.from('clientes').insert({ ...form })
    }
    setShowForm(false)
    setForm(emptyForm)
    setEditId(null)
    setSaving(false)
    loadClientes()
  }

  const toggleActivo = async (id: string, activo: boolean) => {
    await supabase.from('clientes').update({ activo: !activo }).eq('id', id)
    loadClientes()
  }

  const handleEdit = (c: Cliente) => {
    setForm({ nombre: c.nombre, email: c.email, telefono: c.telefono || '', password_hash: '', notas: c.notas || '' })
    setEditId(c.id)
    setShowForm(true)
  }

  const filtered = clientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">{clientes.length} clientes registrados</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}>
          + Nuevo Cliente
        </button>
      </div>

      <div className="card mb-6">
        <input
          className="input"
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold mb-6">{editId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Nombre completo</label>
                <input className="input" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} required />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} />
              </div>
              <div>
                <label className="label">{editId ? 'Nueva Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}</label>
                <input className="input" type="text" value={form.password_hash} onChange={e => setForm({...form, password_hash: e.target.value})} required={!editId} />
              </div>
              <div>
                <label className="label">Notas internas</label>
                <textarea className="input" rows={2} value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
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
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-3 font-semibold text-gray-500">Nombre</th>
                <th className="pb-3 font-semibold text-gray-500">Email</th>
                <th className="pb-3 font-semibold text-gray-500">Teléfono</th>
                <th className="pb-3 font-semibold text-gray-500">Estado</th>
                <th className="pb-3 font-semibold text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium">{c.nombre}</td>
                  <td className="py-3 text-gray-500">{c.email}</td>
                  <td className="py-3 text-gray-500">{c.telefono || '—'}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${c.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <a href={`/admin/clientes/${c.id}`} className="text-xs bg-[#2EDBB8] text-[#1a1a2e] font-bold px-3 py-1 rounded-lg hover:bg-[#25c4a4] transition-colors">Ver cuenta</a>
                      <button onClick={() => handleEdit(c)} className="text-xs btn-secondary px-3 py-1">Editar</button>
                      <button onClick={() => toggleActivo(c.id, c.activo)} className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${c.activo ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">No hay clientes</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
