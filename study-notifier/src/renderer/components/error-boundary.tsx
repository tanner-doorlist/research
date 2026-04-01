import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
          <div className="text-[14px] font-medium text-text-primary">
            Something went wrong
          </div>
          <div className="text-[12px] text-text-tertiary max-w-[300px]">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={this.handleReload}
            className="h-7 px-4 border-none rounded-[var(--radius-md)] bg-accent text-white text-[12px] font-medium cursor-pointer hover:brightness-110 transition-all"
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
