import { useState } from 'react'
import { getSupabase } from '../lib/supabase'

interface AuthScreenProps {
  onSignedIn: () => void
}

export function AuthScreen({ onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)

    const supabase = getSupabase()
    const trimmedEmail = email.trim()

    try {
      if (mode === 'register') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        })
        if (signUpError) throw signUpError
        setMessage('Konto loodud. Kui kinnitus on vajalik, kontrolli e-posti. Proovi seejärel sisse logida.')
        setMode('login')
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (signInError) throw signInError
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sisselogimine ebaõnnestus.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen auth-screen">
      <header className="home-hero">
        <p className="eyebrow">Salakivi</p>
        <h1 className="brand">Treening</h1>
        <p className="muted">Logi sisse, et sinu logid ja statistika oleksid pilves.</p>
      </header>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'is-on' : ''}`}
            onClick={() => {
              setMode('login')
              setError(null)
              setMessage(null)
            }}
          >
            Logi sisse
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'is-on' : ''}`}
            onClick={() => {
              setMode('register')
              setError(null)
              setMessage(null)
            }}
          >
            Loo konto
          </button>
        </div>

        <div className="field block">
          <label htmlFor="auth-email">E-post</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field block">
          <label htmlFor="auth-password">Parool</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </div>

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}

        <button type="submit" className="btn btn-hero full" disabled={busy}>
          {busy ? 'Oota…' : mode === 'register' ? 'Registreeru' : 'Logi sisse'}
        </button>
      </form>
    </div>
  )
}
