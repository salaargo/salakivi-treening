import { useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'

type AuthMode = 'login' | 'register' | 'forgot' | 'new-password'

interface AuthScreenProps {
  onSignedIn: () => void
  /** Kui true, näita uue parooli vormi (pärast meililinki). */
  recoveryMode?: boolean
  onPasswordUpdated?: () => void
}

function appRedirectUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${window.location.origin}${path}`
}

export function AuthScreen({ onSignedIn, recoveryMode = false, onPasswordUpdated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(recoveryMode ? 'new-password' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (recoveryMode) setMode('new-password')
  }, [recoveryMode])

  function switchMode(next: AuthMode) {
    setMode(next)
    setError(null)
    setMessage(null)
    setPassword('')
    setPassword2('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)

    const supabase = getSupabase()
    const trimmedEmail = email.trim()

    try {
      if (mode === 'forgot') {
        if (!trimmedEmail) throw new Error('Sisesta e-posti aadress.')
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: appRedirectUrl(),
        })
        if (resetError) throw resetError
        setMessage('Kui see e-post on registreeritud, saatsime taastamislingi. Kontrolli postkasti (ka rämpsposti).')
        return
      }

      if (mode === 'new-password') {
        if (password.length < 6) throw new Error('Parool peab olema vähemalt 6 märki.')
        if (password !== password2) throw new Error('Paroolid ei kattu.')
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        setMessage('Parool uuendatud. Võid jätkata.')
        onPasswordUpdated?.()
        onSignedIn()
        return
      }

      if (mode === 'register') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        })
        if (signUpError) throw signUpError
        setMessage('Konto loodud. Kui kinnitus on vajalik, kontrolli e-posti. Proovi seejärel sisse logida.')
        switchMode('login')
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (signInError) throw signInError
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toiming ebaõnnestus.')
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'forgot' ? 'Taasta parool' : mode === 'new-password' ? 'Uus parool' : null

  const submitLabel =
    mode === 'forgot'
      ? 'Saada taastamislink'
      : mode === 'new-password'
        ? 'Salvesta uus parool'
        : mode === 'register'
          ? 'Registreeru'
          : 'Logi sisse'

  return (
    <div className="screen auth-screen">
      <header className="home-hero">
        <p className="eyebrow">Salakivi</p>
        <h1 className="brand">Treening</h1>
        {title && <p className="muted">{title}</p>}
      </header>

      <form className="auth-card" onSubmit={handleSubmit}>
        {(mode === 'login' || mode === 'register') && (
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${mode === 'login' ? 'is-on' : ''}`}
              onClick={() => switchMode('login')}
            >
              Logi sisse
            </button>
            <button
              type="button"
              className={`auth-tab ${mode === 'register' ? 'is-on' : ''}`}
              onClick={() => switchMode('register')}
            >
              Loo konto
            </button>
          </div>
        )}

        {mode !== 'new-password' && (
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
        )}

        {(mode === 'login' || mode === 'register' || mode === 'new-password') && (
          <div className="field block">
            <label htmlFor="auth-password">
              {mode === 'new-password' ? 'Uus parool' : 'Parool'}
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
        )}

        {mode === 'new-password' && (
          <div className="field block">
            <label htmlFor="auth-password2">Korda uut parooli</label>
            <input
              id="auth-password2"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              minLength={6}
              required
            />
          </div>
        )}

        {mode === 'forgot' && (
          <p className="muted auth-hint">
            Saadame lingi, millega saad uue parooli määrata. Link kehtib piiratud aja.
          </p>
        )}

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}

        <button type="submit" className="btn btn-hero full" disabled={busy}>
          {busy ? 'Oota…' : submitLabel}
        </button>

        {mode === 'login' && (
          <button type="button" className="btn-link" onClick={() => switchMode('forgot')}>
            Unustasid parooli?
          </button>
        )}

        {(mode === 'forgot' || (mode === 'new-password' && !recoveryMode)) && (
          <button type="button" className="btn-link" onClick={() => switchMode('login')}>
            Tagasi sisselogimisele
          </button>
        )}
      </form>
    </div>
  )
}
