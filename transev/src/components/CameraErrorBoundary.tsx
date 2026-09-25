import React from 'react';

interface Props {
  onFailure: (message: string) => void;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Some getUserMedia failures surface as a synchronous render-time throw
 * rather than through a component's own onError callback, depending on the
 * browser/webview. This boundary catches that so a camera failure degrades
 * to the manual-entry fallback instead of taking down the whole screen.
 */
class CameraErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFailure(error.message || 'Camera failed to start.');
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export default CameraErrorBoundary;
