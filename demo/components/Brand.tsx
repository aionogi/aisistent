export default function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand${light ? " brand-light" : ""}`}>
      <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M8 24V14a5 5 0 0 1 10 0v10a5 5 0 0 0 10 0V12" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      </svg>
      aisistent<span className="brand-dot">.</span>
    </span>
  );
}
