/**
 * Shared icon library - all outline/stroke-based SVGs.
 * Consistent style: viewBox 0 0 20 20, stroke="currentColor", strokeWidth="1.5",
 * strokeLinecap="round", strokeLinejoin="round", fill="none".
 */

interface IconProps {
  className?: string;
}

const defaults = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconPlus = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const IconTrash = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4 5h12M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1M8 8v6M12 8v6M5 5l1 11a1 1 0 001 1h6a1 1 0 001-1l1-11" />
  </svg>
);

export const IconChevronDown = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M5 7.5l5 5 5-5" />
  </svg>
);

export const IconChevronUp = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M15 12.5l-5-5-5 5" />
  </svg>
);

export const IconChevronRight = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M7.5 5l5 5-5 5" />
  </svg>
);

export const IconChevronLeft = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M12.5 15l-5-5 5-5" />
  </svg>
);

export const IconEye = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M1.5 10s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z" />
    <circle cx="10" cy="10" r="2.5" />
  </svg>
);

export const IconEyeSlash = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M2.5 2.5l15 15M8.15 8.15a2.5 2.5 0 003.7 3.7M5 5.5C3.2 6.9 1.5 10 1.5 10s3 6 8.5 6c1.6 0 3-.5 4.2-1.2M15 14.5c1.8-1.4 3.5-4.5 3.5-4.5s-3-6-8.5-6c-1 0-1.9.2-2.7.5" />
  </svg>
);

export const IconMap = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M7 3L2 5.5v12L7 15l6 2.5 5-2.5v-12L13 5 7 3z" />
    <path d="M7 3v12M13 5v12" />
  </svg>
);

export const IconGlobe = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="10" cy="10" r="8" />
    <path d="M2 10h16M10 2a12 12 0 014 8 12 12 0 01-4 8 12 12 0 01-4-8 12 12 0 014-8z" />
  </svg>
);

export const IconStac = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="3" y="2" width="12" height="3" rx="1" opacity=".3" />
    <rect x="4" y="4" width="12" height="3" rx="1" opacity=".55" />
    <rect x="5" y="7" width="12" height="10" rx="1.5" />
    <circle cx="11" cy="12" r="3" />
    <path d="M11 9a8 8 0 012 3 8 8 0 01-2 3 8 8 0 01-2-3 8 8 0 012-3z" />
    <path d="M8 12h6" />
  </svg>
);

export const IconLayers = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 2L2 6.5 10 11l8-4.5L10 2z" />
    <path d="M2 10l8 4.5L18 10" />
    <path d="M2 13.5l8 4.5 8-4.5" />
  </svg>
);

export const IconClock = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="10" cy="10" r="8" />
    <path d="M10 5v5l3 3" />
  </svg>
);

export const IconInfo = ({ className = 'w-3 h-3' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="10" cy="10" r="8" />
    <path d="M10 9v4M10 7h.01" />
  </svg>
);

export const IconCode = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M6 5L1 10l5 5M14 5l5 5-5 5" />
  </svg>
);

export const IconWindow = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="2" y="2" width="16" height="16" rx="2" />
    <path d="M2 6.5h16M9 6.5v11.5" />
  </svg>
);

export const IconSettings = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743" />
  </svg>
);

export const IconDragHandle = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 5h14M3 10h14M3 15h14" />
  </svg>
);

export const IconClose = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export const IconGear = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

export const IconDocument = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
    <path d="M12 3v4h4M7 11h6M7 14h4" />
  </svg>
);

export const IconSearch = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M17 17l-3.5-3.5" />
  </svg>
);

export const IconHome = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 10l7-7 7 7M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5" />
  </svg>
);

export const IconWarning = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 3L1.5 17h17L10 3z" />
    <path d="M10 8v4M10 14h.01" />
  </svg>
);

export const IconPlay = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="10" cy="10" r="8" />
    <path d="M8 6.5l6 3.5-6 3.5V6.5z" />
  </svg>
);

export const IconFolder = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M2 5a1 1 0 011-1h4.586a1 1 0 01.707.293L10 6h7a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" />
  </svg>
);

export const IconFlag = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4 17V3M4 3h10l-2 4 2 4H4" />
  </svg>
);
