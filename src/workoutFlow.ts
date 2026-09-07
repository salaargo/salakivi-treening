/** Mida teha pärast seeria märkimist tehtuks. */

export type AfterSetAction =
  | { kind: 'sauna' }
  | { kind: 'pick' }
  | { kind: 'continue'; nextSlot: number; rest: boolean }

/**
 * Kaks harjutust segamini: paus ainult pärast teist, enne esimese järgmist seeriat.
 * Kui valitud harjutuste seeriad on läbi, mine kohe valikusse (ilma taimerita).
 */
export function afterSetAction(input: {
  selectedLength: number
  activeSlot: number
  thisDone: boolean
  otherStillOpen: boolean
  allDone: boolean
}): AfterSetAction {
  if (input.allDone) return { kind: 'sauna' }

  const isPair = input.selectedLength === 2
  if (isPair && input.otherStillOpen) {
    if (input.activeSlot === 0) {
      return { kind: 'continue', nextSlot: 1, rest: false }
    }
    return { kind: 'continue', nextSlot: 0, rest: true }
  }

  if (input.thisDone) return { kind: 'pick' }

  return { kind: 'continue', nextSlot: input.activeSlot, rest: true }
}
