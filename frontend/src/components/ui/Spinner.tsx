const SIZES = { sm: "h-4 w-4 border-2", md: "h-5 w-5 border-2", lg: "h-8 w-8 border-[3px]" } as const;

export function Spinner({ label, size = "md", className = "" }: { label?: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-3 text-muted ${className}`}>
      <span className={`${SIZES[size]} animate-spin rounded-full border-current border-t-transparent opacity-70`} aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
