import { Handle, Position } from "@xyflow/react";

/**
 * Workflow entry — conceptually maps to your OpenClaw / gateway entrypoint.
 */
export default function DctStartNode({ data, selected }) {
  return (
    <div
      className={`min-w-[200px] rounded-xl border bg-gradient-to-br from-stone-100 to-stone-50 px-4 py-3 shadow-sm ${
        selected ? "border-stone-700 ring-2 ring-stone-400/30" : "border-stone-200"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-stone-500">Entry</p>
      <p className="text-sm font-semibold text-stone-900">{data?.label || "OpenClaw root"}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-stone-700 !border-0" />
    </div>
  );
}
