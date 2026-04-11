import { Activity } from "lucide-react";

export default function Header({ title, subtitle }) {
  return (
    <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-nb-ink">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-nb-ink/60">{subtitle}</p>
        )}
      </div>
      <div className="nb-pill-accent">
        <Activity className="h-4 w-4 text-nb-ink" />
        <span className="text-nb-ink/60">Network:</span>
        <span className="font-bold text-nb-ink">Base Sepolia</span>
      </div>
    </header>
  );
}
