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
        className="relative overflow-hidden rounded-2xl glass-strong p-8 glow-blue"
      >
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="relative z-10 flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] flex items-center justify-center shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">
              <span className="text-gradient-blue">Verifiable, Cascading, Trust-Aware</span>{" "}
              Authority
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Cryptographic delegation for autonomous multi-agent systems.
              Authority only narrows. Revocation is lazy and O(1). No trusted intermediary.
            </p>
          </div>
        </div>
        {/* Decorative elements */}
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-[hsl(199,89%,48%)]/5 blur-3xl" />
        <div className="absolute -right-4 -bottom-4 w-32 h-32 rounded-full bg-[hsl(265,89%,65%)]/5 blur-3xl" />
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
          className="glass rounded-2xl p-6 border-gradient"
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-[hsl(38,92%,50%)]" />
            Protocol Stack
          </h3>
          <div className="space-y-3">
            {[
              { layer: "L1", name: "Eclipse Biscuit", desc: "Off-chain token — offline attenuation", color: "from-[hsl(199,89%,48%)] to-[hsl(187,92%,69%)]" },
              { layer: "L2", name: "DCTRegistry.sol", desc: "On-chain lineage tree + lazy revocation", color: "from-[hsl(265,89%,65%)] to-[hsl(199,89%,48%)]" },
              { layer: "L3", name: "DCTEnforcer.sol", desc: "ERC-7710 caveat enforcer", color: "from-[hsl(38,92%,50%)] to-[hsl(30,80%,55%)]" },
              { layer: "L4", name: "TLSNotary", desc: "MPC-TLS action verification (Rust)", color: "from-[hsl(142,76%,36%)] to-[hsl(160,84%,39%)]" },
              { layer: "L5", name: "ERC-8004", desc: "Agent identity — NFT registry", color: "from-[hsl(0,72%,51%)] to-[hsl(340,75%,55%)]" },
            ].map((item, i) => (
              <motion.div
                key={item.layer}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${item.color} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                  {item.layer}
                </div>
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
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
          className="glass rounded-2xl p-6 border-gradient"
        >
          <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : activities.length > 0 ? (
            <div className="space-y-2">
              {activities.map((act) => (
                <ActivityCard key={act.key} {...act} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No activity yet</p>
              <p className="text-xs mt-1">Deploy contracts and run the demo to see events</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
