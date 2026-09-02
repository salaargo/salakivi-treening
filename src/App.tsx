import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppState, DayLog, PhaseId, Screen } from './types'
import {
  loadState,
  saveState,
  getSpotlightProgress,
  getSpotlightGroup,
  startGroupPhase,
} from './storage'
import { isCloudEnabled, loadCloudState, saveCloudState } from './cloud/sync'
import { getSupabase } from './lib/supabase'
import { HomeScreen } from './screens/HomeScreen'
import { AuthScreen } from './screens/AuthScreen'
import { TrainChoiceScreen } from './screens/TrainChoiceScreen'
import { TrainPhaseScreen } from './screens/TrainPhaseScreen'
import { WeekScreen } from './screens/WeekScreen'
import { WorkoutScreen } from './screens/WorkoutScreen'
import { SettingsScreen } from './screens/SettingsScreen'

export default function App() {
  const cloud = isCloudEnabled()
  const [authReady, setAuthReady] = useState(!cloud)
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState<AppState>(() => loadState())
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [weekOffset, setWeekOffset] = useState(0)
  const [bootError, setBootError] = useState<string | null>(null)
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const skipCloudSave = useRef(true)

  const userId = session?.user.id ?? null
  const userEmail = session?.user.email ?? ''

  useEffect(() => {
    if (!cloud) return

    const supabase = getSupabase()

    async function bootstrap() {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setBootError(error.message)
        setAuthReady(true)
        return
      }

      const current = data.session
      setSession(current)
      if (current?.user) {
        try {
          const loaded = await loadCloudState(current.user.id)
          setState(loaded)
          skipCloudSave.current = true
        } catch (err) {
          setBootError(err instanceof Error ? err.message : 'Pilve andmete laadimine ebaõnnestus.')
        }
      }
      setAuthReady(true)
    }

    void bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setState(loadState())
        setScreen({ name: 'home' })
        skipCloudSave.current = true
      }
    })

    return () => subscription.unsubscribe()
  }, [cloud])

  useEffect(() => {
    saveState(state)
    if (!cloud || !userId) return
    if (skipCloudSave.current) {
      skipCloudSave.current = false
      return
    }

    setCloudStatus('saving')
    const timer = window.setTimeout(() => {
      void saveCloudState(userId, state)
        .then(() => setCloudStatus('saved'))
        .catch(() => setCloudStatus('error'))
    }, 700)

    return () => window.clearTimeout(timer)
  }, [state, userId, cloud])

  const spotlight = useMemo(() => getSpotlightProgress(state), [state])

  const handleSignedIn = useCallback(async () => {
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.user) return
    setSession(data.session)
    const loaded = await loadCloudState(data.session.user.id)
    setState(loaded)
    skipCloudSave.current = true
    setScreen({ name: 'home' })
  }, [])

  async function handleLogout() {
    const supabase = getSupabase()
    await supabase.auth.signOut()
    setSession(null)
    setState(loadState())
    skipCloudSave.current = true
    setScreen({ name: 'home' })
  }

  function updateLog(log: DayLog) {
    setState((prev) => ({
      ...prev,
      logs: { ...prev.logs, [log.dateKey]: log },
    }))
  }

  function goToWeek() {
    setWeekOffset(0)
    setScreen({ name: 'week' })
  }

  function handleStartPhase(phaseId: PhaseId) {
    const group = getSpotlightGroup(state)
    if (!group) {
      goToWeek()
      return
    }
    setState((prev) => startGroupPhase(prev, group.id, phaseId))
    goToWeek()
  }

  if (!authReady) {
    return (
      <div className="app-shell">
        <p className="muted pad">Laen…</p>
      </div>
    )
  }

  if (cloud && !userId) {
    return (
      <div className="app-shell">
        {bootError && <p className="auth-error pad">{bootError}</p>}
        <AuthScreen onSignedIn={() => void handleSignedIn()} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      {cloud && cloudStatus === 'error' && (
        <p className="cloud-banner error">Pilve salvestamine ebaõnnestus. Proovi uuesti.</p>
      )}

      {screen.name === 'home' && (
        <HomeScreen
          groupName={spotlight?.group.name ?? 'Grupp'}
          phaseName={spotlight?.progress.phase.name ?? '—'}
          phaseHint={
            spotlight
              ? `${spotlight.progress.phase.description} · nädal ${spotlight.progress.weekInPhase}/${spotlight.progress.phase.weeks}`
              : 'Lisa grupp, kavad ja pane need nädalapäevadele.'
          }
          userEmail={cloud ? userEmail : undefined}
          onTrain={() => setScreen({ name: 'train-choice' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      )}

      {screen.name === 'train-choice' && (
        <TrainChoiceScreen
          groupName={spotlight?.group.name ?? 'Grupp'}
          phaseName={spotlight?.progress.phase.name ?? '—'}
          phaseHint={
            spotlight
              ? `${spotlight.progress.phase.description} · nädal ${spotlight.progress.weekInPhase}/${spotlight.progress.phase.weeks}`
              : 'Faas jookseb kalendri järgi.'
          }
          onContinue={goToWeek}
          onStartNewPhase={() => setScreen({ name: 'train-phase' })}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}

      {screen.name === 'train-phase' && (
        <TrainPhaseScreen
          groupName={spotlight?.group.name ?? 'Grupp'}
          phases={state.phases}
          onSelectPhase={handleStartPhase}
          onBack={() => setScreen({ name: 'train-choice' })}
        />
      )}

      {screen.name === 'week' && (
        <WeekScreen
          state={state}
          weekOffset={weekOffset}
          onWeekOffset={setWeekOffset}
          onBack={() => setScreen({ name: 'train-choice' })}
          onSelectDay={(dateKey) => setScreen({ name: 'workout', dateKey })}
        />
      )}

      {screen.name === 'workout' && (
        <WorkoutScreen
          state={state}
          dateKey={screen.dateKey}
          onBack={() => setScreen({ name: 'week' })}
          onFinish={() => setScreen({ name: 'home' })}
          onUpdateLog={updateLog}
          onChangeState={setState}
        />
      )}

      {screen.name === 'settings' && (
        <SettingsScreen
          state={state}
          onChange={setState}
          onBack={() => setScreen({ name: 'home' })}
          userEmail={cloud ? userEmail : undefined}
          onLogout={cloud ? () => void handleLogout() : undefined}
        />
      )}
    </div>
  )
}
