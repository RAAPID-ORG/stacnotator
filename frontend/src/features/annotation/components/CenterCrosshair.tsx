import { useImageryStore } from '../stores/imagery';
import { useCampaignStore } from '../stores/campaign';

/**
 * The crosshair for Explore.
 *
 * Tasks draws its crosshair as a map feature because it marks the task's
 * location; Explore has no such point, so the crosshair marks the middle of
 * what you are looking at instead. That is screen-fixed by definition, which
 * also keeps it off the layer composition and out of every pan frame.
 */
export function CenterCrosshair() {
  const mode = useCampaignStore((s) => s.workMode);
  const crosshair = useImageryStore((s) => s.crosshair);

  if (mode !== 'explore' || !crosshair) return null;
  return (
    <div
      data-testid="center-crosshair"
      className="pointer-events-none absolute left-1/2 top-1/2 z-[900] h-5 w-5 -translate-x-1/2 -translate-y-1/2"
      aria-hidden="true"
    >
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-500/90" />
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-red-500/90" />
    </div>
  );
}
