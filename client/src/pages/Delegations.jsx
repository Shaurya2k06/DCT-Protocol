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

  return (
    <div
      className={`bg-nb-card rounded-nb p-4 min-w-[200px] border-2 border-nb-ink ${
        isRevoked ? "opacity-60 shadow-[4px_4px_0_0_rgba(239,68,68,0.9)]" : "shadow-nb-sm"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-8 h-8 rounded-nb border-2 border-nb-ink flex items-center justify-center text-sm ${
            isRevoked
              ? "bg-nb-error/20 text-nb-error"
              : "bg-nb-ok/20 text-nb-ok"
          }`}
        >
          {isRevoked ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
        </div>
        <div>
          <p className="text-xs font-display font-bold text-nb-ink">Agent #{data.agentId}</p>
          <p className={`text-[10px] font-display font-bold ${isRevoked ? "text-nb-error" : "text-nb-ok"}`}>
            {isRevoked ? "REVOKED" : "ACTIVE"}
          </p>
        </div>
      </div>

      {/* Trust bar */}
      <div className="mt-2">
        <div className="flex justify-between text-[10px] font-display font-semibold text-nb-ink/60 mb-0.5">
          <span>Trust</span>
          <span>{parseFloat(data.trustScore || "1").toFixed(2)}</span>
        </div>
        <div className="w-full h-2 rounded-full bg-nb-bg border border-nb-ink overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              isRevoked
                ? "bg-nb-error"
                : trustPct > 60
                ? "bg-nb-ok"
                : "bg-nb-warn"
            }`}
            style={{ width: `${trustPct}%` }}
          />
        </div>
      </div>

      {/* Token ID (truncated) */}
      <p className="text-[9px] font-mono text-nb-ink/40 mt-2 truncate">
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
              stroke: child.isRevoked ? "#EF4444" : "#60A5FA",
              strokeWidth: 2.5,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: child.isRevoked ? "#EF4444" : "#60A5FA",
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
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
          onClick={() => { setShowForm(!showForm); setShowRevokeForm(false); }}
          className="nb-btn-primary"
        >
          <Plus className="w-4 h-4" />
          Register Delegation
        </motion.button>
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
          onClick={() => { setShowRevokeForm(!showRevokeForm); setShowForm(false); }}
          className="nb-btn-danger"
        >
          <ShieldOff className="w-4 h-4" />
          Revoke Token
        </motion.button>
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
          onClick={fetchTree}
          className="nb-btn-ghost"
        >
          <Zap className="w-4 h-4 text-nb-warn" />
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
            className={`p-4 rounded-nb border-2 border-nb-ink ${
              txResult.type === "success"
                ? "bg-nb-ok/10"
                : "bg-nb-error/10"
            }`}
          >
            {txResult.type === "success" ? (
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-nb-ok" />
                <span className="text-nb-ok font-display font-bold">Transaction successful!</span>
                {txResult.txHash && (
                  <a
                    href={`${basescanUrl}/tx/${txResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-nb-accent-2 font-mono text-xs underline ml-2"
                  >
                    {txResult.txHash.substring(0, 18)}...
                  </a>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-nb-error">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-display font-bold">{txResult.error}</span>
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
            className="nb-card overflow-hidden space-y-4"
          >
            <h3 className="text-sm font-display font-bold text-nb-ink">Register Root Delegation</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Agent Token ID</label>
                <select
                  value={formData.parentAgentTokenId}
                  onChange={(e) => setFormData({ ...formData, parentAgentTokenId: e.target.value })}
                  className="nb-select"
                >
                  {agents.map((a) => (
                    <option key={a.tokenId} value={a.tokenId}>
                      Agent #{a.tokenId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Allowed Tools</label>
                <input
                  type="text"
                  value={formData.allowedTools}
                  onChange={(e) => setFormData({ ...formData, allowedTools: e.target.value })}
                  className="nb-input"
                  placeholder="web_fetch, research"
                />
              </div>
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Spend Limit (USDC, 6 dec)</label>
                <input
                  type="text"
                  value={formData.spendLimitUsdc}
                  onChange={(e) => setFormData({ ...formData, spendLimitUsdc: e.target.value })}
                  className="nb-input"
                />
              </div>
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Max Depth</label>
                <input
                  type="number"
                  value={formData.maxDepth}
                  onChange={(e) => setFormData({ ...formData, maxDepth: e.target.value })}
                  className="nb-input"
                  min="1"
                  max="8"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="nb-btn-secondary disabled:opacity-50"
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
            className="nb-card overflow-hidden space-y-4 !border-nb-error"
          >
            <h3 className="text-sm font-display font-bold text-nb-error">Revoke Delegation Token</h3>
            <p className="text-xs text-nb-ink/60">
              O(1) on-chain write — all downstream children fail isRevoked() lazily at execution time.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Token Revocation ID</label>
                <input
                  type="text"
                  value={revokeData.tokenId}
                  onChange={(e) => setRevokeData({ ...revokeData, tokenId: e.target.value })}
                  className="nb-input"
                  placeholder="0x..."
                />
              </div>
              <div>
                <label className="text-xs font-display font-semibold text-nb-ink/60 mb-1 block">Agent Token ID</label>
                <select
                  value={revokeData.agentTokenId}
                  onChange={(e) => setRevokeData({ ...revokeData, agentTokenId: e.target.value })}
                  className="nb-select"
                >
                  {agents.map((a) => (
                    <option key={a.tokenId} value={a.tokenId}>
                      Agent #{a.tokenId}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="nb-btn-danger disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Revoking..." : "Revoke — O(1) Gas"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Delegation Tree Visualization */}
      <div className="nb-card overflow-hidden" style={{ height: "500px" }}>
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-nb-accent-2" />
              <p className="text-sm font-display font-semibold text-nb-ink/60">Loading delegation tree...</p>
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
            <Background color="#111" gap={40} size={1} style={{ opacity: 0.04 }} />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <GitBranch className="w-16 h-16 mx-auto mb-4 text-nb-ink/20" />
              <p className="text-lg font-display font-bold text-nb-ink/50">No delegations yet</p>
              <p className="text-sm text-nb-ink/40 mt-1">
                Register a delegation or run the demo to see the lineage tree
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
