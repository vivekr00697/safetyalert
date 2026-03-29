import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────
// PERSISTENT SHARED DATABASE — uses window.storage API
// Both user-app and admin-app read/write the same keys.
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

export const SharedDB = (() => {
  return {
    // Listens for cloud changes instantly on both phones
    subscribe: (fn) => {
      const alertsRef = ref(db, 'alerts');
      return onValue(alertsRef, () => fn()); 
    },

    // Pushes alert to the cloud so Admin sees it
    logAlert: async (alert) => {
      const alertsRef = ref(db, 'alerts');
      const newAlertRef = push(alertsRef);
      const alertWithId = { ...alert, firebaseId: newAlertRef.key };
      
      await set(newAlertRef, alertWithId);
      return alertWithId;
    },

    // Admin can cancel/resolve from their phone
    cancelAlert: async (firebaseId) => {
      const alertRef = ref(db, `alerts/${firebaseId}`);
      await update(alertRef, { status: "CANCELLED" });
    },

    resolveAlert: async (firebaseId) => {
      const alertRef = ref(db, `alerts/${firebaseId}`);
      await update(alertRef, { 
        status: "RESOLVED", 
        resolvedAt: new Date().toISOString() 
      });
    },

    getAlerts: async () => {
      const snapshot = await get(ref(db, 'alerts'));
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Convert Firebase object back to an Array for your tables
        return Object.keys(data).map(key => ({
          ...data[key],
          firebaseId: key
        })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
      return [];
    }
  };
})();
// ─────────────────────────────────────────────────────────────
// REAL GPS MODULE — uses browser navigator.geolocation
// Falls back to Palakkad coordinates if permission denied
// ─────────────────────────────────────────────────────────────
const LocationModule = {
  getCurrentLocation: () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ latitude: 10.7867, longitude: 76.6548, accuracy: 999, source: "fallback", timestamp: new Date().toISOString() });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          source: "gps",
          timestamp: new Date().toISOString(),
        }),
        () => resolve({ latitude: 10.7867, longitude: 76.6548, accuracy: 999, source: "fallback", timestamp: new Date().toISOString() }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    }),
  format: (loc) => `${loc.latitude.toFixed(5)}°N, ${loc.longitude.toFixed(5)}°E`,
  mapsLink: (loc) => `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`,
  whatsappLink: (loc, name) =>
    `https://wa.me/?text=${encodeURIComponent(`🆘 EMERGENCY ALERT from ${name}\n📍 Location: ${loc.latitude.toFixed(5)}°N, ${loc.longitude.toFixed(5)}°E\n🗺️ Maps: https://maps.google.com/?q=${loc.latitude},${loc.longitude}\n⏰ Time: ${new Date().toLocaleString("en-IN")}\n\nPlease respond immediately!`)}`,
};

// ─────────────────────────────────────────────────────────────
// SMS / NOTIFICATION MODULE
// Real implementation: calls your backend /api/send-sms
// which wraps Twilio (or Fast2SMS for India).
//
// To wire up real SMS:
//   1. Deploy a small Express/Flask endpoint at /api/send-sms
//   2. Body: { to: "+91XXXXXXXXXX", message: "..." }
//   3. Use Twilio or Fast2SMS SDK on the backend
//   4. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN env vars
//
// Until then: simulates delivery + opens WhatsApp share as backup
// ─────────────────────────────────────────────────────────────
const NotificationModule = {
  buildMessage: (user, location) =>
    `🆘 EMERGENCY ALERT!\n${user.name} needs help immediately.\n📍 Location: ${LocationModule.format(location)}\n🗺️ ${LocationModule.mapsLink(location)}\n⏰ ${new Date().toLocaleString("en-IN")}\nPlease call her now: ${user.phone}`,

  sendSMS: async (contact, message) => {
    // ── REAL SMS (uncomment when backend is ready) ──────────────
    // try {
    //   const res = await fetch("/api/send-sms", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({ to: contact.phone, message }),
    //   });
    //   const data = await res.json();
    //   return { contact: contact.name, sms: data.success, sid: data.sid };
    // } catch (err) {
    //   return { contact: contact.name, sms: false, error: err.message };
    // }
    // ── SIMULATION (remove when backend is ready) ────────────────
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
    return { contact: contact.name, phone: contact.phone, sms: true, simulated: true };
  },

  dispatch: async (user, contacts, location) => {
    const message = NotificationModule.buildMessage(user, location);
    const results = await Promise.all(
      contacts.map((c) => NotificationModule.sendSMS(c, message))
    );
    return { results, message };
  },
};

