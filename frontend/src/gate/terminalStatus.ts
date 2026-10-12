import type { ScannerState } from "../hooks/useGateScanner";
import type { TranslationKey } from "../i18n/en";

export type TerminalStatus = "providerDown" | "paused" | "approved" | "denied" | "verifying" | "watching";

/**
 * What the gate's status chip says. A face service outage wins over everything (the
 * operator must know to use QR), then a pause (by the operator or a rate limit), then
 * the result on screen, then the scanner's own phase.
 */
export function terminalStatus(state: Pick<ScannerState, "phase" | "decision" | "providerDown">, paused: boolean): TerminalStatus {
  if (state.providerDown) return "providerDown";
  if (paused || state.phase === "paused") return "paused";
  if (state.phase === "result" && state.decision) return state.decision.result === "APPROVED" ? "approved" : "denied";
  if (state.phase === "verifying") return "verifying";
  return "watching";
}

export const STATUS_STYLE: Record<TerminalStatus, { key: TranslationKey; dot: string; chip: string }> = {
  providerDown: { key: "gate.status.providerDown", dot: "bg-rose-400 animate-pulse", chip: "bg-rose-500/15 text-rose-200 ring-rose-400/40" },
  paused: { key: "gate.paused", dot: "bg-slate-400", chip: "bg-slate-500/15 text-slate-200 ring-slate-400/30" },
  approved: { key: "gate.status.approved", dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40" },
  denied: { key: "gate.status.denied", dot: "bg-rose-400", chip: "bg-rose-500/15 text-rose-200 ring-rose-400/40" },
  verifying: { key: "gate.status.verifying", dot: "bg-amber-400 animate-pulse", chip: "bg-amber-500/15 text-amber-200 ring-amber-400/40" },
  watching: { key: "gate.status.watching", dot: "bg-accent-400 animate-pulse", chip: "bg-accent-500/10 text-accent-200 ring-accent-400/30" },
};
