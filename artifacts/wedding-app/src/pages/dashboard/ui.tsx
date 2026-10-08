import type { ReactNode } from "react";
import { galleryStage, stageLabel } from "./galleryStats";

/**
 * Small presentational pieces shared by the dashboard panels and tour-day
 * mode. Styles live in styles/dashboard.css.
 */

export function SectionHead({
  title,
  description,
  aside,
  id,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="dash-section-head">
      <div>
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function Note({
  tone = "info",
  children,
  actions,
  role,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  children: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className="dash-note" data-tone={tone} role={role}>
      <div className="min-w-0">{children}</div>
      {actions ? <div className="dash-note-actions">{actions}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const stage = galleryStage(status);
  return (
    <span className="status-pill" data-stage={stage}>
      {stageLabel(stage)}
    </span>
  );
}

export function Tag({ tone, children }: { tone?: "quality" | "sample"; children: ReactNode }) {
  return (
    <span className="status-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** An accessible switch: a button with role="switch". */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
      data-testid={testId}
    />
  );
}

export function Toggle({
  title,
  body,
  checked,
  onChange,
  disabled,
  reason,
  testId,
}: {
  title: string;
  body: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** One line under the control explaining why it is off. */
  reason?: string | null;
  testId?: string;
}) {
  return (
    <div className="toggle">
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {disabled && reason ? (
          <p className="field-hint" data-tone="warn">
            {reason}
          </p>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} testId={testId} />
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  hintTone,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  hintTone?: "danger";
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="field-hint" data-tone={hintTone}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