// ─────────────────────────────────────────────────────────────
// SOS ALERT MODULE
// ─────────────────────────────────────────────────────────────
const SOSAlertModule = {
  createAlert: (user, location) => ({
    id: `ALERT-${Date.now()}`,
    userId: user.id, userName: user.name, userPhone: user.phone,
    location, timestamp: new Date().toISOString(),
    status: "ACTIVE", mapsLink: LocationModule.mapsLink(location),
  }),
  trigger: async (user, contacts, onStep) => {
    onStep("gps");
    const location = await LocationModule.getCurrentLocation();
    onStep("log");
    const alert = SOSAlertModule.createAlert(user, location);
    await SharedDB.logAlert(alert);
    onStep("notify");
    const { results, message } = await NotificationModule.dispatch(user, contacts, location);
    onStep("done");
    return { alert, results, message };
  },
};

// ─────────────────────────────────────────────────────────────
// USER MODULE — contacts stored in localStorage
// ─────────────────────────────────────────────────────────────
const useUserModule = () => {
  const savedContacts = (() => {
    try { return JSON.parse(localStorage.getItem("wsas:contacts") || "null"); } catch { return null; }
  })();
  const [contacts, setContacts] = useState(savedContacts || [
    { id: "c1", name: "Amma", phone: "+91 94471 00001", relation: "Mother" },
    { id: "c2", name: "Achan", phone: "+91 94471 00002", relation: "Father" },
    { id: "c3", name: "Meenu Chechi", phone: "+91 94471 00003", relation: "Sister" },
  ]);

  useEffect(() => {
    try { localStorage.setItem("wsas:contacts", JSON.stringify(contacts)); } catch {}
  }, [contacts]);

  return {
    contacts,
    addContact: (c) => setContacts((p) => [...p, { ...c, id: `c${Date.now()}` }]),
    removeContact: (id) => setContacts((p) => p.filter((c) => c.id !== id)),
  };
};

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const C = {
  bg: "#fdf8f3", card: "#ffffff", surface: "#f5ede3",
  border: "#e8ddd2", sos: "#c0392b", sosDark: "#922b21",
  safe: "#1a7a4a", safeBg: "rgba(26,122,74,0.09)",
  warn: "#b7770d", warnBg: "rgba(183,119,13,0.09)",
  blue: "#1d6fa4", blueBg: "rgba(29,111,164,0.09)",
  text: "#1c1410", sub: "#7a6a5e", muted: "#b8a898",
};

const ANIM = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700;800&display=swap');
  @keyframes sosBreath{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(192,57,43,0.45)}50%{transform:scale(1.03);box-shadow:0 0 0 22px rgba(192,57,43,0)}}
  @keyframes ring{0%{transform:scale(1);opacity:0.7}100%{transform:scale(2.6);opacity:0}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideR{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes cPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.95)}}
  @keyframes gpsAcquire{0%{stroke-dashoffset:100}100%{stroke-dashoffset:0}}
  * { box-sizing: border-box; }
