import { Handle, Position } from "@xyflow/react";

/**
 * Workflow entry — conceptually maps to your OpenClaw / gateway entrypoint.
 */
export default function DctStartNode({ data, selected }) {
  return (
    <div
      className={`rounded-xl border bg-gradient-to-br from-[hsl(199,89%,48%)]/20 to-[hsl(265,89%,65%)]/10 px-4 py-3 min-w-[200px] shadow-lg ${
        selected ? "border-[hsl(199,89%,48%)] ring-2 ring-[hsl(199,89%,48%)]/30" : "border-white/20"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry</p>
      <p className="text-sm font-semibold text-foreground">{data?.label || "OpenClaw root"}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400 !border-0" />
    </div>
  );
}
