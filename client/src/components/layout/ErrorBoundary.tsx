import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single broken page does not leave a blank
 * screen.
 *
 * Without this, any uncaught error in a route unmounts the whole React tree and
 * the user sees an empty page with no explanation and no way back. The stack is
 * only shown outside production, where it would leak internals to visitors.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console error rather than a silent swallow: this is the only
    // record of the failure in a client-side render.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-rice-100 p-4">
        <div className="max-w-lg rounded-[var(--radius-card)] border border-amber-200 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-soil-900">This page could not be displayed</h1>
          <p className="mt-2 text-sm leading-relaxed text-soil-600">
            Something went wrong while rendering. Reloading usually clears it. If it keeps
            happening, the details below will help support find the cause.
          </p>
          {!import.meta.env.PROD && (
            <pre className="mt-4 max-h-48 overflow-auto rounded bg-soil-50 p-3 text-left text-xs text-soil-700">
              {error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-[var(--radius-control)] bg-leaf-700 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-800"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
