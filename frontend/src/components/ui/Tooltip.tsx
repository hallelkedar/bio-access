import { cloneElement, useId, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";

type TriggerProps = {
  "aria-describedby"?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
};

/**
 * Short hint above one focusable child, shown on hover and keyboard focus, hidden by Esc.
 * The text stays in the DOM (linked by aria-describedby), so screen readers always get it.
 */
export function Tooltip({ content, children }: { content: string; children: ReactElement<TriggerProps> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const own = children.props;

  const trigger = cloneElement(children, {
    "aria-describedby": [own["aria-describedby"], id].filter(Boolean).join(" "),
    onMouseEnter: (e: MouseEvent) => { own.onMouseEnter?.(e); setOpen(true); },
    onMouseLeave: (e: MouseEvent) => { own.onMouseLeave?.(e); setOpen(false); },
    onFocus: (e: FocusEvent) => { own.onFocus?.(e); setOpen(true); },
    onBlur: (e: FocusEvent) => { own.onBlur?.(e); setOpen(false); },
    onKeyDown: (e: KeyboardEvent) => { own.onKeyDown?.(e); if (e.key === "Escape") setOpen(false); },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      <span id={id} role="tooltip" data-open={open}
        className={`pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-raised transition-opacity duration-150 ${open ? "opacity-100" : "invisible opacity-0"}`}>
        {content}
      </span>
    </span>
  );
}
