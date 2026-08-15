/**
 * Shared icon library, in two sets: outline icons (viewBox 0 0 20 20,
 * stroke="currentColor", strokeWidth="1.5", strokeLinecap/join="round",
 * fill="none") and, at the bottom of the file, a filled set
 * (fill="currentColor", no stroke) suffixed `Filled`.
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

export const IconSliders = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 6h2M9 6h8M3 14h8M15 14h2" />
    <circle cx="7" cy="6" r="2" />
    <circle cx="13" cy="14" r="2" />
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

export const IconGauge = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...defaults} className={className}>
    <path d="M3 16a7 7 0 1114 0" />
    <path d="M10 13.5l4-5" />
    <circle cx="10" cy="13.5" r="1" fill="currentColor" stroke="none" />
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

export const IconChevronDownFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className} viewBox="0 0 16 16">
    <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
  </svg>
);

export const IconImageFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M3.5 3C2.67157 3 2 3.67157 2 4.5V15.5C2 16.3284 2.67157 17 3.5 17H16.5C17.3284 17 18 16.3284 18 15.5V4.5C18 3.67157 17.3284 3 16.5 3H3.5ZM3 4.5C3 4.22386 3.22386 4 3.5 4H16.5C16.7761 4 17 4.22386 17 4.5V11.7929L14.8536 9.64645C14.6583 9.45118 14.3417 9.45118 14.1464 9.64645L11 12.7929L8.85355 10.6464C8.65829 10.4512 8.34171 10.4512 8.14645 10.6464L3 15.7929V4.5ZM3.20711 16L8 11.2071L10.1464 13.3536C10.3417 13.5488 10.6583 13.5488 10.8536 13.3536L14 10.2071L17 13.2071V15.5C17 15.7761 16.7761 16 16.5 16H3.5C3.39645 16 3.29871 15.9682 3.20711 16ZM13 7.5C13 8.32843 12.3284 9 11.5 9C10.6716 9 10 8.32843 10 7.5C10 6.67157 10.6716 6 11.5 6C12.3284 6 13 6.67157 13 7.5Z" />
  </svg>
);

export const IconTaskListFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM5.5 4a.5.5 0 0 0-.5.5V6h10V4.5a.5.5 0 0 0-.5-.5h-9ZM15 7H5v8.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7Zm-8 2h6v1H7V9Zm0 2h6v1H7v-1Z" />
  </svg>
);

export const IconEyeFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
    />
  </svg>
);

export const IconMenuFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
    />
  </svg>
);

export const IconGearFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M10.75 2C10.75 1.58579 10.4142 1.25 10 1.25C9.58579 1.25 9.25 1.58579 9.25 2V3.01564C8.37896 3.10701 7.55761 3.36516 6.82036 3.75532L6.06066 2.99563C5.76777 2.70274 5.29289 2.70274 5 2.99563C4.70711 3.28853 4.70711 3.7634 5 4.0563L5.75968 4.81598C5.36953 5.55323 5.11138 6.37458 5.02001 7.24562H4C3.58579 7.24562 3.25 7.58141 3.25 7.99562C3.25 8.40984 3.58579 8.74562 4 8.74562H5.02001C5.11138 9.61667 5.36953 10.438 5.75968 11.1753L5 11.9349C4.70711 12.2278 4.70711 12.7027 5 12.9956C5.29289 13.2885 5.76777 13.2885 6.06066 12.9956L6.82036 12.2359C7.55761 12.6261 8.37896 12.8842 9.25 12.9756V14C9.25 14.4142 9.58579 14.75 10 14.75C10.4142 14.75 10.75 14.4142 10.75 14V12.9756C11.621 12.8842 12.4424 12.6261 13.1796 12.2359L13.9393 12.9956C14.2322 13.2885 14.7071 13.2885 15 12.9956C15.2929 12.7027 15.2929 12.2278 15 11.9349L14.2403 11.1753C14.6305 10.438 14.8886 9.61667 14.98 8.74562H16C16.4142 8.74562 16.75 8.40984 16.75 7.99562C16.75 7.58141 16.4142 7.24562 16 7.24562H14.98C14.8886 6.37458 14.6305 5.55323 14.2403 4.81598L15 4.0563C15.2929 3.7634 15.2929 3.28853 15 2.99563C14.7071 2.70274 14.2322 2.70274 13.9393 2.99563L13.1796 3.75532C12.4424 3.36516 11.621 3.10701 10.75 3.01564V2ZM10 11.4956C8.20507 11.4956 6.75 10.0406 6.75 8.24562C6.75 6.45069 8.20507 4.99562 10 4.99562C11.7949 4.99562 13.25 6.45069 13.25 8.24562C13.25 10.0406 11.7949 11.4956 10 11.4956ZM10 9.99562C11.1046 9.99562 12 9.10019 12 7.99562C12 6.89105 11.1046 5.99562 10 5.99562C8.89543 5.99562 8 6.89105 8 7.99562C8 9.10019 8.89543 9.99562 10 9.99562Z" />
  </svg>
);

export const IconDownloadFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
  </svg>
);

export const IconFullscreenFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M2.5 3C2.22386 3 2 3.22386 2 3.5V8.5C2 8.77614 2.22386 9 2.5 9C2.77614 9 3 8.77614 3 8.5V4.70711L6.64645 8.35355C6.84171 8.54882 7.15829 8.54882 7.35355 8.35355C7.54882 8.15829 7.54882 7.84171 7.35355 7.64645L3.70711 4H7.5C7.77614 4 8 3.77614 8 3.5C8 3.22386 7.77614 3 7.5 3H2.5ZM12 3.5C12 3.22386 12.2239 3 12.5 3H17.5C17.7761 3 18 3.22386 18 3.5V8.5C18 8.77614 17.7761 9 17.5 9C17.2239 9 17 8.77614 17 8.5V4.70711L13.3536 8.35355C13.1583 8.54882 12.8417 8.54882 12.6464 8.35355C12.4512 8.15829 12.4512 7.84171 12.6464 7.64645L16.2929 4H12.5C12.2239 4 12 3.77614 12 3.5ZM2.5 11C2.77614 11 3 11.2239 3 11.5V15.2929L6.64645 11.6464C6.84171 11.4512 7.15829 11.4512 7.35355 11.6464C7.54882 11.8417 7.54882 12.1583 7.35355 12.3536L3.70711 16H7.5C7.77614 16 8 16.2239 8 16.5C8 16.7761 7.77614 17 7.5 17H2.5C2.22386 17 2 16.7761 2 16.5V11.5C2 11.2239 2.22386 11 2.5 11ZM17.5 11C17.7761 11 18 11.2239 18 11.5V16.5C18 16.7761 17.7761 17 17.5 17H12.5C12.2239 17 12 16.7761 12 16.5C12 16.2239 12.2239 16 12.5 16H16.2929L12.6464 12.3536C12.4512 12.1583 12.4512 11.8417 12.6464 11.6464C12.8417 11.4512 13.1583 11.4512 13.3536 11.6464L17 15.2929V11.5C17 11.2239 17.2239 11 17.5 11Z" />
  </svg>
);

export const IconFullscreenExitFilled = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg {...filled} className={className}>
    <path d="M3.5 2C3.22386 2 3 2.22386 3 2.5V7.5C3 7.77614 3.22386 8 3.5 8C3.77614 8 4 7.77614 4 7.5V3.70711L7.14645 6.85355C7.34171 7.04882 7.65829 7.04882 7.85355 6.85355C8.04882 6.65829 8.04882 6.34171 7.85355 6.14645L4.70711 3H8.5C8.77614 3 9 2.77614 9 2.5C9 2.22386 8.77614 2 8.5 2H3.5ZM11 2.5C11 2.22386 11.2239 2 11.5 2H16.5C16.7761 2 17 2.22386 17 2.5V7.5C17 7.77614 16.7761 8 16.5 8C16.2239 8 16 7.77614 16 7.5V3.70711L12.8536 6.85355C12.6583 7.04882 12.3417 7.04882 12.1464 6.85355C11.9512 6.65829 11.9512 6.34171 12.1464 6.14645L15.2929 3H11.5C11.2239 3 11 2.77614 11 2.5ZM3.5 12C3.77614 12 4 12.2239 4 12.5V16.2929L7.14645 13.1464C7.34171 12.9512 7.65829 12.9512 7.85355 13.1464C8.04882 13.3417 8.04882 13.6583 7.85355 13.8536L4.70711 17H8.5C8.77614 17 9 17.2239 9 17.5C9 17.7761 8.77614 18 8.5 18H3.5C3.22386 18 3 17.7761 3 17.5V12.5C3 12.2239 3.22386 12 3.5 12ZM16.5 12C16.7761 12 17 12.2239 17 12.5V17.5C17 17.7761 16.7761 18 16.5 18H11.5C11.2239 18 11 17.7761 11 17.5C11 17.2239 11.2239 17 11.5 17H15.2929L12.1464 13.8536C11.9512 13.6583 11.9512 13.3417 12.1464 13.1464C12.3417 12.9512 12.6583 12.9512 12.8536 13.1464L16 16.2929V12.5C16 12.2239 16.2239 12 16.5 12Z" />
  </svg>
);
