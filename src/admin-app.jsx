import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// PERSISTENT DATABASE — window.storage (persists across sessions)
// Shared with user-app via same storage keys.
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push, update, get } from "firebase/database";

// 1. PASTE YOUR FIREBASE CONFIG HERE
const firebaseConfig = {
  apiKey: "AIzaSyBqhDVc3kC4W6p-ChikhRswl3dKaqz1sHA",
  authDomain: "safety-app-8343c.firebaseapp.com",
  projectId: "safety-app-8343c",
  storageBucket: "safety-app-8343c.firebasestorage.app",
  messagingSenderId: "446563652231",
  appId: "1:446563652231:web:52d25a278584064af8de22"
};

// 2. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const Database = (() => {
  let listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  const defaultUsers = [
    { id: "u1", name: "Sreelakshmi", phone: "+91 94471 23456", email: "sreel@email.com", status: "safe", joinedAt: new Date(Date.now() - 86400000 * 5).toISOString(), alertCount: 0 },
    { id: "u2", name: "Ananya Krishnan", phone: "+91 98765 11223", email: "ananya@email.com", status: "safe", joinedAt: new Date(Date.now() - 86400000 * 12).toISOString(), alertCount: 0 },
    { id: "u3", name: "Devika Nair", phone: "+91 70123 45678", email: "devika@email.com", status: "safe", joinedAt: new Date(Date.now() - 86400000 * 3).toISOString(), alertCount: 0 },
  ];

  const readAlerts = () => {
    try { return JSON.parse(localStorage.getItem("wsas:alerts") || "[]"); }
    catch { return []; }
  };
  const writeAlerts = (alerts) => {
    localStorage.setItem("wsas:alerts", JSON.stringify(alerts));
  };
  const readUsers = () => {
    try { return JSON.parse(localStorage.getItem("wsas:users") || "null") || defaultUsers; }
    catch { return defaultUsers; }
  };
  const writeUsers = (users) => {
    localStorage.setItem("wsas:users", JSON.stringify(users));
  };
  const readLogs = () => {
    try { return JSON.parse(localStorage.getItem("wsas:logs") || "[]"); }
    catch { return []; }
  };
  const writeLogs = (logs) => {
    localStorage.setItem("wsas:logs", JSON.stringify(logs.slice(0, 200)));
  };

  const addLog = (type, message) => {
    const logs = readLogs();
    const updated = [{ id: `log${Date.now()}`, type, message, timestamp: new Date().toISOString() }, ...logs];
    writeLogs(updated);
  };

  return {
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },

    getAlerts: (filter = {}) => {
      let result = readAlerts();
      if (filter.status) result = result.filter((a) => a.status === filter.status);
      if (filter.userId) result = result.filter((a) => a.userId === filter.userId);
      if (filter.search) {
        const q = filter.search.toLowerCase();
        result = result.filter((a) => a.userName.toLowerCase().includes(q) || a.firebaseId.toLowerCase().includes(q));
      }
      return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },

    resolveAlert: (id, adminNote = "") => {
      const alerts = readAlerts();
      const users = readUsers();
      const a = alerts.find((x) => x.id === id);
      if (!a) return;
      const updatedAlerts = alerts.map((x) => x.id === id ? { ...x, status: "RESOLVED", resolvedAt: new Date().toISOString(), adminNote } : x);
      const updatedUsers = users.map((u) => u.id === a.userId ? { ...u, status: "safe" } : u);
      writeAlerts(updatedAlerts);
      writeUsers(updatedUsers);
      addLog("resolve", `${id} resolved by admin${adminNote ? `: ${adminNote}` : ""}`);
      notify();
    },

    cancelAlert: (id) => {
      const alerts = readAlerts();
      const users = readUsers();
      const a = alerts.find((x) => x.id === id);
      if (!a) return;
      const updatedAlerts = alerts.map((x) => x.id === id ? { ...x, status: "CANCELLED" } : x);
      const updatedUsers = users.map((u) => u.id === a.userId ? { ...u, status: "safe" } : u);
      writeAlerts(updatedAlerts);
      writeUsers(updatedUsers);
      addLog("cancel", `${id} marked as false alarm`);
      notify();
    },

    deleteAlert: (id) => {
      const alerts = readAlerts();
      writeAlerts(alerts.filter((x) => x.id !== id));
      addLog("info", `Alert ${id} deleted from database`);
      notify();
    },

    getUsers: (search = "") => {
      const users = readUsers();
      if (!search) return users;
      const q = search.toLowerCase();
      return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.phone.includes(q));
    },

    addUser: (user) => {
      const users = readUsers();
      const u = { ...user, id: `u${Date.now()}`, joinedAt: new Date().toISOString(), status: "safe", alertCount: 0 };
      writeUsers([...users, u]);
      addLog("info", `New user registered: ${u.name}`);
      notify();
      return u;
    },

    removeUser: (id) => {
      const users = readUsers();
      const alerts = readAlerts();
      const u = users.find((x) => x.id === id);
      writeUsers(users.filter((x) => x.id !== id));
      writeAlerts(alerts.filter((a) => a.userId !== id));
      if (u) addLog("info", `User ${u.name} removed from system`);
      notify();
    },

    getStats: () => {
      const alerts = readAlerts();
      const users = readUsers();
      const now = Date.now();
      const today = alerts.filter((a) => new Date(a.timestamp) > new Date(now - 86400000));
      const resolved = alerts.filter((a) => a.status === "RESOLVED");
      const responseTimes = resolved
        .filter((a) => a.resolvedAt)
        .map((a) => (new Date(a.resolvedAt) - new Date(a.timestamp)) / 60000);
      const avgResponse = responseTimes.length ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length) : 0;
      return {
        totalAlerts: alerts.length,
        activeAlerts: alerts.filter((a) => a.status === "ACTIVE").length,
        resolvedAlerts: resolved.length,
        cancelledAlerts: alerts.filter((a) => a.status === "CANCELLED").length,
        totalUsers: users.length,
        alertsToday: today.length,
        avgResponseMin: avgResponse,
      };
    },

    getLogs: () => readLogs(),

    generateReport: () => {
      const stats = Database.getStats();
      const alerts = readAlerts();
      const users = readUsers();
      return { generated: new Date().toISOString(), ...stats, alerts, users };
    },

    initSeedLogs: () => {
      const existing = readLogs();
      if (existing.length > 0) return;
      const seedLogs = [
        { id: "log0", type: "info", message: "System initialized — Women Safety Alert System v2.1.0", timestamp: new Date(Date.now() - 3600000 * 6).toISOString() },
        { id: "log00", type: "info", message: "3 users pre-registered in the system", timestamp: new Date(Date.now() - 3600000 * 5).toISOString() },
      ];
      writeLogs(seedLogs);
    },
  };
})();

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const C = {
  bg: "#0b0f1a", sidebar: "#0f1524", card: "#141c2e",
  cardHover: "#1a2440", border: "#1e2d45",
  accent: "#e74c3c", accentDim: "rgba(231,76,60,0.12)",
  safe: "#27ae60", safeDim: "rgba(39,174,96,0.12)",
  warn: "#f39c12", warnDim: "rgba(243,156,18,0.12)",
  blue: "#2980b9", blueDim: "rgba(41,128,185,0.12)",
  purple: "#8e44ad",
  text: "#e8eaf0", sub: "#8892a4", muted: "#4a5568",
};

