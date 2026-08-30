import { useEffect, useMemo, useState } from 'react'
import type { AppState, DayLog, PhaseId, Screen } from './types'
import {
  loadState,
  saveState,
  getSpotlightProgress,
  getSpotlightGroup,
  startGroupPhase,
} from './storage'
import { HomeScreen } from './screens/HomeScreen'
import { TrainChoiceScreen } from './screens/TrainChoiceScreen'
import { TrainPhaseScreen } from './screens/TrainPhaseScreen'
import { WeekScreen } from './screens/WeekScreen'
import { WorkoutScreen } from './screens/WorkoutScreen'
import { SettingsScreen } from './screens/SettingsScreen'

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [weekOffset, setWeekOffset] = useState(0)

  useEffect(() => {
    saveState(state)
  }, [state])

  const spotlight = useMemo(() => getSpotlightProgress(state), [state])

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

  return (
    <div className="app-shell">
      {screen.name === 'home' && (
        <HomeScreen
          groupName={spotlight?.group.name ?? 'Grupp'}
          phaseName={spotlight?.progress.phase.name ?? '—'}
          phaseHint={
            spotlight
              ? `${spotlight.progress.phase.description} · nädal ${spotlight.progress.weekInPhase}/${spotlight.progress.phase.weeks}`
              : 'Lisa grupp, kavad ja pane need nädalapäevadele.'
          }
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
        />
      )}
    </div>
  )
}