`;

// ─────────────────────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────────────────────
// Add phase, setPhase, activeAlert, and setActiveAlert to the props
function SOSScreen({ user, contacts, phase, setPhase, activeAlert, setActiveAlert }) {
  // REMOVED local phase and activeAlert states to use props instead
  const [count, setCount] = useState(5);
  const [step, setStep] = useState("");
  const [results, setResults] = useState([]);
  const [gpsSource, setGpsSource] = useState(null);
  const timerRef = useRef(null);

  const stepMsg = {
    gps: "📡 Acquiring GPS location…",
    log: "🔒 Securing emergency record…",
    notify: "📲 Sending SMS to contacts…",
    done: "✅ Contacts notified",
  };

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) { sendAlert(); return; }
    timerRef.current = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [phase, count]);

  const startSOS = () => { setPhase("countdown"); setCount(5); };
  const cancelCountdown = () => { clearTimeout(timerRef.current); setPhase("idle"); };

  const sendAlert = async () => {
    setPhase("sending");
    const { alert, results: r } = await SOSAlertModule.trigger(user, contacts, setStep);
    setGpsSource(alert.location.source);
    setActiveAlert(alert);
    setResults(r);
    setPhase("sent");
  };

  const cancelAlert = async () => {
    if (activeAlert) await SharedDB.cancelAlert(activeAlert.id);
    setPhase("cancelled");
    setTimeout(() => { 
      setPhase("idle"); 
      setActiveAlert(null); 
      setResults([]); 
    }, 2500);
  };

  const openWhatsApp = () => {
    if (activeAlert) window.open(LocationModule.whatsappLink(activeAlert.location, user.name), "_blank");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 22px 24px", gap: 24 }}>
      {/* SUCCESS MESSAGE */}
      {phase === "sent" && (
        <div style={{ background: C.safeBg, border: `1px solid ${C.safe}`, borderRadius: 12, padding: "10px 18px", width: "100%", maxWidth: 340, textAlign: "center", fontSize: 13, fontWeight: 700, color: C.safe, animation: "fadeUp 0.3s" }}>
          🛡️ Alert Active — Help is on the way
        </div>
      )}
      
      {/* CANCELLED MESSAGE */}
      {phase === "cancelled" && (
        <div style={{ background: C.safeBg, border: `1px solid ${C.safe}`, borderRadius: 12, padding: "10px 18px", width: "100%", maxWidth: 340, textAlign: "center", fontSize: 13, fontWeight: 700, color: C.safe, animation: "fadeUp 0.3s" }}>
          ✓ Alert Cancelled
        </div>
      )}

      {/* IDLE MESSAGE */}
      {phase === "idle" && (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: C.sub, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
            Tap the button below to trigger your emergency alert.<br />
            A 5-second countdown lets you cancel if needed.
          </p>
        </div>
      )}

      {/* SOS BUTTON - Show during idle, countdown, or sending */}
      {["idle", "countdown", "sending"].includes(phase) && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 220, height: 220 }}>
          {phase === "idle" && [0, 1, 2].map((i) => (
            <div key={i} style={{ position: "absolute", borderRadius: "50%", width: 190, height: 190, border: `1.5px solid ${C.sos}`, animation: `ring 2.4s ease-out infinite`, animationDelay: `${i * 0.8}s`, opacity: 0 }} />
          ))}
          <button
            onClick={phase === "idle" ? startSOS : phase === "countdown" ? cancelCountdown : undefined}
            disabled={phase === "sending"}
            style={{
              width: 190, height: 190, borderRadius: "50%",
              background: `radial-gradient(circle at 38% 32%, #e74c3c, ${C.sosDark})`,
              border: "5px solid rgba(255,255,255,0.14)",
              boxShadow: `0 10px 44px rgba(192,57,43,0.5), inset 0 2px 8px rgba(255,255,255,0.1)`,
              animation: phase === "countdown" ? "sosBreath 1s ease-in-out infinite" : "none",
              cursor: phase === "sending" ? "default" : "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 5, color: "#fff", position: "relative", zIndex: 2, fontFamily: "inherit",
            }}>
            {phase === "idle" && <><span style={{ fontSize: 40 }}>🆘</span><span style={{ fontSize: 14, fontWeight: 900, letterSpacing: 5 }}>SOS</span></>}
            {phase === "countdown" && <><span style={{ fontSize: 70, fontWeight: 900, animation: "cPulse 1s ease infinite" }}>{count}</span><span style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.8 }}>TAP TO CANCEL</span></>}
            {phase === "sending" && <span style={{ fontSize: 36, animation: "spin 0.8s linear infinite" }}>⚡</span>}
          </button>
        </div>
      )}

      {phase === "sending" && <p style={{ color: C.sos, fontWeight: 700, fontSize: 13 }}>{stepMsg[step] || "Sending…"}</p>}

      {/* DISPATCHED CARD */}
      {phase === "sent" && activeAlert && (
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 18, padding: 20, width: "100%", maxWidth: 340, animation: "fadeUp 0.4s" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 12 }}>📋 Alert Dispatched</div>
          <div style={{ background: C.surface, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>📍 LOCATION</div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{LocationModule.format(activeAlert.location)}</div>
            <a href={activeAlert.mapsLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue }}>View Maps →</a>
          </div>
          <button onClick={openWhatsApp} style={{ width: "100%", padding: 10, borderRadius: 10, background: "#25D366", border: "none", color: "#fff", fontWeight: 700, marginBottom: 8 }}>Share WhatsApp</button>
          <button onClick={cancelAlert} style={{ width: "100%", padding: 10, borderRadius: 10, background: C.warnBg, border: `1.5px solid ${C.warn}`, color: C.warn, fontWeight: 700 }}>Cancel Alert</button>
        </div>
      )}
    </div>
  );
}

