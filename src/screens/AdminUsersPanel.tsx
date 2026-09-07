import { useEffect, useState } from 'react'
import type { AppState } from '../types'
import { listRegisteredUsers, publishProgramTemplate, type UserProfile } from '../cloud/sync'

interface AdminUsersPanelProps {
  state: AppState
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

export function AdminUsersPanel({ state }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<string | null>(null)

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
        uuendab näidist automaatselt.
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
              <p className="plan-name user-email">{user.email}</p>
              <p className="muted small">Registreeritud {formatWhen(user.created_at)}</p>
              <p className="muted small">Viimati kasutas {formatWhen(user.last_seen_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
