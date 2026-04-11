import { Handle, Position } from "@xyflow/react";

/**
 * One agent in the delegation workflow — limits mirror DCT scope fields.
 */
export default function DctAgentNode({ data, selected }) {
  const spend = Number(data?.spendLimitUsdc ?? 0);
  const usd = spend >= 1e6 ? (spend / 1e6).toFixed(2) : String(spend);

  return (
    <div
      className={`min-w-[200px] max-w-[240px] rounded-xl border bg-white px-3 py-2.5 shadow-sm ${
        selected ? "border-stone-700 ring-2 ring-stone-400/25" : "border-stone-200"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-stone-500 !border-0" />
      <p className="text-[10px] uppercase tracking-wide text-stone-500">Agent</p>
      <p className="truncate text-sm font-semibold text-stone-900" title={data?.title}>
        {data?.title || "Untitled agent"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[10px] text-stone-600">
        <span className="rounded bg-stone-100 px-1.5 py-0.5">${usd} cap</span>
        <span className="rounded bg-stone-100 px-1.5 py-0.5">depth {"<="} {data?.maxDepth ?? 3}</span>
      </div>
      <p className="mt-1 truncate text-[9px] text-stone-500" title={data?.allowedTools}>
        {(data?.allowedTools || "tools…").slice(0, 42)}
        {(data?.allowedTools || "").length > 42 ? "…" : ""}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-600 !border-0" />
    </div>
  );
}
