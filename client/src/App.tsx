import { FormEvent, useEffect, useState } from "react";

type User = { id: number; email: string; full_name?: string | null; role: "admin" | "user" };
type TerminalLine = { kind: "input" | "output" | "error"; text: string };

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "System error. Please try again later.");
  return body;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await api<{ user?: User; message?: string }>(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST", body: JSON.stringify({ email, password, ...(register ? { confirmPassword } : {}) }),
      });
      if (result.user) onLogin(result.user);
      else setError(result.message || "Account created.");
    } catch (e) { setError(e instanceof Error ? e.message : "System error."); } finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <section className="auth-card panel">
      <div className="brand-mark">HZB<span>•</span></div>
      <p className="eyebrow">SECURE ACCESS NETWORK</p>
      <h1>HAZAKBAN</h1>
      <p className="muted">Access terminal <span className="status-dot">●</span> SYSTEM ONLINE</p>
      <form onSubmit={submit}>
        <label>Email / Gmail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete={register ? "new-password" : "current-password"} /></label>
        {register && <label>Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} autoComplete="new-password" /></label>}
        {error && <div className="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "AUTHENTICATING..." : register ? "CREATE ACCESS" : "ACCESS TERMINAL"} <span>↗</span></button>
      </form>
      <button className="link-button" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Already registered? Sign in" : "Create a normal user account"}</button>
    </section>
  </main>;
}

function Terminal({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { kind: "output", text: "HAZAKBAN ACCESS TERMINAL v1.0" },
    { kind: "output", text: "Connection secured. Type help for available commands." },
  ]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  async function execute(event: FormEvent) {
    event.preventDefault(); const value = command.trim(); if (!value || busy) return;
    setLines((old) => [...old, { kind: "input", text: `$ ${value}` }]); setCommand(""); setBusy(true);
    try {
      const result = await api<{ type: string; lines?: string[]; error?: string; downloadUrl?: string; file?: { name: string } }>("/api/terminal/execute", { method: "POST", body: JSON.stringify({ command: value }) });
      if (result.type === "help") setLines((old) => [...old, ...(result.lines || []).map((text) => ({ kind: "output" as const, text }))]);
      else if (result.downloadUrl) setLines((old) => [...old, { kind: "output", text: `Access granted. Preparing ${result.file?.name || "download"}...` }, { kind: "output", text: "Download completed ✓" }]);
      else setLines((old) => [...old, { kind: "output", text: "Access granted. Target ready." }]);
      if (result.downloadUrl) window.location.assign(result.downloadUrl);
    } catch (e) { setLines((old) => [...old, { kind: "error", text: e instanceof Error ? e.message : "System error." }]); }
    finally { setBusy(false); }
  }
  return <main className="terminal-shell">
    <header className="topbar"><div><strong>HAZAKBAN</strong><span className="terminal-tag">/ USER TERMINAL</span></div><div className="top-actions"><span className="user-chip">{user.email}</span><button onClick={onLogout}>LOGOUT</button></div></header>
    <section className="terminal-panel panel">
      <div className="terminal-heading"><span className="signal">●</span> SECURE SESSION <span className="session-id">USER_{String(user.id).padStart(4, "0")}</span></div>
      <div className="terminal-output">{lines.map((line, index) => <div className={`terminal-line ${line.kind}`} key={`${index}-${line.text}`}>{line.text}</div>)}</div>
      <form className="terminal-input" onSubmit={execute}><span>$</span><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={busy ? "Processing..." : "Enter command"} disabled={busy} autoFocus /></form>
    </section>
    <footer>HAZAKBAN // PRIVATE ACCESS SYSTEM <span>ENCRYPTED</span></footer>
  </main>;
}

