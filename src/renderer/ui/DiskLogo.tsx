import type { ReactElement } from 'react';

/**
 * The Yandex Disk mark. The API terms ask for it on the screens that reach the Disk; it marks the
 * integration only and is never the app's own logo. Trademark of Yandex, see assets/brand/NOTICE.md.
 */
export function DiskLogo({ size = 16 }: { size?: number }): ReactElement {
  return (
    <img
      className="disk-logo"
      src="./yandex-disk.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}
