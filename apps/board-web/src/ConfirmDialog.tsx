export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onClick={props.onCancel}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{props.title}</h3>
        <p id="confirm-dialog-desc">{props.message}</p>
        <div className="confirm-actions">
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className={props.danger ? "danger" : undefined}
            disabled={props.busy}
            onClick={props.onConfirm}
            autoFocus
          >
            {props.busy ? "处理中…" : (props.confirmLabel ?? "确认")}
          </button>
        </div>
      </div>
    </div>
  );
}
