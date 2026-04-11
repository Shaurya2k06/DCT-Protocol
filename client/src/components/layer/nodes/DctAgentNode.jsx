import { Handle, Position } from "@xyflow/react";

/**
 * One agent in the delegation workflow — limits mirror DCT scope fields.
 */
export default function DctAgentNode({ data, selected }) {
  const spend = Number(data?.spendLimitUsdc ?? 0);
  const usd = spend >= 1e6 ? (spend / 1e6).toFixed(2) : String(spend);

  return (
    <div
      className={`rounded-xl border bg-[hsl(222,47%,8%)] px-3 py-2.5 min-w-[200px] max-w-[240px] shadow-md ${
        selected ? "border-[hsl(199,89%,48%)] ring-2 ring-[hsl(199,89%,48%)]/25" : "border-white/15"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-500 !border-0" />
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Agent</p>
      <p className="text-sm font-semibold truncate" title={data?.title}>
        {data?.title || "Untitled agent"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground font-mono">
        <span className="rounded bg-white/5 px-1.5 py-0.5">${usd} cap</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5">depth ≤{data?.maxDepth ?? 3}</span>
      </div>
      <p className="mt-1 text-[9px] text-zinc-500 truncate" title={data?.allowedTools}>
        {(data?.allowedTools || "tools…").slice(0, 42)}
        {(data?.allowedTools || "").length > 42 ? "…" : ""}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !border-0" />
    </div>
  );
}
