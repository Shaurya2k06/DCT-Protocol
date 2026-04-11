import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Shield, ExternalLink, Plus, Loader2,
} from "lucide-react";
import Header from "../components/layout/Header";
import { getAgents, registerAgent } from "../lib/api";
import addresses from "../addresses.json";

function TrustBar({ score }) {
  const pct = Math.min((parseFloat(score) / 2) * 100, 100);
  const color =
    pct > 60 ? "from-[hsl(142,76%,36%)] to-[hsl(160,84%,39%)]" :
    pct > 30 ? "from-[hsl(38,92%,50%)] to-[hsl(43,74%,66%)]" :
    "from-[hsl(0,72%,51%)] to-[hsl(340,75%,55%)]";

  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={`h-full rounded-full bg-gradient-to-r ${color}`}
      />
    </div>
  );
}

function AgentCard({ agent, index }) {
  const basescanUrl = import.meta.env.VITE_BASESCAN_URL || "https://sepolia.basescan.org";
  const names = ["Orchestrator Alpha", "Research Beta", "Executor Gamma"];
  const icons = ["🤖", "🔍", "⚡"];
  const name = names[index] || `Agent #${agent.tokenId}`;
  const icon = icons[index] || "🤖";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="glass rounded-2xl p-6 border-gradient glow-blue hover:scale-[1.02] transition-transform duration-300"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(199,89%,48%)]/20 to-[hsl(265,89%,65%)]/20 flex items-center justify-center text-2xl">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-sm">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              Token #{agent.tokenId}
            </p>
          </div>
        </div>
        <div className="px-2 py-1 rounded-md bg-[hsl(142,76%,36%)]/10 text-[hsl(142,76%,36%)] text-xs font-medium">
          ERC-8004
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Trust Score</span>
            <span className="text-xs font-mono font-medium">
              {parseFloat(agent.trustScore).toFixed(4)} / 2.00
            </span>
          </div>
          <TrustBar score={agent.trustScore} />
        </div>

        <div className="pt-3 border-t border-white/10">
          <p className="text-xs text-muted-foreground mb-1">Owner</p>
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono text-foreground truncate">
              {agent.owner}
            </p>
            <a
              href={`${basescanUrl}/address/${agent.owner}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-[hsl(199,89%,48%)] transition-colors shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="pt-3 border-t border-white/10">
          <p className="text-xs text-muted-foreground mb-1">Agent URI</p>
          <p className="text-xs font-mono text-[hsl(199,89%,48%)]">
            {agent.uri}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formUri, setFormUri] = useState("");

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      const data = await getAgents();
      setAgents(data.agents);
    } catch (err) {
      console.error("Error fetching agents:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setRegistering(true);
    try {
      await registerAgent({
        uri: formUri || `ipfs://agent-${Date.now()}`,
      });
      setFormUri("");
      setShowForm(false);
      await fetchAgents();
    } catch (err) {
      console.error("Error registering agent:", err);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="space-y-8">
      <Header
        title="Agent Registry"
        subtitle="ERC-8004 Agent Identities — verifiable on-chain identity for autonomous agents"
      />

      {/* Agents Info Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="glass px-4 py-2 rounded-xl text-sm">
            <span className="text-muted-foreground">Total Agents: </span>
            <span className="font-bold text-[hsl(199,89%,48%)]">{agents.length}</span>
          </div>
          <div className="glass px-4 py-2 rounded-xl text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-[hsl(265,89%,65%)]" />
            <span className="text-muted-foreground">Registry:</span>
            <span
              className="font-mono text-xs text-[hsl(199,89%,48%)] truncate max-w-[140px]"
              title={addresses.ERC8004IdentityRegistry}
            >
              {addresses.ERC8004IdentityRegistry?.slice(0, 10)}…
            </span>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] text-white text-sm font-medium hover:shadow-lg hover:shadow-[hsl(199,89%,48%)]/20 transition-shadow"
        >
          <Plus className="w-4 h-4" />
          Register Agent
        </motion.button>
      </div>

      {/* Register Form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleRegister}
            className="glass rounded-2xl p-6 border-gradient overflow-hidden"
          >
            <h3 className="text-sm font-semibold mb-4">Register New Agent</h3>
            <div className="flex gap-4">
              <input
                type="text"
                value={formUri}
                onChange={(e) => setFormUri(e.target.value)}
                placeholder="Agent URI (e.g. ipfs://my-agent)"
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(199,89%,48%)]/50 focus:border-[hsl(199,89%,48%)]/50"
              />
              <button
                type="submit"
                disabled={registering}
                className="px-6 py-2.5 rounded-xl bg-[hsl(199,89%,48%)] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {registering && <Loader2 className="w-4 h-4 animate-spin" />}
                {registering ? "Registering..." : "Register"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Agent Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-64 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, i) => (
            <AgentCard key={agent.tokenId} agent={agent} index={i} />
          ))}
        </div>
      )}

      {!loading && agents.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">No agents registered</p>
          <p className="text-sm mt-1">Deploy contracts first, then agents will appear here</p>
        </div>
      )}
    </div>
  );
}
