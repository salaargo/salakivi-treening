import { useEffect, useState } from 'react'
import type { AppState } from '../types'
import {
  applyProgramTemplateToUser,
  listRegisteredUsers,
  publishProgramTemplate,
  type UserProfile,
} from '../cloud/sync'

interface AdminUsersPanelProps {
  state: AppState
  adminUserId?: string
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('et-EE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminUsersPanel({ state, adminUserId }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<string | null>(null)
  const [givingId, setGivingId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setUsers(await listRegisteredUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kasutajate laadimine ebaõnnestus.')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handlePublish() {
    setPublishStatus(null)
    try {
      await publishProgramTemplate(state)
      setPublishStatus('Näidiskava on uuendatud. Uued kasutajad saavad need kavad.')
    } catch (err) {
      setPublishStatus(err instanceof Error ? err.message : 'Avaldamine ebaõnnestus.')
    }
  }

  async function handleGiveProgram(user: UserProfile) {
    const label = user.display_name || user.email
    const ok = window.confirm(
      `Anda ${label} sinu praegune näidiskava? Tema kavad/faasid kirjutatakse üle; treeninglogid jäävad alles.`,
    )
    if (!ok) return
    setGivingId(user.user_id)
    setPublishStatus(null)
    try {
      await applyProgramTemplateToUser(user.user_id)
      setPublishStatus(`Näidiskava on antud: ${label}. Ta näeb seda järgmisel avamisel.`)
    } catch (err) {
      setPublishStatus(err instanceof Error ? err.message : 'Näidiskava andmine ebaõnnestus.')
    } finally {
      setGivingId(null)
    }
  }

  return (
    <section className="settings-block admin-block">
      <div className="section-head">
        <h3>Admin</h3>
        <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
          Värskenda
        </button>
      </div>
      <p className="muted small">
        Uued kasutajad saavad sinu praegused treeningkavad näidiseks (ilma sinu logideta). Salvestamine
        uuendab näidist automaatselt. Olemasolevale kasutajale saad kavad anda ka nimekirjast.
      </p>
      <button type="button" className="btn btn-secondary full" onClick={() => void handlePublish()}>
        Avalda kavad näidiseks nüüd
      </button>
      {publishStatus && <p className="muted small">{publishStatus}</p>}

      <p className="plan-name admin-count">
        {loading ? 'Laen kasutajaid…' : `${users.length} registreerunud`}
      </p>
      {error && <p className="auth-error">{error}</p>}

      {!loading && !error && users.length === 0 && (
        <p className="muted small">Veel pole registreerunud kasutajaid.</p>
      )}

      {users.length > 0 && (
        <ul className="user-list">
          {users.map((user) => (
            <li key={user.user_id} className="user-row">
              <p className="plan-name">{user.display_name || 'Nime pole'}</p>
              <p className="muted small user-email">{user.email}</p>
              <p className="muted small">Registreeritud {formatWhen(user.created_at)}</p>
              <p className="muted small">Viimati kasutas {formatWhen(user.last_seen_at)}</p>
              {user.user_id !== adminUserId && (
                <button
                  type="button"
                  className="btn btn-secondary full user-give"
                  disabled={givingId === user.user_id}
                  onClick={() => void handleGiveProgram(user)}
                >
                  {givingId === user.user_id ? 'Andan kava…' : 'Anna näidiskava'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
