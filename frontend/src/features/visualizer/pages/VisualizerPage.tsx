import { useEffect } from 'react';
import { AnnotationPage } from '~/features/annotation/pages/AnnotationPage';
import { useLayoutStore } from '~/features/layout/layout.store';

export default function VisualizerPage() {
  const setVisualizerMode = useLayoutStore((s) => s.setVisualizerMode);

  useEffect(() => {
    setVisualizerMode(true);
    return () => setVisualizerMode(false);
  }, [setVisualizerMode]);

  return <AnnotationPage />;
}
