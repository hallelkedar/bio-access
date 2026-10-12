import type { ReactNode } from "react";

import { LogoMark } from "../components/LogoMark";
import { Card } from "../components/ui";

/** The centered card shared by Login and Register. `shake` replays a short shake (failed login). */
export function AuthCard({ title, subtitle, footer, shake = false, onShakeEnd, children }: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  shake?: boolean;
  onShakeEnd?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex justify-center py-6 sm:py-10">
      <Card className={`w-full max-w-md px-6 py-8 sm:px-8 ${shake ? "animate-shake" : ""}`}
        onAnimationEnd={(e) => e.target === e.currentTarget && onShakeEnd?.()}>
        <LogoMark className="mx-auto h-11 w-11" />
        <h1 className="mt-4 text-center text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>
        {children}
        <p className="mt-6 border-t border-border pt-4 text-center text-sm text-muted">{footer}</p>
      </Card>
    </section>
  );
}

export const AUTH_LINK =
  "rounded font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";
