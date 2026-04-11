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
    pct > 60 ? "bg-nb-ok" :
    pct > 30 ? "bg-nb-warn" :
    "bg-nb-error";

  return (
    <div className="w-full h-3 rounded-full bg-nb-bg border-2 border-nb-ink overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={`h-full ${color}`}
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
      className="nb-card hover:-translate-y-1 active:translate-y-0 transition-transform duration-200"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-nb border-2 border-nb-ink bg-nb-accent/20 flex items-center justify-center text-2xl">
            {icon}
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-nb-ink">{name}</h3>
            <p className="text-xs text-nb-ink/50 font-mono">
              Token #{agent.tokenId}
            </p>
          </div>
        </div>
        <span className="nb-pill-accent text-[10px]">
          ERC-8004
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-display font-semibold text-nb-ink/60">Trust Score</span>
            <span className="text-xs font-mono font-bold text-nb-ink">
              {parseFloat(agent.trustScore).toFixed(4)} / 2.00
            </span>
          </div>
          <TrustBar score={agent.trustScore} />
        </div>

        <div className="pt-3 border-t-2 border-nb-ink/20">
          <p className="text-xs font-display font-semibold text-nb-ink/60 mb-1">Owner</p>
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono text-nb-ink truncate">
              {agent.owner}
            </p>
            <a
              href={`${basescanUrl}/address/${agent.owner}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-nb-ink/40 hover:text-nb-accent transition-colors shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="pt-3 border-t-2 border-nb-ink/20">
          <p className="text-xs font-display font-semibold text-nb-ink/60 mb-1">Agent URI</p>
          <p className="text-xs font-mono text-nb-accent-2">
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
          <div className="nb-pill">
            <span className="text-nb-ink/60">Total Agents:</span>
            <span className="font-bold text-nb-accent-2">{agents.length}</span>
          </div>
          <div className="nb-pill">
            <Shield className="w-4 h-4 text-purple-600" />
            <span className="text-nb-ink/60">Registry:</span>
            <span
              className="font-mono text-xs text-nb-accent-2 truncate max-w-[140px]"
              title={addresses.ERC8004IdentityRegistry}
            >
              {addresses.ERC8004IdentityRegistry?.slice(0, 10)}…
            </span>
          </div>
        </div>
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ y: 0 }}
          onClick={() => setShowForm(!showForm)}
          className="nb-btn-primary"
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
            className="nb-card overflow-hidden"
          >
            <h3 className="text-sm font-display font-bold mb-4 text-nb-ink">Register New Agent</h3>
            <div className="flex gap-4">
              <input
                type="text"
                value={formUri}
                onChange={(e) => setFormUri(e.target.value)}
                placeholder="Agent URI (e.g. ipfs://my-agent)"
                className="nb-input flex-1"
              />
              <button
                type="submit"
                disabled={registering}
                className="nb-btn-secondary disabled:opacity-50"
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
            <div key={i} className="h-64 rounded-nb bg-nb-bg border-2 border-nb-ink/20 animate-pulse" />
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
        <div className="text-center py-16 text-nb-ink/50">
          <Users className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-display font-bold">No agents registered</p>
          <p className="text-sm mt-1">Deploy contracts first, then agents will appear here</p>
        </div>
      )}
    </div>
  );
}