function Admin({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<any[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [folderName, setFolderName] = useState("");
  const [commandText, setCommandText] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [targetFolderId, setTargetFolderId] = useState("");
  useEffect(() => { void Promise.all([api<{ users: any[] }>("/api/admin/users").then((r) => setUsers(r.users)), api<{ commands: any[] }>("/api/admin/commands").then((r) => setCommands(r.commands)), api<{ folders: any[] }>("/api/admin/folders").then((r) => setFolders(r.folders)), api<Record<string, number>>("/api/admin/summary").then(setSummary)]); }, []);
  useEffect(() => {
    const endpoints: Record<string, string> = {
      loginLogs: "/api/admin/logs/login",
      activityLogs: "/api/admin/logs/activity",
      sessions: "/api/admin/sessions",
      clientLinks: "/api/admin/client-links",
      settings: "/api/admin/settings",
      about: "/api/admin/about",
    };
    const endpoint = endpoints[tab];
    if (endpoint) void api<any>(endpoint).then((result) => setRecords(result.rows || result.sessions || [])).catch(() => setRecords([]));
  }, [tab]);
  async function createFolder(e: FormEvent) { e.preventDefault(); try { await api("/api/admin/folders", { method: "POST", body: JSON.stringify({ name: folderName }) }); setFolderName(""); setMessage("Folder created."); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to create folder."); } }
  async function createCommand(e: FormEvent) { e.preventDefault(); try { await api("/api/admin/commands", { method: "POST", body: JSON.stringify({ commandText, displayName, actionType: "download_folder", targetFolderId: Number(targetFolderId) }) }); setMessage("Command created."); setCommandText(""); setDisplayName(""); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to create command."); } }
  const nav = [["overview", "Dashboard"], ["users", "Users"], ["loginLogs", "Login Logs"], ["activityLogs", "Activity Logs"], ["sessions", "Active Sessions"], ["files", "Files / Folders"], ["commands", "Terminal Commands"], ["clientLinks", "Client Links"], ["settings", "Settings"], ["about", "About"]];
  return <main className="admin-shell">
    <aside className="sidebar"><div className="brand-mark">HZB<span>•</span></div><div className="side-title">CONTROL PLANE</div>{nav.map(([id, label]) => <button className={tab === id ? "selected" : ""} onClick={() => setTab(id)} key={id}>▹ {label}</button>)}<div className="side-spacer" /><button onClick={onLogout}>↪ Logout</button></aside>
    <section className="admin-content"><header className="topbar"><div><p className="eyebrow">ADMINISTRATOR</p><h2>System control</h2></div><span className="user-chip">{user.email}</span></header>
      {message && <div className="toast">{message}</div>}
      {tab === "overview" && <><div className="stat-grid">{[["users", "REGISTERED USERS"], ["activeSessions", "ACTIVE SESSIONS"], ["commands", "ACTIVE COMMANDS"], ["files", "AVAILABLE FILES"]].map(([key, label]) => <div className="stat-card panel" key={key}><span>{label}</span><strong>{summary[key] ?? "—"}</strong></div>)}</div><div className="panel info-panel"><p className="eyebrow">SYSTEM NOTE</p><h3>Command access is allowlisted.</h3><p className="muted">Users can only access active commands configured here. HAZAKBAN never exposes a real operating-system terminal.</p></div></>}
      {tab === "users" && <div className="panel table-panel"><h3>Registered users</h3><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Last login</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td>{item.email}</td><td><span className="badge">{item.role}</span></td><td>{item.status}</td><td>{item.last_login_at || "Never"}</td></tr>)}</tbody></table></div>}
      {tab === "files" && <div className="split-grid"><div className="panel table-panel"><h3>Folders</h3>{folders.map((item) => <div className="list-row" key={item.id}><span>▰ {item.name}</span><code>{item.id}</code></div>)}<form onSubmit={createFolder} className="inline-form"><input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="New folder name" required /><button className="primary">Create</button></form></div><div className="panel info-panel"><p className="eyebrow">PRIVATE STORAGE</p><h3>Files are not public.</h3><p className="muted">Uploads are stored behind generated storage keys and can only be streamed after a permission check.</p></div></div>}
      {tab === "commands" && <div className="split-grid"><div className="panel table-panel"><h3>Active command definitions</h3>{commands.map((item) => <div className="list-row" key={item.id}><span><code>{item.command_text}</code> {item.display_name}</span><small>{item.folder_name || item.original_name || "—"}</small></div>)}</div><form className="panel form-panel" onSubmit={createCommand}><p className="eyebrow">NEW ALLOWLIST ENTRY</p><h3>Create folder download</h3><label>Command<input value={commandText} onChange={(e) => setCommandText(e.target.value)} placeholder="10 01" required /></label><label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Training files" required /></label><label>Target folder<select value={targetFolderId} onChange={(e) => setTargetFolderId(e.target.value)} required><option value="">Choose folder</option>{folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary">Add command</button></form></div>}
      {["loginLogs", "activityLogs", "sessions", "clientLinks", "settings", "about"].includes(tab) && <div className="panel table-panel"><p className="eyebrow">ADMIN DATA VIEW</p><h3>{nav.find(([id]) => id === tab)?.[1]}</h3>{records.length === 0 ? <p className="muted">No records yet.</p> : <div className="record-list">{records.map((record, index) => <pre className="record" key={record.id || index}>{JSON.stringify(record, null, 2)}</pre>)}</div>}</div>}
    </section>
  </main>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { api<{ user: User | null }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => undefined).finally(() => setChecking(false)); }, []);
  async function logout() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); }
  if (checking) return <div className="loading-screen"><div className="brand-mark">HZB<span>•</span></div><p>INITIALIZING SECURE CHANNEL...</p></div>;
  if (!user) return <Login onLogin={setUser} />;
  return user.role === "admin" ? <Admin user={user} onLogout={logout} /> : <Terminal user={user} onLogout={logout} />;
}