function ContactsScreen({ contacts, addContact, removeContact }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", relation: "" });
  const relations = ["Mother", "Father", "Sister", "Brother", "Friend", "Partner", "Neighbour", "Other"];
  const avatarColors = [C.sos, C.blue, C.safe, "#8e44ad", C.warn, "#16a085"];

  const handleAdd = () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    if (!/^\+?[\d\s\-]{7,}$/.test(form.phone)) {
      alert("Please enter a valid phone number (e.g. +91 94471 23456)");
      return;
    }
    addContact(form);
    setForm({ name: "", phone: "", relation: "" });
    setShowForm(false);
  };

  const inp = { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 14px", color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 12 };

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>Trusted Contacts</h2>
        <button onClick={() => setShowForm((v) => !v)} style={{ padding: "8px 18px", borderRadius: 50, background: C.sos, border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          {showForm ? "✕ Close" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: C.card, border: `1.5px solid ${C.sos}`, borderRadius: 16, padding: 18, marginBottom: 16, animation: "fadeUp 0.3s" }}>
          <input style={inp} placeholder="Full name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input style={inp} placeholder="+91 XXXXX XXXXX *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select style={{ ...inp, marginBottom: 14 }} value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
            <option value="">Select relation</option>
            {relations.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 11, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button onClick={handleAdd} style={{ flex: 1, padding: 11, borderRadius: 10, background: C.sos, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save Contact</button>
          </div>
        </div>
      )}

      <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
        {contacts.length === 0
          ? <div style={{ textAlign: "center", padding: "48px 20px", color: C.muted }}><div style={{ fontSize: 36 }}>👥</div><p style={{ marginTop: 8 }}>No contacts yet. Add someone you trust.</p></div>
          : contacts.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderBottom: i < contacts.length - 1 ? `1px solid ${C.border}` : "none", animation: "slideR 0.3s" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: avatarColors[i % avatarColors.length], display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 17, flexShrink: 0 }}>{c.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{c.phone}</div>
              </div>
              {c.relation && <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: C.blueBg, color: C.blue, fontWeight: 700 }}>{c.relation}</span>}
              <a href={`tel:${c.phone.replace(/\s/g, "")}`} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: C.safe, padding: "4px 6px", textDecoration: "none" }}>📞</a>
              <button onClick={() => removeContact(c.id)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: C.muted, padding: "4px 6px" }}>🗑</button>
            </div>
          ))}
      </div>
    </div>
  );
}

function HistoryScreen({ userId }) {
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    const load = async () => {
      const all = await SharedDB.getAlerts();
      setAlerts(all.filter((a) => a.userId === userId));
    };
    load();
    return SharedDB.subscribe(load);
  }, [userId]);

  const badge = {
    ACTIVE: { bg: "rgba(192,57,43,0.1)", color: C.sos },
    CANCELLED: { bg: C.warnBg, color: C.warn },
    RESOLVED: { bg: C.safeBg, color: C.safe },
  };

  return (
    <div style={{ padding: "24px 20px" }}>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: C.text, marginBottom: 20 }}>Alert History</h2>
      {alerts.length === 0
        ? <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}><div style={{ fontSize: 40 }}>📋</div><p style={{ marginTop: 12 }}>No alerts triggered yet</p></div>
        : alerts.map((a) => (
          <div key={a.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 10, animation: "fadeUp 0.3s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>{a.id}</span>
              <span style={{ ...badge[a.status], fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20 }}>{a.status}</span>
            </div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 8, lineHeight: 1.7 }}>
              📍 {LocationModule.format(a.location)}
              {a.location.source === "gps" && <span style={{ marginLeft: 6, fontSize: 10, background: C.safeBg, color: C.safe, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>GPS</span>}<br />
              <a href={a.mapsLink} target="_blank" rel="noreferrer" style={{ color: C.blue }}>Open in Maps →</a>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>🕐 {new Date(a.timestamp).toLocaleString("en-IN")}</div>
          </div>
        ))}
    </div>
  );
}

