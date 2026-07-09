import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort boundary so a render error or a failed lazy chunk shows a
 * recoverable message instead of a permanently blank page. Styled with plain
 * inline styles on purpose — it must render even if the stylesheet or theme
 * failed to load.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unrecoverable render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "hsl(20 9% 6%)",
          color: "hsl(40 23% 92%)",
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "hsl(33 9% 64%)", marginBottom: "1.5rem" }}>
            The page failed to load. This is usually temporary — reloading picks
            up the latest version of the site.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.75rem 1.5rem",
              background: "hsl(355 58% 71%)",
              color: "hsl(20 10% 8%)",
              border: "none",
              borderRadius: "0.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