const ANIM = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideL{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes blink{0%,100%{background:rgba(231,76,60,0.2)}50%{background:rgba(231,76,60,0.05)}}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
  body{background:${C.bg}}
`;

// ─────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px", borderLeft: `3px solid ${color}`, animation: "fadeIn 0.4s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1, fontFamily: "'Syne', sans-serif" }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{sub}</div>}
        </div>
        <span style={{ fontSize: 28, opacity: 0.6 }}>{icon}</span>
      </div>
    </div>
  );
}

function Badge({ status }) {
  const map = {
    ACTIVE: { bg: "rgba(231,76,60,0.18)", color: C.accent, label: "● ACTIVE" },
    RESOLVED: { bg: "rgba(39,174,96,0.15)", color: C.safe, label: "✓ RESOLVED" },
    CANCELLED: { bg: "rgba(243,156,18,0.15)", color: C.warn, label: "✕ CANCELLED" },
    safe: { bg: "rgba(39,174,96,0.12)", color: C.safe, label: "Safe" },
    alert: { bg: "rgba(231,76,60,0.12)", color: C.accent, label: "⚠ Alert" },
  };
  const s = map[status] || map.safe;
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, letterSpacing: 0.5, animation: status === "ACTIVE" ? "blink 2s infinite" : "none" }}>
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────────────────────
function DashboardPage({ db, onRefresh }) {
  const [stats, setStats] = useState({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, cancelledAlerts: 0, totalUsers: 0, alertsToday: 0, avgResponseMin: 0 });
  const [alerts, setAlerts] = useState([]);

  const load = useCallback(() => {
    setStats(db.getStats());
    setAlerts(db.getAlerts());
  }, []);

  useEffect(() => {
    load();
    const unsub = db.subscribe(load);
    const interval = setInterval(load, 10000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  const statCards = [
    { label: "Active Alerts", value: stats.activeAlerts, color: C.accent, icon: "🆘", sub: "Requires immediate action" },
    { label: "Total Alerts", value: stats.totalAlerts, color: C.blue, icon: "📊", sub: "All time" },
    { label: "Resolved", value: stats.resolvedAlerts, color: C.safe, icon: "✅", sub: `${stats.cancelledAlerts} cancelled` },
    { label: "Registered Users", value: stats.totalUsers, color: C.purple, icon: "👥", sub: `${stats.alertsToday} alerts today` },
  ];

  const activeAlerts = alerts.filter((a) => a.status === "ACTIVE");

  return (
    <div style={{ padding: 28, animation: "fadeIn 0.3s" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif", letterSpacing: -0.5 }}>Dashboard</h1>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.safe, display: "inline-block", animation: "pulse 2s infinite" }} />
          Live • Persistent Database • {new Date().toLocaleString("en-IN")}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
        {statCards.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", marginBottom: 24 }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: C.text, fontSize: 15, fontFamily: "'Syne', sans-serif" }}>
            Active Emergencies
            {activeAlerts.length > 0 && <span style={{ marginLeft: 10, background: "rgba(231,76,60,0.2)", color: C.accent, fontSize: 11, padding: "2px 10px", borderRadius: 20, fontWeight: 800 }}>{activeAlerts.length} urgent</span>}
          </div>
        </div>
        {activeAlerts.length === 0
          ? <div style={{ padding: "40px 22px", textAlign: "center", color: C.muted, fontSize: 14 }}>✅ No active emergencies</div>
          : activeAlerts.map((a) => (
            <div key={a.firebaseId} style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", animation: "blink 3s infinite" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>{a.userName}</span>
                  <Badge status={a.status} />
                  {a.location?.source === "gps" && <span style={{ fontSize: 10, background: "rgba(39,174,96,0.15)", color: C.safe, padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>📡 GPS</span>}
                </div>
                <div style={{ fontSize: 12, color: C.sub }}>
                  📍 {a.location?.latitude?.toFixed(5)}°N, {a.location?.longitude?.toFixed(5)}°E • Accuracy: ±{a.location?.accuracy}m •{" "}
                  <a href={a.mapsLink} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Maps ↗</a>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{a.userPhone} • {new Date(a.timestamp).toLocaleTimeString("en-IN")}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => db.cancelAlert(a.firebaseId)} style={{ padding: "7px 14px", borderRadius: 8, background: C.warnDim, border: `1px solid ${C.warn}`, color: C.warn, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>False Alarm</button>
                <button onClick={() => db.resolveAlert(a.firebaseId)} style={{ padding: "7px 14px", borderRadius: 8, background: C.safeDim, border: `1px solid ${C.safe}`, color: C.safe, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓ Resolve</button>
              </div>
            </div>
          ))}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontWeight: 800, color: C.text, fontSize: 15, fontFamily: "'Syne', sans-serif" }}>Recent Alerts</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "rgba(255,255,255,0.02)" }}>
            {["Alert ID", "User", "Phone", "Time", "Status", ""].map((h) => (
              <th key={h} style={{ padding: "11px 18px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.8, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {alerts.slice(0, 8).map((a) => (
              <tr key={a.firebaseId} style={{ borderBottom: `1px solid ${C.border}`, transition: "background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.cardHover}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "12px 18px", fontSize: 12, color: C.blue, fontFamily: "'JetBrains Mono', monospace" }}>{a.firebaseId}</td>
                <td style={{ padding: "12px 18px", fontSize: 13, color: C.text, fontWeight: 600 }}>{a.userName}</td>
                <td style={{ padding: "12px 18px", fontSize: 12, color: C.sub }}>{a.userPhone}</td>
                <td style={{ padding: "12px 18px", fontSize: 12, color: C.sub }}>{new Date(a.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                <td style={{ padding: "12px 18px" }}><Badge status={a.status} /></td>
                <td style={{ padding: "12px 18px" }}>
                  {a.status === "ACTIVE" && (
                    <button onClick={() => db.resolveAlert(a.firebaseId)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, background: C.safeDim, border: `1px solid ${C.safe}`, color: C.safe, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Resolve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {alerts.length === 0 && <div style={{ padding: "40px 22px", textAlign: "center", color: C.muted }}>No alerts yet. Trigger one from the user app.</div>}
      </div>
    </div>
  );
}

function AlertsPage({ db }) {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setAlerts(db.getAlerts());
  }, []);

  useEffect(() => { load(); return db.subscribe(load); }, []);

  const filtered = alerts.filter((a) => {
    if (filter !== "ALL" && a.status !== filter) return false;
    if (search) { const q = search.toLowerCase(); return a.userName.toLowerCase().includes(q) || a.firebaseId.toLowerCase().includes(q); }
    return true;
  });

  const filterBtns = ["ALL", "ACTIVE", "RESOLVED", "CANCELLED"];
  const filterColors = { ALL: C.blue, ACTIVE: C.accent, RESOLVED: C.safe, CANCELLED: C.warn };
  const inp = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 14px", color: C.text, fontSize: 13, outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ padding: 28, animation: "fadeIn 0.3s" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif", marginBottom: 24 }}>Alert Management</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or alert ID…" style={{ ...inp, width: 280 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {filterBtns.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: filter === f ? `${filterColors[f]}22` : "transparent", border: `1px solid ${filter === f ? filterColors[f] : C.border}`, color: filter === f ? filterColors[f] : C.sub }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "rgba(255,255,255,0.02)" }}>
            {["Alert ID", "User", "Location", "Time", "Status", "Actions"].map((h) => (
              <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.8, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={6} style={{ padding: "48px 18px", textAlign: "center", color: C.muted }}>No alerts found</td></tr>
              : filtered.map((a) => (
                <tr key={a.firebaseId} style={{ borderBottom: `1px solid ${C.border}`, transition: "background 0.15s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.cardHover}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "13px 18px", fontSize: 12, color: C.blue, fontFamily: "'JetBrains Mono', monospace" }}>{a.firebaseId}</td>
                  <td style={{ padding: "13px 18px" }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{a.userName}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{a.userPhone}</div>
                  </td>
                  <td style={{ padding: "13px 18px" }}>
                    <div style={{ fontSize: 12, color: C.sub }}>{a.location?.latitude?.toFixed(4)}°N</div>
                    {a.location?.source === "gps" && <span style={{ fontSize: 10, color: C.safe }}>📡 Real GPS</span>}
                    {a.location?.source === "fallback" && <span style={{ fontSize: 10, color: C.warn }}>⚠ Approx</span>}
                    <br /><a href={a.mapsLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blue }}>Maps ↗</a>
                  </td>
                  <td style={{ padding: "13px 18px", fontSize: 12, color: C.sub }}>{new Date(a.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td style={{ padding: "13px 18px" }}><Badge status={a.status} /></td>
                  <td style={{ padding: "13px 18px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {a.status === "ACTIVE" && <>
                        <button onClick={() => db.resolveAlert(a.firebaseId)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: C.safeDim, border: `1px solid ${C.safe}`, color: C.safe, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Resolve</button>
                        <button onClick={() => db.cancelAlert(a.firebaseId)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: C.warnDim, border: `1px solid ${C.warn}`, color: C.warn, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Cancel</button>
                      </>}
                      <button onClick={() => db.deleteAlert(a.firebaseId)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: C.accentDim, border: `1px solid ${C.accent}`, color: C.accent, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersPage({ db }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setUsers(db.getUsers());
  }, []);

  useEffect(() => { load(); return db.subscribe(load); }, []);

  const filtered = search ? users.filter((u) => { const q = search.toLowerCase(); return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.phone.includes(q); }) : users;

  const handleAdd = () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setAdding(true);
    db.addUser(form);
    setForm({ name: "", phone: "", email: "" });
    setShowForm(false);
    setAdding(false);
  };

  const inp = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", fontFamily: "inherit", width: "100%" };
  const avatarColors = [C.accent, C.blue, C.safe, C.purple, C.warn];

  return (
    <div style={{ padding: 28, animation: "fadeIn 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif" }}>User Management</h1>
        <button onClick={() => setShowForm((v) => !v)} style={{ padding: "9px 20px", borderRadius: 10, background: C.accent, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          {showForm ? "✕ Close" : "+ Add User"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: C.card, border: `1px solid ${C.accent}`, borderRadius: 16, padding: 22, marginBottom: 22, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end", animation: "fadeIn 0.3s" }}>
          <div>
            <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: 0.8, display: "block", marginBottom: 6 }}>NAME *</label>
            <input style={inp} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: 0.8, display: "block", marginBottom: 6 }}>EMAIL *</label>
            <input style={inp} placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: 0.8, display: "block", marginBottom: 6 }}>PHONE</label>
            <input style={inp} placeholder="+91 XXXXX XXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <button onClick={handleAdd} disabled={adding} style={{ padding: "10px 22px", borderRadius: 10, background: C.safe, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
            {adding ? "Adding…" : "Save User"}
          </button>
        </div>
      )}

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…"
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", color: C.text, fontSize: 13, outline: "none", fontFamily: "inherit", width: 300, marginBottom: 20 }} />

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "rgba(255,255,255,0.02)" }}>
            {["User", "Contact", "Joined", "Alerts", "Status", "Actions"].map((h) => (
              <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.8, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}`, transition: "background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.cardHover}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: avatarColors[i % avatarColors.length], display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", flexShrink: 0 }}>{u.name[0]}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: C.sub }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "14px 18px", fontSize: 13, color: C.sub }}>{u.phone || "—"}</td>
                <td style={{ padding: "14px 18px", fontSize: 12, color: C.sub }}>{new Date(u.joinedAt).toLocaleDateString("en-IN")}</td>
                <td style={{ padding: "14px 18px" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: u.alertCount > 0 ? C.accent : C.muted }}>{u.alertCount || 0}</span>
                </td>
                <td style={{ padding: "14px 18px" }}><Badge status={u.status} /></td>
                <td style={{ padding: "14px 18px" }}>
                  <button onClick={() => db.removeUser(u.id)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, background: C.accentDim, border: `1px solid ${C.accent}`, color: C.accent, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsPage({ db }) {
  const [generated, setGenerated] = useState(false);
  const [report, setReport] = useState(null);
  const [stats, setStats] = useState({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, cancelledAlerts: 0, totalUsers: 0, alertsToday: 0, avgResponseMin: 0 });

  useEffect(() => {
    setStats(db.getStats());
    const unsub = db.subscribe(() => setStats(db.getStats()));
    return unsub;
  }, []);

  const generate = () => {
    const r = db.generateReport();
    setReport(r);
    setGenerated(true);
  };

  const barData = [
    { label: "Active", value: stats.activeAlerts, color: C.accent, max: Math.max(stats.totalAlerts, 1) },
    { label: "Resolved", value: stats.resolvedAlerts, color: C.safe, max: Math.max(stats.totalAlerts, 1) },
    { label: "Cancelled", value: stats.cancelledAlerts, color: C.warn, max: Math.max(stats.totalAlerts, 1) },
  ];

  return (
    <div style={{ padding: 28, animation: "fadeIn 0.3s" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif", marginBottom: 24 }}>Reports & Analytics</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ fontWeight: 800, color: C.text, marginBottom: 20, fontFamily: "'Syne', sans-serif" }}>Alert Status Breakdown</div>
          {barData.map((b) => (
            <div key={b.label} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.sub }}>{b.label}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: b.color }}>{b.value}</span>
              </div>
              <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((b.value / b.max) * 100, 100)}%`, background: b.color, borderRadius: 4, transition: "width 0.8s ease" }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ fontWeight: 800, color: C.text, marginBottom: 20, fontFamily: "'Syne', sans-serif" }}>System Metrics</div>
          {[
            ["Total Alerts", stats.totalAlerts, C.blue],
            ["Alerts Today", stats.alertsToday, C.purple],
            ["Registered Users", stats.totalUsers, C.safe],
            ["Avg Response Time", `${stats.avgResponseMin} min`, C.warn],
            ["Resolution Rate", stats.totalAlerts ? `${Math.round((stats.resolvedAlerts / stats.totalAlerts) * 100)}%` : "N/A", C.safe],
          ].map(([label, value, color]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.sub }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        <div style={{ fontWeight: 800, color: C.text, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>Generate System Report</div>
        <p style={{ fontSize: 13, color: C.sub, marginBottom: 20 }}>Export a full snapshot of all alerts, users, and statistics from the persistent database.</p>
        <button onClick={generate} style={{ padding: "10px 24px", borderRadius: 10, background: C.blue, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          📊 Generate Report
        </button>
        {generated && report && (
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.sub, whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto", animation: "fadeIn 0.4s", marginTop: 16 }}>
            {`WOMEN SAFETY ALERT SYSTEM — REPORT\nGenerated: ${new Date(report.generated).toLocaleString("en-IN")}\n${"─".repeat(45)}\nALERTS: ${report.totalAlerts} total | ${report.activeAlerts} active | ${report.resolvedAlerts} resolved | ${report.cancelledAlerts} cancelled\nUSERS:  ${report.totalUsers} registered\nTODAY:  ${report.alertsToday} alerts triggered\n${"─".repeat(45)}\nALERT LOG:\n${(report.alerts || []).map((a) => `  [${a.status}] ${a.firebaseId}\n    User: ${a.userName} (${a.userPhone})\n    Loc:  ${a.location?.latitude?.toFixed(5)}°N, ${a.location?.longitude?.toFixed(5)}°E (${a.location?.source === "gps" ? "Real GPS" : "Approx"})\n    Time: ${new Date(a.timestamp).toLocaleString("en-IN")}`).join("\n") || "  No alerts yet."}\n${"─".repeat(45)}\nUSER REGISTRY:\n${(report.users || []).map((u) => `  ${u.name} | ${u.email} | Alerts: ${u.alertCount || 0}`).join("\n")}`}
          </div>
        )}
      </div>
    </div>
  );
}

function LogsPage({ db }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    setLogs(db.getLogs());
    const unsub = db.subscribe(() => setLogs(db.getLogs()));
    return unsub;
  }, []);

  const typeStyle = {
    alert: { color: C.accent, bg: C.accentDim, icon: "🆘" },
    resolve: { color: C.safe, bg: C.safeDim, icon: "✅" },
    cancel: { color: C.warn, bg: C.warnDim, icon: "✕" },
    info: { color: C.blue, bg: C.blueDim, icon: "ℹ" },
  };

  return (
    <div style={{ padding: 28, animation: "fadeIn 0.3s" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif", marginBottom: 24 }}>System Logs</h1>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.safe, display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 12, color: C.sub }}>Persistent audit trail • {logs.length} entries</span>
        </div>
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {logs.length === 0
            ? <div style={{ padding: "40px", textAlign: "center", color: C.muted }}>No logs yet. Trigger an SOS from the user app.</div>
            : logs.map((log) => {
              const s = typeStyle[log.type] || typeStyle.info;
              return (
                <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "12px 20px", borderBottom: `1px solid ${C.border}`, animation: "slideL 0.3s" }}>
                  <span style={{ fontSize: 14, marginTop: 1 }}>{s.icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: C.text }}>{log.message}</span>
                  </div>
                  <span style={{ fontSize: 11, color: C.muted, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{new Date(log.timestamp).toLocaleTimeString("en-IN")}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: s.bg, color: s.color, fontWeight: 800, flexShrink: 0 }}>{log.type.toUpperCase()}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN ADMIN APP
// ─────────────────────────────────────────────────────────────
export default function AdminApp() {
  const [page, setPage] = useState("dashboard");
  const [stats, setStats] = useState({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, cancelledAlerts: 0, totalUsers: 0, alertsToday: 0 });
  const db = Database;

  useEffect(() => {
  db.initSeedLogs();
  setStats(db.getStats());
  return db.subscribe(() => setStats(db.getStats()));
}, []);

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "alerts", label: "Alerts", icon: "🆘" },
    { id: "users", label: "Users", icon: "👥" },
    { id: "reports", label: "Reports", icon: "📈" },
    { id: "logs", label: "System Logs", icon: "🗒️" },
  ];

  return (
    <div style={{ fontFamily: "'Syne','Segoe UI',sans-serif", background: C.bg, minHeight: "100vh", display: "flex" }}>
      <style>{ANIM}</style>

      {/* SIDEBAR */}
      <aside style={{ width: 240, background: C.sidebar, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 100 }}>
        <div style={{ padding: "24px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: -0.5 }}>
            <span style={{ color: C.accent }}>🛡️</span> SafeAlert
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 3, letterSpacing: 1 }}>ADMIN CONSOLE</div>
        </div>

        {stats.activeAlerts > 0 && (
          <div style={{ margin: "12px 16px", background: C.accentDim, border: `1px solid ${C.accent}`, borderRadius: 10, padding: "10px 14px", animation: "blink 2s infinite" }}>
            <div style={{ fontSize: 11, color: C.accent, fontWeight: 800 }}>⚠️ {stats.activeAlerts} ACTIVE ALERT{stats.activeAlerts > 1 ? "S" : ""}</div>
            <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>Immediate action required</div>
          </div>
        )}

        <nav style={{ padding: "12px 10px", flex: 1 }}>
          {nav.map((n) => (
            <button key={n.id} onClick={() => setPage(n.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: page === n.id ? "rgba(231,76,60,0.12)" : "transparent", color: page === n.id ? C.accent : C.sub, fontWeight: page === n.id ? 700 : 500, fontSize: 13, marginBottom: 2, fontFamily: "inherit", transition: "all 0.15s", textAlign: "left" }}
              onMouseEnter={(e) => { if (page !== n.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (page !== n.id) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              {n.label}
              {n.id === "alerts" && stats.activeAlerts > 0 && (
                <span style={{ marginLeft: "auto", background: C.accent, color: "#fff", fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 20 }}>{stats.activeAlerts}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 13 }}>A</div>
            <div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>Admin</div>
              <div style={{ fontSize: 10, color: C.sub }}>System Administrator</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, marginLeft: 240, minHeight: "100vh", overflowY: "auto" }}>
        <div style={{ background: C.sidebar, borderBottom: `1px solid ${C.border}`, padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ fontSize: 13, color: C.sub }}>Women Safety Alert System — Admin Dashboard</div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.safe }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.safe, display: "inline-block", animation: "pulse 2s infinite" }} />
              Persistent DB Online
            </span>
            <span style={{ fontSize: 12, color: C.sub, fontFamily: "'JetBrains Mono', monospace" }}>{new Date().toLocaleTimeString("en-IN")}</span>
          </div>
        </div>

        {page === "dashboard" && <DashboardPage db={db} />}
        {page === "alerts" && <AlertsPage db={db} />}
        {page === "users" && <UsersPage db={db} />}
        {page === "reports" && <ReportsPage db={db} />}
        {page === "logs" && <LogsPage db={db} />}
      </main>
    </div>
  );
}
