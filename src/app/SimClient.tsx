'use client';

import { useEffect, useRef } from 'react';

export default function SimClient() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    // The sim touches window/WebGL, so it only ever loads in the browser.
    import('../sim/sim').then(({ startSim }) => {
      if (!cancelled && ref.current && !ref.current.childElementCount) {
        startSim({ container: ref.current, forceTouch: new URLSearchParams(location.search).has('touch') });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <div ref={ref} className="fixed inset-0" />;
}
