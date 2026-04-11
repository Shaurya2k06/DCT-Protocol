import { ExternalLink, GitBranch, ShieldOff, ShieldCheck, UserPlus } from "lucide-react";

const eventIcons = {
  delegation: GitBranch,
  revocation: ShieldOff,
  validation: ShieldCheck,
  registration: UserPlus,
};

const eventColors = {
  delegation: "text-nb-accent-2 bg-nb-accent-2/15",
  revocation: "text-nb-error bg-nb-error/15",
  validation: "text-nb-ok bg-nb-ok/15",
  registration: "text-purple-600 bg-purple-500/15",
};

export default function ActivityCard({ type, message, txHash, timestamp }) {
  const Icon = eventIcons[type] || GitBranch;
  const colorClass = eventColors[type] || eventColors.delegation;
  const basescanUrl = import.meta.env.VITE_BASESCAN_URL || "https://sepolia.basescan.org";

  return (
    <div className="group flex items-center gap-4 rounded-nb p-4 border-2 border-nb-ink bg-nb-card hover:bg-nb-accent/10 hover:-translate-y-0.5 active:translate-y-0 transition-all">
      <div className={`w-10 h-10 rounded-nb border-2 border-nb-ink flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-display font-semibold truncate text-nb-ink">{message}</p>
        <p className="mt-0.5 text-xs text-nb-ink/50">
          {timestamp || "Just now"}
        </p>
      </div>
      {txHash && (
        <a
          href={`${basescanUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nb-ink/40 hover:text-nb-accent transition-colors opacity-0 group-hover:opacity-100"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
