"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * The filled part of a progress bar. Its width is set through the CSSOM after
 * rendering, because the Content-Security-Policy blocks inline style
 * attributes in server-rendered HTML.
 */
export default function ProgressFill({ fraction, className }: { fraction: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty("width", `${Math.min(Math.max(fraction, 0), 1) * 100}%`);
  }, [fraction]);
  return <span ref={ref} className={className} />;
}
