import { ExternalLink, GitBranch, ShieldOff, ShieldCheck, UserPlus } from "lucide-react";

const eventIcons = {
  delegation: GitBranch,
  revocation: ShieldOff,
  validation: ShieldCheck,
  registration: UserPlus,
};

const eventColors = {
  delegation: "text-[hsl(199,89%,48%)] bg-[hsl(199,89%,48%)]/10",
  revocation: "text-[hsl(0,72%,51%)] bg-[hsl(0,72%,51%)]/10",
  validation: "text-[hsl(142,76%,36%)] bg-[hsl(142,76%,36%)]/10",
  registration: "text-[hsl(265,89%,65%)] bg-[hsl(265,89%,65%)]/10",
};

export default function ActivityCard({ type, message, txHash, timestamp }) {
  const Icon = eventIcons[type] || GitBranch;
  const colorClass = eventColors[type] || eventColors.delegation;
  const basescanUrl = import.meta.env.VITE_BASESCAN_URL || "https://sepolia.basescan.org";

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl glass hover:bg-white/[0.07] transition-colors group">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timestamp || "Just now"}
        </p>
      </div>
      {txHash && (
        <a
          href={`${basescanUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-[hsl(199,89%,48%)] transition-colors opacity-0 group-hover:opacity-100"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
