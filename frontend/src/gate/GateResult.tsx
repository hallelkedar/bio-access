/** Text sizes: "full" for the real gate's full-screen overlay, "card" for small previews. */
const SIZES = {
  full: { icon: "text-7xl", message: "mt-4 text-5xl", name: "mt-3 text-3xl" },
  card: { icon: "text-5xl", message: "mt-2 text-2xl", name: "mt-1 text-lg" },
} as const;

/** The big ✓/✕, the message and the holder's name. Presentational only; the caller picks the frame. */
export function GateResult({ approved, message, name, size = "full" }: {
  approved: boolean;
  message: string;
  name?: string | null;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  return (
    <>
      <p className={`${s.icon} font-black`}>{approved ? "✓" : "✕"}</p>
      <p className={`${s.message} font-bold`}>{message}</p>
      {name && <p className={s.name}>{name}</p>}
    </>
  );
}