function ProfileScreen({ user }) {
  const [safeSent, setSafeSent] = useState(false);
  const sendSafe = () => {
    setSafeSent(true);
    setTimeout(() => setSafeSent(false), 3000);
  };
  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingBottom: 24, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: C.sos, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 900, color: "#fff", boxShadow: "0 4px 20px rgba(192,57,43,0.3)" }}>{user.name[0]}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{user.name}</div>
        <div style={{ fontSize: 13, color: C.sub }}>{user.phone}</div>
      </div>
      {[["Email", user.email], ["Account Status", "✅ Active"], ["Safety Mode", "🟢 Enabled"], ["App Version", "v2.1.0"]].map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 13, color: C.sub }}>{label}</span>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</span>
        </div>
      ))}
      <button onClick={sendSafe} style={{ width: "100%", marginTop: 24, padding: 14, borderRadius: 14, background: safeSent ? C.safeBg : C.surface, border: `1.5px solid ${safeSent ? C.safe : C.border}`, color: safeSent ? C.safe : C.sub, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
        {safeSent ? "✓ Safe status sent to contacts" : "🛡️ I am Safe — Send Update"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN USER APP
// ─────────────────────────────────────────────────────────────
export default function UserApp() {
  const [tab, setTab] = useState("sos");
  const { contacts, addContact, removeContact } = useUserModule();
  const currentUser = { id: "u1", name: "Sreelakshmi", phone: "+91 94471 23456", email: "sreel@email.com" };
  
  // CRITICAL: Lifted State for persistence
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const [sosPhase, setSosPhase] = useState("idle");
  const [activeAlertData, setActiveAlertData] = useState(null);

  useEffect(() => {
    const refresh = async () => {
      const all = await SharedDB.getAlerts();
      const myActive = all.filter((a) => a.userId === currentUser.id && a.status === "ACTIVE");
      
      setActiveAlertsCount(myActive.length);

      // If an alert is active in DB, sync the UI automatically
      if (myActive.length > 0) {
        setSosPhase("sent");
        setActiveAlertData(myActive[0]);
      } else if (sosPhase === "sent") {
        setSosPhase("idle");
        setActiveAlertData(null);
      }
    };
    refresh();
    return SharedDB.subscribe(refresh);
  }, [currentUser.id]); 

  const tabs = [
    { id: "sos", label: "SOS", icon: "🆘" },
    { id: "contacts", label: "Contacts", icon: "👥" },
    { id: "history", label: "History", icon: "📋" },
    { id: "profile", label: "Profile", icon: "👤" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", maxWidth: 390, margin: "0 auto", boxShadow: "0 0 80px rgba(0,0,0,0.1)", position: "relative" }}>
      <style>{ANIM}</style>

      <div style={{ background: activeAlertsCount > 0 ? C.sos : "#1a7a4a", padding: "7px 20px", display: "flex", justifyContent: "space-between", transition: "background 0.4s" }}>
        <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>SAFEALERT</span>
        <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }}>{activeAlertsCount > 0 ? `⚠️ ${activeAlertsCount} Active Alert` : "🟢 All Safe"}</span>
      </div>

      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "13px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted }}>Welcome back,</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.text, letterSpacing: -0.3 }}>{currentUser.name}</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.sos, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 16 }}>{currentUser.name[0]}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "sos" && (
          <SOSScreen 
            user={currentUser} 
            contacts={contacts} 
            phase={sosPhase} 
            setPhase={setSosPhase}
            activeAlert={activeAlertData}
            setActiveAlert={setActiveAlertData}
          />
        )}
        {tab === "contacts" && <ContactsScreen contacts={contacts} addContact={addContact} removeContact={removeContact} />}
        {tab === "history" && <HistoryScreen userId={currentUser.id} />}
        {tab === "profile" && <ProfileScreen user={currentUser} />}
      </div>

      <nav style={{ display: "flex", background: C.card, borderTop: `1px solid ${C.border}` }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "10px 4px 12px", border: "none", cursor: "pointer", background: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, borderTop: tab === t.id ? `2.5px solid ${C.sos}` : "2.5px solid transparent", transition: "border 0.15s", fontFamily: "inherit" }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: tab === t.id ? C.sos : C.muted }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}