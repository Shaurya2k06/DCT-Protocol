import { Activity } from "lucide-react";

export default function Header({ title, subtitle }) {
  return (
    <header className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="glass px-4 py-2 rounded-xl flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4 text-[hsl(142,76%,36%)]" />
          <span className="text-muted-foreground">Network:</span>
          <span className="font-medium text-[hsl(199,89%,48%)]">Base Sepolia</span>
        </div>
      </div>
    </header>
  );
}
