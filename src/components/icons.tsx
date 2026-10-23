/** 内联 SVG 图标，避免引入图标库 */

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const Plus = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Play = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
);

export const Stop = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const ChevronUp = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

export const ChevronDown = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const Search = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.5-4.5" />
  </svg>
);

export const Folder = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const Swap = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);

export const Warn = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v5M12 17.5v.5" />
  </svg>
);

export const Info = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </svg>
);
