/**
 * Shared icon library. Every icon is an outline on a 20-unit grid
 * (stroke="currentColor", strokeWidth="1.5", round caps and joins, no fill),
 * so icons from anywhere in the app read as one family. A `Filled` variant
 * exists only where filling marks a state - a slice that has a comment - and
 * never as a second style for the same thing. Sizes are set where used; see
 * docs/ui.md for which size goes where.
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

const filled = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 20 20',
  fill: 'currentColor',
};

export const IconPlus = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const IconCheck = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4 10.5l4 4L16 6" />
  </svg>
);

export const IconPencil = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5zM12 5l3 3" />
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

export const IconChevronDoubleRight = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4.5 5l5 5-5 5M10.5 5l5 5-5 5" />
  </svg>
);

export const IconChevronDoubleLeft = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M15.5 15l-5-5 5-5M9.5 15l-5-5 5-5" />
  </svg>
);

/** The download/upload tray with both arrows: a file going out and coming back in. */
export const IconImportExport = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 12.5v2A2.5 2.5 0 0 0 5.5 17h9a2.5 2.5 0 0 0 2.5-2.5v-2" />
    <path d="M6.5 3v7M4 7.5 6.5 10 9 7.5" />
    <path d="M13.5 10V3M11 5.5 13.5 3 16 5.5" />
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

export const IconWindow = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="2" y="2" width="16" height="16" rx="2" />
    <path d="M2 6.5h16M9 6.5v11.5" />
  </svg>
);

export const IconLayoutGrid = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24" strokeWidth={2}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

export const IconSettings = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743" />
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

/** Bring this up to date: the arrow-path loop. Drawn on the 24-grid it was designed
 *  on, like IconProbe, so the arrowheads keep their shape at header size. */
export const IconRefresh = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
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

export const IconChart = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 17V9M8 17V4M13 17v-5M18 17V7" />
  </svg>
);

/** The timeseries probe: a curve under a magnifier. Shared with the tour, so
 *  the copy can show the control it is talking about rather than describe it. */
export const IconProbe = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M2 15l4-6 4 3 4-7" />
    <circle cx="16" cy="16" r="4" />
    <path d="m19 19 3 3" />
  </svg>
);

export const IconSliders = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 6h2M9 6h8M3 14h8M15 14h2" />
    <circle cx="7" cy="6" r="2" />
    <circle cx="13" cy="14" r="2" />
  </svg>
);

export const IconLock = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="4" y="9" width="12" height="8" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 016 0V9" />
  </svg>
);

export const IconHome = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 9.5L10 3l7 6.5V16a1 1 0 01-1 1h-3.5v-4.5h-5V17H4a1 1 0 01-1-1V9.5z" />
  </svg>
);

export const IconUsers = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <circle cx="7.5" cy="7" r="2.75" />
    <path d="M2.5 16c.6-2.6 2.6-4 5-4s4.4 1.4 5 4M13 4.5a2.5 2.5 0 010 5M14.5 12c1.6.4 2.7 1.7 3 4" />
  </svg>
);

export const IconOverview = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="11" y="3" width="6" height="6" rx="1" />
    <rect x="3" y="11" width="6" height="6" rx="1" />
    <rect x="11" y="11" width="6" height="6" rx="1" />
  </svg>
);

export const IconShield = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 2.5L4 5v4.5c0 3.8 2.6 6.9 6 8 3.4-1.1 6-4.2 6-8V5l-6-2.5z" />
  </svg>
);

export const IconRobot = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="4" y="6" width="12" height="10" rx="2" />
    <path d="M10 3v3M7.5 10.5h.01M12.5 10.5h.01M8 13.5h4" />
  </svg>
);

export const IconSignOut = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3M12 6.5l3.5 3.5-3.5 3.5M15.5 10H8" />
  </svg>
);

export const IconSelector = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M7 8l3-3 3 3M7 12l3 3 3-3" />
  </svg>
);

export const IconBuilding = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4 17V4a1 1 0 011-1h7a1 1 0 011 1v13M13 8h2a1 1 0 011 1v8M2.5 17h15" />
    <path d="M7 6h1M9.5 6h1M7 9h1M9.5 9h1M7 12h1M9.5 12h1M8 17v-2.5h1.5V17" />
  </svg>
);

export const IconCopy = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="7" y="7" width="9" height="9" rx="1.5" />
    <path d="M13 7V5.5A1.5 1.5 0 0011.5 4h-6A1.5 1.5 0 004 5.5v6A1.5 1.5 0 005.5 13H7" />
  </svg>
);

export const IconExternalLink = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M9 5H6a2 2 0 00-2 2v7a2 2 0 002 2h7a2 2 0 002-2v-3" />
    <path d="M12 4h4v4M16 4l-6.5 6.5" />
  </svg>
);

export const IconQuestion = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const IconBook = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} viewBox="0 0 24 24">
    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
    <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
  </svg>
);

export const IconKeyboard = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className} strokeWidth={1.2} strokeLinecap="butt">
    <rect x="2" y="5" width="16" height="11" rx="2" />
    <line x1="5" y1="8.5" x2="7" y2="8.5" />
    <line x1="9" y1="8.5" x2="11" y2="8.5" />
    <line x1="13" y1="8.5" x2="15" y2="8.5" />
    <line x1="5" y1="11.5" x2="7" y2="11.5" />
    <line x1="9" y1="11.5" x2="11" y2="11.5" />
    <line x1="13" y1="11.5" x2="15" y2="11.5" />
    <line x1="7" y1="14" x2="13" y2="14" />
  </svg>
);

export const IconComment = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M4 4h12a1 1 0 011 1v7a1 1 0 01-1 1H8l-4 3v-3a1 1 0 01-1-1V5a1 1 0 011-1Z" />
  </svg>
);

export const IconCommentFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M4 3.5h12A1.5 1.5 0 0 1 17.5 5v7a1.5 1.5 0 0 1-1.5 1.5H8.4l-3.6 2.7A.5.5 0 0 1 4 15.8v-2.3A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z" />
  </svg>
);

export const IconImage = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <path d="M3 13.5l4-4 3 3 2-2 5 5" />
    <circle cx="13" cy="7.5" r="1.25" />
  </svg>
);

export const IconFilter = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 4.5h14l-5.5 6.5v4.25L8.5 16.5V11L3 4.5z" />
  </svg>
);

export const IconTaskList = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M8.5 6h8M8.5 10h8M8.5 14h8" />
    <path d="M3.5 6l1 1 1.75-2M3.5 10l1 1 1.75-2M3.5 14l1 1 1.75-2" />
  </svg>
);

export const IconEye = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
    <circle cx="10" cy="10" r="2.5" />
  </svg>
);

export const IconDownload = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 3v9.5M6 8.5l4 4 4-4" />
    <path d="M3.5 13v2A1.5 1.5 0 005 16.5h10a1.5 1.5 0 001.5-1.5v-2" />
  </svg>
);

/** The download glyph with the arrow reversed: same tray, pointing in. */
export const IconUpload = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M10 12.5V3M6 7l4-4 4 4" />
    <path d="M3.5 13v2A1.5 1.5 0 005 16.5h10a1.5 1.5 0 001.5-1.5v-2" />
  </svg>
);

export const IconFullscreen = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5" />
  </svg>
);

export const IconFullscreenExit = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M7.5 3v4.5H3M17 7.5h-4.5V3M12.5 17v-4.5H17M3 12.5h4.5V17" />
  </svg>
);
