interface ConfirmDialogProps {
  title: string
  text: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel = 'OK',
  cancelLabel = 'Tagasi',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="stopp-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="stopp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-title" className="stopp-modal-text">
          {title}
        </p>
        <p className="muted small">{text}</p>
        <div className="stopp-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-stopp-ok" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
