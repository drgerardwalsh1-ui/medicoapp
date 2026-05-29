// ── DSM Error Boundary ────────────────────────────────────────────────────────
//
// Defensive fallback for the DSM rendering subtree. The DSM registry grows
// quickly and a single malformed diagnosis definition (e.g. an undefined
// symptom entity, a circular reference, a mistyped specifier string) could
// throw during render and blank the whole app. This boundary catches such
// errors, logs them with enough context to debug, and renders a recovery
// panel so the rest of the app stays usable.
//
// Wrap the highest DSM-aware mount point — DSMPage, CurrentSymptomsPage,
// MSEPage — rather than every individual leaf component. One boundary per
// page keeps the fallback proportional: a crash inside DSM never propagates
// outside that page's body.

import React from "react";

type DSMErrorBoundaryProps = {
  children: React.ReactNode;
  /** Label for the failing region in the fallback message. */
  label?: string;
};

type DSMErrorBoundaryState = {
  hasError: boolean;
  message?: string;
  stack?: string;
};

export class DSMErrorBoundary extends React.Component<
  DSMErrorBoundaryProps,
  DSMErrorBoundaryState
> {
  state: DSMErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(err: unknown): DSMErrorBoundaryState {
    const message =
      err instanceof Error ? err.message : String(err ?? "Unknown error");
    const stack = err instanceof Error ? err.stack : undefined;
    return { hasError: true, message, stack };
  }

  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    // Surface in dev console with full context; in production this becomes
    // a single grouped log entry rather than a crash.
    // eslint-disable-next-line no-console
    console.error(
      `[DSMErrorBoundary] ${this.props.label ?? "DSM region"} crashed:`,
      err,
      info.componentStack,
    );
  }

  reset = () => this.setState({ hasError: false, message: undefined, stack: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
          <h2 className="text-base font-semibold text-amber-900">
            {this.props.label ?? "DSM section"} couldn't be displayed.
          </h2>
          <p className="text-sm text-amber-800">
            The rest of the app is still working. A diagnosis definition or
            symptom mapping likely contains malformed data. The error has
            been logged to the developer console.
          </p>
          {this.state.message && (
            <pre className="text-[11px] text-amber-900 bg-white/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
              {this.state.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reset}
            className="text-xs px-3 py-1.5 rounded-md border border-amber-300 bg-white hover:bg-amber-100 text-amber-900"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

export default DSMErrorBoundary;
