import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitBranch, ShieldOff, ShieldCheck, Plus, Loader2,
  Zap, AlertTriangle,
} from "lucide-react";
import Header from "../components/layout/Header";
import { getDelegationTree, registerDelegation, revokeDelegation, getAgents } from "../lib/api";
import { ethers } from "ethers";

// Custom node component for the delegation tree
function AgentNode({ data }) {
  const isRevoked = data.isRevoked;
  const trustPct = Math.min((parseFloat(data.trustScore || "1") / 2) * 100, 100);

  const borderColor = isRevoked
    ? "border-[hsl(0,72%,51%)]/50"
    : "border-[hsl(142,76%,36%)]/30";
  const glowClass = isRevoked ? "glow-red" : "glow-green";

  return (
    <div
      className={`glass rounded-xl p-4 min-w-[200px] border ${borderColor} ${glowClass} ${
        isRevoked ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
            isRevoked
              ? "bg-[hsl(0,72%,51%)]/20 text-[hsl(0,72%,51%)]"
              : "bg-[hsl(142,76%,36%)]/20 text-[hsl(142,76%,36%)]"
          }`}
        >
          {isRevoked ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
        </div>
        <div>
          <p className="text-xs font-semibold">Agent #{data.agentId}</p>
          <p className={`text-[10px] font-medium ${isRevoked ? "text-[hsl(0,72%,51%)]" : "text-[hsl(142,76%,36%)]"}`}>
            {isRevoked ? "REVOKED" : "ACTIVE"}
          </p>
        </div>
      </div>

      {/* Trust bar */}
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
          <span>Trust</span>
          <span>{parseFloat(data.trustScore || "1").toFixed(2)}</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isRevoked
                ? "bg-[hsl(0,72%,51%)]"
                : trustPct > 60
                ? "bg-[hsl(142,76%,36%)]"
                : "bg-[hsl(38,92%,50%)]"
            }`}
            style={{ width: `${trustPct}%` }}
          />
        </div>
      </div>

      {/* Token ID (truncated) */}
      <p className="text-[9px] font-mono text-muted-foreground mt-2 truncate">
        {data.nodeId?.substring(0, 18)}...
      </p>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

export default function Delegations() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showRevokeForm, setShowRevokeForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txResult, setTxResult] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    parentAgentTokenId: "0",
    allowedTools: "web_fetch",
    spendLimitUsdc: "10000000",
    maxDepth: "3",
  });
  const [revokeData, setRevokeData] = useState({
    tokenId: "",
    agentTokenId: "0",
  });

  useEffect(() => {
    fetchTree();
    getAgents()
      .then((d) => setAgents(d.agents))
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial fetch
  }, []);

  async function fetchTree() {
    try {
      const data = await getDelegationTree();
      if (data.nodes.length === 0) {
        setNodes([]);
        setEdges([]);
        setLoading(false);
        return;
      }

      // Build tree layout
      const nodeMap = {};
      data.nodes.forEach((n) => {
        nodeMap[n.id] = n;
      });

      // Find root nodes (parentId = 0x0000...)
      const roots = data.nodes.filter(
        (n) => n.parentId === ethers.ZeroHash
      );

      // Position nodes in a tree layout
      const flowNodes = [];
      const flowEdges = [];

      function layoutNode(node, x, y, depth) {
        flowNodes.push({
          id: node.id,
          type: "agentNode",
          position: { x, y },
          data: {
            agentId: node.agentId,
            isRevoked: node.isRevoked,
            trustScore: node.trustScore,
            nodeId: node.id,
          },
        });

        // Find children of this node
        const nodeChildren = data.nodes.filter((n) => n.parentId === node.id);
        const childWidth = 280;
        const startX = x - ((nodeChildren.length - 1) * childWidth) / 2;

        nodeChildren.forEach((child, i) => {
          flowEdges.push({
            id: `${node.id}-${child.id}`,
            source: node.id,
            target: child.id,
            type: "smoothstep",
            animated: !child.isRevoked,
            style: {
              stroke: child.isRevoked ? "hsl(0, 72%, 51%)" : "hsl(199, 89%, 48%)",
              strokeWidth: 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: child.isRevoked ? "hsl(0, 72%, 51%)" : "hsl(199, 89%, 48%)",
            },
          });
          layoutNode(child, startX + i * childWidth, y + 160, depth + 1);
        });
      }

      roots.forEach((root, i) => {
        layoutNode(root, i * 400 + 200, 50, 0);
      });

      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      console.error("Error fetching tree:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setSubmitting(true);
    setTxResult(null);
    try {
      // Generate a unique childId
      const childId = ethers.keccak256(
        ethers.toUtf8Bytes(`dct-${Date.now()}-${Math.random()}`)
      );

      const result = await registerDelegation({
        parentId: ethers.ZeroHash, // root delegation
        childId,
        allowedTools: formData.allowedTools.split(",").map((t) => t.trim()),
        spendLimitUsdc: formData.spendLimitUsdc,
        maxDepth: parseInt(formData.maxDepth),
        parentAgentTokenId: formData.parentAgentTokenId,
      });

      setTxResult({ type: "success", ...result });
      setShowForm(false);
      await fetchTree();
    } catch (err) {
      setTxResult({ type: "error", error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(e) {
    e.preventDefault();
    setSubmitting(true);
    setTxResult(null);
    try {
      const result = await revokeDelegation(
        revokeData.tokenId,
        revokeData.agentTokenId
      );
      setTxResult({ type: "success", ...result });
      setShowRevokeForm(false);
      await fetchTree();
    } catch (err) {
      setTxResult({ type: "error", error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  const basescanUrl = import.meta.env.VITE_BASESCAN_URL || "https://sepolia.basescan.org";

  return (
    <div className="space-y-6">
      <Header
        title="Delegation Tree"
        subtitle="Interactive visualization of the DCT lineage — lazy revocation cascades in real-time"
      />

      {/* Action Bar */}
      <div className="flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setShowForm(!showForm); setShowRevokeForm(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Register Delegation
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setShowRevokeForm(!showRevokeForm); setShowForm(false); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,51%)] border border-[hsl(0,72%,51%)]/20 text-sm font-medium"
        >
          <ShieldOff className="w-4 h-4" />
          Revoke Token
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={fetchTree}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass text-sm font-medium"
        >
          <Zap className="w-4 h-4 text-[hsl(38,92%,50%)]" />
          Refresh
        </motion.button>
      </div>

      {/* Tx Result */}
      <AnimatePresence>
        {txResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-4 rounded-xl ${
              txResult.type === "success"
                ? "bg-[hsl(142,76%,36%)]/10 border border-[hsl(142,76%,36%)]/20"
                : "bg-[hsl(0,72%,51%)]/10 border border-[hsl(0,72%,51%)]/20"
            }`}
          >
            {txResult.type === "success" ? (
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-[hsl(142,76%,36%)]" />
                <span className="text-[hsl(142,76%,36%)]">Transaction successful!</span>
                {txResult.txHash && (
                  <a
                    href={`${basescanUrl}/tx/${txResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[hsl(199,89%,48%)] font-mono text-xs underline ml-2"
                  >
                    {txResult.txHash.substring(0, 18)}...
                  </a>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[hsl(0,72%,51%)]">
                <AlertTriangle className="w-4 h-4" />
                {txResult.error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Register Form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleRegister}
            className="glass rounded-2xl p-6 border-gradient overflow-hidden space-y-4"
          >
            <h3 className="text-sm font-semibold">Register Root Delegation</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Agent Token ID</label>
                <select
                  value={formData.parentAgentTokenId}
                  onChange={(e) => setFormData({ ...formData, parentAgentTokenId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(199,89%,48%)]/50"
                >
                  {agents.map((a) => (
                    <option key={a.tokenId} value={a.tokenId} className="bg-[hsl(222,47%,8%)]">
                      Agent #{a.tokenId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Allowed Tools</label>
                <input
                  type="text"
                  value={formData.allowedTools}
                  onChange={(e) => setFormData({ ...formData, allowedTools: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(199,89%,48%)]/50"
                  placeholder="web_fetch, research"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Spend Limit (USDC, 6 dec)</label>
                <input
                  type="text"
                  value={formData.spendLimitUsdc}
                  onChange={(e) => setFormData({ ...formData, spendLimitUsdc: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(199,89%,48%)]/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Max Depth</label>
                <input
                  type="number"
                  value={formData.maxDepth}
                  onChange={(e) => setFormData({ ...formData, maxDepth: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(199,89%,48%)]/50"
                  min="1"
                  max="8"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-[hsl(199,89%,48%)] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Registering..." : "Register On-Chain"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Revoke Form */}
      <AnimatePresence>
        {showRevokeForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleRevoke}
            className="glass rounded-2xl p-6 border border-[hsl(0,72%,51%)]/20 overflow-hidden space-y-4"
          >
            <h3 className="text-sm font-semibold text-[hsl(0,72%,51%)]">Revoke Delegation Token</h3>
            <p className="text-xs text-muted-foreground">
              O(1) on-chain write — all downstream children fail isRevoked() lazily at execution time.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Token Revocation ID</label>
                <input
                  type="text"
                  value={revokeData.tokenId}
                  onChange={(e) => setRevokeData({ ...revokeData, tokenId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(0,72%,51%)]/50"
                  placeholder="0x..."
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Agent Token ID</label>
                <select
                  value={revokeData.agentTokenId}
                  onChange={(e) => setRevokeData({ ...revokeData, agentTokenId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(0,72%,51%)]/50"
                >
                  {agents.map((a) => (
                    <option key={a.tokenId} value={a.tokenId} className="bg-[hsl(222,47%,8%)]">
                      Agent #{a.tokenId}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-[hsl(0,72%,51%)] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Revoking..." : "Revoke — O(1) Gas"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Delegation Tree Visualization */}
      <div className="glass rounded-2xl overflow-hidden border-gradient" style={{ height: "500px" }}>
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[hsl(199,89%,48%)]" />
              <p className="text-sm text-muted-foreground">Loading delegation tree...</p>
            </div>
          </div>
        ) : nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            className="bg-transparent"
          >
            <Background color="hsl(199, 89%, 48%)" gap={40} size={1} style={{ opacity: 0.06 }} />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <GitBranch className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-lg font-medium text-muted-foreground">No delegations yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Register a delegation or run the demo to see the lineage tree
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
