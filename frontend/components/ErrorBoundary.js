import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
    this.setState({ info });
  }

  reset = () => this.setState({ hasError: false, error: null, info: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-red-900/20 border border-red-500/30 rounded-xl p-6 text-center">
            <div className="text-2xl mb-2">⚠️</div>
            <h3 className="text-white font-semibold mb-2">Rendering error</h3>
            <p className="text-red-300 text-sm mb-4 font-mono">{String(this.state.error?.message || this.state.error || 'Unknown error')}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={this.reset} className="bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-2 rounded-lg">Retry render</button>
              <button onClick={() => window.location.href = '/'} className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg">New simulation</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
