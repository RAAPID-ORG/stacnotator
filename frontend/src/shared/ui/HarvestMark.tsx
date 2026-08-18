export const HARVEST_SITE = 'https://nasaharvest.org';

/** The NASA Harvest logo. Sized by the caller through `className`. */
export const HarvestMark = ({ className }: { className?: string }) => (
  <img src="/nasa-harvest.png" alt="NASA Harvest" className={className} />
);
