import { useState } from 'react'

interface StopWorkoutControlProps {
  onConfirmStop: () => void
}

export function StopWorkoutControl({ onConfirmStop }: StopWorkoutControlProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn-stopp"
        onClick={() => setOpen(true)}
        aria-label="STOPP — lõpeta tänane treening"
      >
        STOPP
      </button>

      {open && (
        <div className="stopp-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="stopp-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stopp-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="stopp-title" className="stopp-modal-text">
              Oled kindel, et soovid tänast treeningut juba lõpetada?
            </p>
            <div className="stopp-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-stopp-ok"
                onClick={() => {
                  setOpen(false)
                  onConfirmStop()
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
