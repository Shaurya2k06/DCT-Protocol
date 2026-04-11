import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, GitBranch, ShieldOff, TrendingUp, Zap, Shield } from "lucide-react";
import Header from "../components/layout/Header";
import StatCard from "../components/cards/StatCard";
import ActivityCard from "../components/cards/ActivityCard";
import { getAgents, getDelegationTree, healthCheck } from "../lib/api";

export default function Dashboard() {
  const [chainBanner, setChainBanner] = useState(null);
  const [stats, setStats] = useState({
    agents: 0,
    delegations: 0,
    revocations: 0,
    avgTrust: "1.00",
  });
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    healthCheck()
      .then((h) =>
        setChainBanner(
          h.chainId != null && h.network
            ? `${h.network} · chain ${h.chainId}`
            : null
        )
      )
      .catch(() => setChainBanner(null));
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [agentData, treeData] = await Promise.all([
          getAgents().catch(() => ({ agents: [], total: 0 })),
          getDelegationTree().catch(() => ({ nodes: [], edges: [], total: 0 })),
        ]);

        const revokedCount = treeData.nodes.filter((n) => n.isRevoked).length;
        const trustScores = agentData.agents
          .map((a) => parseFloat(a.trustScore))
          .filter((t) => t > 0);
        const avgTrust =
          trustScores.length > 0
            ? (trustScores.reduce((a, b) => a + b, 0) / trustScores.length).toFixed(2)
            : "1.00";

        setStats({
          agents: agentData.total,
          delegations: treeData.total,
          revocations: revokedCount,
          avgTrust,
        });

        // Build activity feed from delegation nodes
        const acts = treeData.nodes.slice(0, 8).map((node, i) => ({
          type: node.isRevoked ? "revocation" : "delegation",
          message: node.isRevoked
            ? `Agent #${node.agentId} delegation revoked`
            : `Agent #${node.agentId} delegation registered`,
          timestamp: "On-chain",
          key: i,
        }));
        setActivities(acts);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="space-y-8">
      <Header
        title="Dashboard"
        subtitle={
          chainBanner
            ? `DCT Protocol — ${chainBanner}`
            : "DCT Protocol — Delegated Capability Tokens"
        }
      />

      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden nb-card bg-nb-accent"
      >
        <div className="relative z-10 flex items-center gap-6">
          <div className="w-16 h-16 rounded-nb border-2 border-nb-ink bg-nb-ink flex items-center justify-center shadow-nb-sm">
            <Shield className="w-8 h-8 text-nb-accent" />
          </div>
          <div>
            <h2 className="text-2xl font-display font-bold text-nb-ink">
              Verifiable, Cascading, Trust-Aware Authority
            </h2>
            <p className="text-nb-ink/70 mt-1 max-w-2xl font-body">
              Cryptographic delegation for autonomous multi-agent systems.
              Authority only narrows. Revocation is lazy and O(1). No trusted intermediary.
            </p>
          </div>
        </div>
        {/* Decorative corner elements */}
        <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full border-[3px] border-nb-ink bg-nb-accent-2/30" />
        <div className="absolute right-8 -bottom-6 w-14 h-14 rounded-full border-[3px] border-nb-ink bg-nb-warn/30" />
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="ERC-8004 Agents"
          value={loading ? "—" : stats.agents}
          subtext="Registered identities"
          color="blue"
          delay={1}
        />
        <StatCard
          icon={GitBranch}
          label="Active Delegations"
          value={loading ? "—" : stats.delegations}
          subtext="Lineage tree nodes"
          color="purple"
          delay={2}
        />
        <StatCard
          icon={ShieldOff}
          label="Revocations"
          value={loading ? "—" : stats.revocations}
          subtext="Cascade invalidated"
          color="red"
          delay={3}
        />
        <StatCard
          icon={TrendingUp}
          label="Avg Trust Score"
          value={loading ? "—" : stats.avgTrust}
          subtext="BASE_TRUST = 1.00"
          color="green"
          delay={4}
        />
      </div>

      {/* Architecture & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Protocol Layers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="nb-card"
        >
          <h3 className="text-lg font-display font-bold mb-4 flex items-center gap-2 text-nb-ink">
            <Zap className="w-5 h-5 text-nb-warn" />
            Protocol Stack
          </h3>
          <div className="space-y-3">
            {[
              { layer: "L1", name: "Eclipse Biscuit", desc: "Off-chain token — offline attenuation", bg: "bg-nb-accent-2" },
              { layer: "L2", name: "DCTRegistry.sol", desc: "On-chain lineage tree + lazy revocation", bg: "bg-purple-500" },
              { layer: "L3", name: "DCTEnforcer.sol", desc: "ERC-7710 caveat enforcer", bg: "bg-nb-warn" },
              { layer: "L4", name: "TLSNotary", desc: "MPC-TLS action verification (Rust)", bg: "bg-nb-ok" },
              { layer: "L5", name: "ERC-8004", desc: "Agent identity — NFT registry", bg: "bg-nb-error" },
            ].map((item, i) => (
              <motion.div
                key={item.layer}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-4 p-3 rounded-nb border-2 border-nb-ink hover:bg-nb-accent/10 hover:-translate-y-0.5 active:translate-y-0 transition-all"
              >
                <div className={`w-10 h-10 rounded-nb border-2 border-nb-ink ${item.bg} flex items-center justify-center text-xs font-display font-bold text-white shrink-0`}>
                  {item.layer}
                </div>
                <div>
                  <p className="text-sm font-display font-bold text-nb-ink">{item.name}</p>
                  <p className="text-xs text-nb-ink/60">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Activity Feed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="nb-card"
        >
          <h3 className="text-lg font-display font-bold mb-4 text-nb-ink">Recent Activity</h3>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-nb bg-nb-bg border-2 border-nb-ink/20 animate-pulse" />
              ))}
            </div>
          ) : activities.length > 0 ? (
            <div className="space-y-2">
              {activities.map((act) => (
                <ActivityCard key={act.key} {...act} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-nb-ink/50">
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-display font-semibold">No activity yet</p>
              <p className="text-xs mt-1">Deploy contracts and run the demo to see events</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
