import type { ReactElement } from 'react';

/** Small stroke icon set (24×24 grid, currentColor). */
const PATHS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M9 9.5h.01',
  audio:
    'M9 18V6l10-2v12 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  video: 'M3 6h12v12H3z M15 10l6-3v10l-6-3',
  archive: 'M4 4h16v4H4z M5 8h14v12H5z M10 12h4',
  text: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 12h6 M9 15h6 M9 18h3',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-left': 'M19 12H5 M11 18l-6-6 6-6',
  'arrow-right': 'M5 12h14 M13 6l6 6-6 6',
  'arrow-up': 'M12 19V5 M6 11l6-6 6 6',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7 M20 4v5h-5',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  'folder-plus':
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 10v5 M9.5 12.5h5',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  settings:
    'M4 6h9 M19 6h1 M4 12h3 M13 12h7 M4 18h11 M21 18h-1 M16 6a2.5 2.5 0 1 0 0 .01 M10 12a2.5 2.5 0 1 0 0 .01 M18 18a2.5 2.5 0 1 0 0 .01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 10-10',
  cloud: 'M7 18a4 4 0 0 1-.6-7.9A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18z',
  restore: 'M4 12a8 8 0 1 0 2.4-5.7 M4 4v5h5',
  copy: 'M9 9h11v11H9z M5 15V5h10',
  move: 'M4 12h14 M12 6l6 6-6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  sync: 'M4 12a8 8 0 0 1 13.7-5.6L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-13.7 5.6L4 15 M4 20v-5h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 14,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
