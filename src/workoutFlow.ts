/** Mida teha pärast seeria märkimist tehtuks. */

export type AfterSetAction =
  | { kind: 'sauna' }
  | { kind: 'pick' }
  | { kind: 'continue'; nextSlot: number; rest: boolean }

/**
 * Kaks harjutust: hoia ringi alguse järjekord (kes oli esimene, on ka järgmise ringi esimene).
 * Paus pärast teist sooritust. Järjekorda saab muuta Starti oodates teist harjutust valides.
 */
export function afterSetAction(input: {
  selectedLength: number
  activeSlot: number
  otherSlot: number
  thisCompleted: number
  otherCompleted: number
  thisDone: boolean
  otherStillOpen: boolean
  allDone: boolean
}): AfterSetAction {
  if (input.allDone) return { kind: 'sauna' }

  const isPair = input.selectedLength === 2
  if (isPair && input.otherStillOpen) {
    if (input.thisCompleted > input.otherCompleted) {
      return { kind: 'continue', nextSlot: input.otherSlot, rest: false }
    }
    return { kind: 'continue', nextSlot: input.otherSlot, rest: true }
  }

  if (input.thisDone) return { kind: 'pick' }

  return { kind: 'continue', nextSlot: input.activeSlot, rest: true }
}
