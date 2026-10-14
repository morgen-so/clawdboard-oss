/** The sound toggle's icon, shared by the streak takeovers. */
export function SpeakerIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block h-3 w-3 align-[-1px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M11 6l4 4M15 6l-4 4" strokeLinecap="round" />
      ) : (
        <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9" strokeLinecap="round" />
      )}
    </svg>
  );
}
