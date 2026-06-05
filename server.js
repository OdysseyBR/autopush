const http = require("http");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 4756;
const PROFILES_FILE = path.join(__dirname, "profiles.json");

// ── Profiles ─────────────────────────────────────────────────
function loadProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8")); }
  catch { return {}; }
}
function saveProfiles(p) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2));
}

// ── Git ───────────────────────────────────────────────────────
function git(args, cwd) {
  // No Windows com shell:true, argumentos com espaços precisam ser escapados manualmente.
  // Usamos shell:false para passar os args diretamente ao processo git, sem passar pelo shell.
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function getRemoteUrl(dir) {
  const r = git(["remote", "get-url", "origin"], dir);
  return r.ok ? r.stdout : "";
}

function getCurrentBranch(dir) {
  const r = git(["branch", "--show-current"], dir);
  return r.ok && r.stdout ? r.stdout : "main";
}

function hasGit(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

// ── Push logic ────────────────────────────────────────────────
function runPush({ repoPath, repoUrl, branch, commitMsg, doPull, initIfNeeded }) {
  const logs = [];
  const log = (type, msg) => logs.push({ type, msg });

  const absPath = repoPath.replace(/^~/, os.homedir());

  if (!fs.existsSync(absPath)) {
    log("error", `Pasta não encontrada: ${absPath}`);
    return { ok: false, logs };
  }
  log("ok", `Pasta encontrada`);

  if (!hasGit(absPath)) {
    if (initIfNeeded) {
      const r = git(["init"], absPath);
      if (!r.ok) { log("error", "Falha ao inicializar repositório."); return { ok: false, logs }; }
      log("ok", "Repositório inicializado.");
    } else {
      log("error", "Não é um repositório git. Ative 'Inicializar repo' ou rode git init.");
      return { ok: false, logs };
    }
  } else {
    log("ok", "Repositório git encontrado.");
  }

  if (repoUrl) {
    const existing = getRemoteUrl(absPath);
    if (!existing) {
      git(["remote", "add", "origin", repoUrl], absPath);
      log("ok", `Remote adicionado: ${repoUrl}`);
    } else if (existing !== repoUrl) {
      git(["remote", "set-url", "origin", repoUrl], absPath);
      log("ok", `Remote atualizado: ${repoUrl}`);
    } else {
      log("info", `Remote: ${repoUrl}`);
    }
  }

  // git add
  const addR = git(["add", "-A"], absPath);
  if (!addR.ok) { log("error", "Falha no git add."); return { ok: false, logs }; }

  // check staged
  const staged = git(["diff", "--cached", "--quiet"], absPath);
  if (staged.ok) {
    log("warn", "Nenhuma alteração detectada. Nada para commitar.");
    return { ok: false, logs };
  }

  // diff stat
  const stat = git(["diff", "--cached", "--stat"], absPath);
  if (stat.stdout) log("diff", stat.stdout);

  // commit
  const commitR = git(["commit", "-m", commitMsg], absPath);
  if (!commitR.ok) {
    log("error", `Erro no commit: ${commitR.stderr}`);
    return { ok: false, logs };
  }
  log("ok", `Commit criado: "${commitMsg}"`);

  // pull
  if (doPull) {
    const pullR = git(["pull", "origin", branch, "--rebase"], absPath);
    if (!pullR.ok) {
      log("error", `Erro no pull: ${pullR.stderr}`);
      return { ok: false, logs };
    }
    log("ok", `Pull de ${branch} concluído.`);
  }

  // push
  const pushR = git(["push", "origin", branch], absPath);
  if (!pushR.ok) {
    const msg = pushR.stderr;
    log("error", `Erro no push: ${msg}`);
    if (msg.includes("rejected") || msg.includes("non-fast-forward")) {
      log("hint", "O remoto tem commits que você não tem. Ative 'Pull antes do push' e tente de novo.");
    } else if (msg.includes("Authentication") || msg.includes("auth")) {
      log("hint", "Problema de autenticação. Verifique seu token/credenciais do GitHub.");
    } else if (msg.includes("does not exist") || msg.includes("not found")) {
      log("hint", `A branch '${branch}' não existe no remoto. Tente rodar: git push -u origin ${branch}`);
    }
    return { ok: false, logs };
  }

  log("success", `Push realizado com sucesso para origin/${branch}!`);
  return { ok: true, logs };
}

// ── HTML UI ───────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>git autopush</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

  :root {
    --bg: #0d0d0f;
    --surface: #141416;
    --surface2: #1c1c1f;
    --border: #2a2a2e;
    --border2: #3a3a3f;
    --text: #e8e8ea;
    --muted: #6b6b72;
    --accent: #4ade80;
    --accent-dim: #166534;
    --red: #f87171;
    --red-dim: #7f1d1d;
    --yellow: #fbbf24;
    --blue: #60a5fa;
    --radius: 10px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 2rem 1rem;
  }

  .container { width: 100%; max-width: 620px; }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 2rem;
  }

  .logo {
    width: 36px; height: 36px;
    background: var(--accent);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }

  header h1 {
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  header span {
    font-size: 12px;
    color: var(--muted);
    font-family: 'JetBrains Mono', monospace;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .card-title {
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 1rem;
    font-family: 'JetBrains Mono', monospace;
  }

  .field { margin-bottom: 0.875rem; }
  .field:last-child { margin-bottom: 0; }

  label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 5px;
    font-family: 'JetBrains Mono', monospace;
  }

  input[type="text"] {
    width: 100%;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 9px 12px;
    font-size: 13px;
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    transition: border-color 0.15s;
  }

  input[type="text"]:focus { border-color: var(--border2); }
  input[type="text"]::placeholder { color: var(--muted); }

  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  .toggles { display: flex; flex-direction: column; gap: 10px; }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--surface2);
    border-radius: 7px;
    border: 1px solid var(--border);
  }

  .toggle-info { display: flex; flex-direction: column; gap: 2px; }
  .toggle-label { font-size: 13px; color: var(--text); }
  .toggle-desc { font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }

  .switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch-track {
    position: absolute; inset: 0;
    background: var(--border2);
    border-radius: 22px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .switch-track::before {
    content: '';
    position: absolute;
    width: 16px; height: 16px;
    left: 3px; top: 3px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  .switch input:checked + .switch-track { background: var(--accent-dim); border: 1px solid var(--accent); }
  .switch input:checked + .switch-track::before { transform: translateX(16px); background: var(--accent); }

  .profiles-section { margin-bottom: 1rem; }

  .profile-list { display: flex; flex-wrap: wrap; gap: 6px; }

  .profile-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s;
  }
  .profile-btn:hover { border-color: var(--border2); color: var(--text); }
  .profile-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(74,222,128,0.05); }

  .btn-push {
    width: 100%;
    background: var(--accent);
    color: #052e16;
    border: none;
    border-radius: var(--radius);
    padding: 13px;
    font-size: 14px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    letter-spacing: -0.01em;
    margin-top: 0.5rem;
  }
  .btn-push:hover { opacity: 0.9; }
  .btn-push:active { transform: scale(0.99); }
  .btn-push:disabled { opacity: 0.4; cursor: not-allowed; }

  .log-area {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    margin-top: 1rem;
    display: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.8;
  }

  .log-area.visible { display: block; }

  .log-line { display: flex; gap: 10px; align-items: flex-start; }
  .log-icon { flex-shrink: 0; width: 16px; margin-top: 2px; }
  .log-ok .log-icon::before { content: '✔'; color: var(--accent); }
  .log-error .log-icon::before { content: '✘'; color: var(--red); }
  .log-warn .log-icon::before { content: '⚠'; color: var(--yellow); }
  .log-info .log-icon::before { content: '→'; color: var(--blue); }
  .log-hint .log-icon::before { content: '💡'; }
  .log-diff .log-icon::before { content: '~'; color: var(--muted); }
  .log-success .log-icon::before { content: '🚀'; }

  .log-ok .log-msg { color: var(--text); }
  .log-error .log-msg { color: var(--red); }
  .log-warn .log-msg { color: var(--yellow); }
  .log-info .log-msg { color: var(--blue); }
  .log-hint .log-msg { color: var(--muted); }
  .log-diff .log-msg { color: var(--muted); white-space: pre; }
  .log-success .log-msg { color: var(--accent); font-weight: 600; }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(5,46,22,0.3);
    border-top-color: #052e16;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
    vertical-align: middle;
    margin-right: 6px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .save-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 0.75rem;
  }
  .save-row input { flex: 1; }
  .save-row button {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 9px 14px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .save-row button:hover { color: var(--text); border-color: var(--border2); }

  .no-profiles { font-size: 12px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">⬆</div>
    <div>
      <h1>git autopush</h1>
      <span>push automático para o GitHub</span>
    </div>
  </header>

  <div class="profiles-section card">
    <div class="card-title">Perfis salvos</div>
    <div class="profile-list" id="profileList">
      <span class="no-profiles">Nenhum perfil ainda.</span>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Repositório</div>
    <div class="field">
      <label>CAMINHO DA PASTA</label>
      <input type="text" id="repoPath" placeholder="C:\\Users\\devlu\\Focus Studios\\Projetos\\meu-app" />
    </div>
    <div class="field">
      <label>URL DO REPOSITÓRIO</label>
      <input type="text" id="repoUrl" placeholder="https://github.com/usuario/repositorio.git" />
    </div>
    <div class="row">
      <div class="field">
        <label>BRANCH</label>
        <input type="text" id="branch" placeholder="main" value="main" />
      </div>
      <div class="field">
        <label>MENSAGEM DO COMMIT</label>
        <input type="text" id="commitMsg" placeholder="feat: nova funcionalidade" />
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Opções</div>
    <div class="toggles">
      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">Pull antes do push</span>
          <span class="toggle-desc">git pull --rebase antes de enviar</span>
        </div>
        <label class="switch"><input type="checkbox" id="doPull" checked /><span class="switch-track"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">Inicializar repo se não existir</span>
          <span class="toggle-desc">git init + adiciona remote</span>
        </div>
        <label class="switch"><input type="checkbox" id="initRepo" /><span class="switch-track"></span></label>
      </div>
    </div>
  </div>

  <div class="save-row">
    <input type="text" id="profileName" placeholder="Nome do perfil (opcional)" />
    <button onclick="saveProfile()">Salvar perfil</button>
  </div>

  <button class="btn-push" id="pushBtn" onclick="doPush()">
    ⬆ Fazer push
  </button>

  <div class="log-area" id="logArea"></div>
</div>

<script>
  let profiles = {};

  async function loadProfiles() {
    const res = await fetch('/profiles');
    profiles = await res.json();
    renderProfiles();
  }

  function renderProfiles() {
    const list = document.getElementById('profileList');
    const names = Object.keys(profiles);
    if (names.length === 0) {
      list.innerHTML = '<span class="no-profiles">Nenhum perfil ainda. Preencha os campos e salve.</span>';
      return;
    }
    list.innerHTML = names.map(n =>
      \`<button class="profile-btn" onclick="loadProfile('\${n}')">\${n}</button>\`
    ).join('');
  }

  function loadProfile(name) {
    const p = profiles[name];
    if (!p) return;
    document.getElementById('repoPath').value = p.repoPath || '';
    document.getElementById('repoUrl').value = p.repoUrl || '';
    document.getElementById('branch').value = p.branch || 'main';
    document.getElementById('doPull').checked = p.doPull !== false;
    document.getElementById('initRepo').checked = p.initIfNeeded || false;
    document.querySelectorAll('.profile-btn').forEach(b => {
      b.classList.toggle('active', b.textContent === name);
    });
    document.getElementById('commitMsg').focus();
  }

  async function saveProfile() {
    const name = document.getElementById('profileName').value.trim();
    if (!name) { alert('Digite um nome para o perfil.'); return; }
    const data = {
      repoPath: document.getElementById('repoPath').value.trim(),
      repoUrl: document.getElementById('repoUrl').value.trim(),
      branch: document.getElementById('branch').value.trim() || 'main',
      doPull: document.getElementById('doPull').checked,
      initIfNeeded: document.getElementById('initRepo').checked,
    };
    await fetch('/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data })
    });
    document.getElementById('profileName').value = '';
    await loadProfiles();
  }

  async function doPush() {
    const repoPath = document.getElementById('repoPath').value.trim();
    const repoUrl = document.getElementById('repoUrl').value.trim();
    const branch = document.getElementById('branch').value.trim() || 'main';
    const commitMsg = document.getElementById('commitMsg').value.trim();
    const doPull = document.getElementById('doPull').checked;
    const initIfNeeded = document.getElementById('initRepo').checked;

    if (!repoPath) { alert('Informe o caminho da pasta.'); return; }
    if (!commitMsg) { alert('Informe a mensagem do commit.'); return; }

    const btn = document.getElementById('pushBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Executando...';

    const logArea = document.getElementById('logArea');
    logArea.innerHTML = '';
    logArea.classList.add('visible');

    try {
      const res = await fetch('/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, repoUrl, branch, commitMsg, doPull, initIfNeeded })
      });
      const { logs } = await res.json();

      logs.forEach(({ type, msg }) => {
        const line = document.createElement('div');
        line.className = \`log-line log-\${type}\`;
        line.innerHTML = \`<span class="log-icon"></span><span class="log-msg">\${msg.replace(/</g,'&lt;')}</span>\`;
        logArea.appendChild(line);
      });
    } catch(e) {
      logArea.innerHTML = \`<div class="log-line log-error"><span class="log-icon"></span><span class="log-msg">Erro de comunicação com o servidor.</span></div>\`;
    }

    btn.disabled = false;
    btn.innerHTML = '⬆ Fazer push';
    logArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  loadProfiles();
</script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { res(JSON.parse(data)); } catch { res({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  if (url === "/" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  if (url === "/profiles" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadProfiles()));
    return;
  }

  if (url === "/profiles" && method === "POST") {
    const { name, data } = await parseBody(req);
    const profiles = loadProfiles();
    profiles[name] = data;
    saveProfiles(profiles);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === "/push" && method === "POST") {
    const body = await parseBody(req);
    const result = runPush(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  git autopush rodando em ${url}\n`);

  // Abre o navegador automaticamente
  const { spawn } = require("child_process");
  const opener =
    process.platform === "win32" ? ["cmd", ["/c", "start", url]] :
    process.platform === "darwin" ? ["open", [url]] :
    ["xdg-open", [url]];
  spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  Porta ${PORT} já em uso. Feche a outra janela do autopush e tente de novo.\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
