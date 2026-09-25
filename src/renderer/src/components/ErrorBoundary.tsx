import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Shows `fallback` instead of a child that threw (a WebGL scene that could not start, say). */
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: (e: Error) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('effect fell back:', error.message, info.componentStack?.split('\n')[1] ?? '')
    this.props.onError?.(error)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
