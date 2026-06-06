const http = require("http");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 4756;
const PROFILES_FILE = path.join(__dirname, "profiles.json");

function loadProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8")); }
  catch { return {}; }
}
function saveProfiles(p) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2));
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, windowsHide: true });
  return { ok: result.status === 0, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

function getRemoteUrl(dir) {
  const r = git(["remote", "get-url", "origin"], dir);
  return r.ok ? r.stdout : "";
}

function hasGit(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function runPush(opts) {
  const { repoPath, repoUrl, branch, commitMsg, doPull, initIfNeeded } = opts;
  const logs = [];
  const log = (type, msg) => logs.push({ type, msg });
  const absPath = repoPath.replace(/^~/, os.homedir());

  if (!fs.existsSync(absPath)) { log("error", "Pasta nao encontrada: " + absPath); return { ok: false, logs }; }
  log("ok", "Pasta encontrada");

  if (!hasGit(absPath)) {
    if (initIfNeeded) {
      if (!git(["init"], absPath).ok) { log("error", "Falha ao inicializar repositorio."); return { ok: false, logs }; }
      log("ok", "Repositorio inicializado.");
    } else {
      log("error", "Nao e um repositorio git. Ative Inicializar repo ou rode git init.");
      return { ok: false, logs };
    }
  } else {
    log("ok", "Repositorio git encontrado.");
  }

  if (repoUrl) {
    const existing = getRemoteUrl(absPath);
    if (!existing) { git(["remote", "add", "origin", repoUrl], absPath); log("ok", "Remote adicionado: " + repoUrl); }
    else if (existing !== repoUrl) { git(["remote", "set-url", "origin", repoUrl], absPath); log("ok", "Remote atualizado: " + repoUrl); }
    else { log("info", "Remote: " + repoUrl); }
  }

  if (!git(["add", "-A"], absPath).ok) { log("error", "Falha no git add."); return { ok: false, logs }; }

  const hasCommits = git(["rev-parse", "--verify", "HEAD"], absPath).ok;
  let hasChanges = false;
  if (hasCommits) {
    hasChanges = !git(["diff", "--cached", "--quiet"], absPath).ok;
  } else {
    hasChanges = git(["status", "--porcelain"], absPath).stdout.length > 0;
  }

  if (!hasChanges) { log("warn", "Nenhuma alteracao detectada. Nada para commitar."); return { ok: false, logs }; }

  if (hasCommits) {
    const stat = git(["diff", "--cached", "--stat"], absPath);
    if (stat.stdout) log("diff", stat.stdout);
  } else {
    log("info", "Primeiro commit - enviando todos os arquivos.");
  }

  const commitR = git(["commit", "-m", commitMsg], absPath);
  if (!commitR.ok) { log("error", "Erro no commit: " + commitR.stderr); return { ok: false, logs }; }
  log("ok", "Commit criado: " + commitMsg);

  if (doPull && hasCommits) {
    const pullR = git(["pull", "origin", branch, "--rebase"], absPath);
    if (!pullR.ok) {
      if (!pullR.stderr.includes("no tracking") && !pullR.stderr.includes("couldn't find remote")) {
        log("error", "Erro no pull: " + pullR.stderr);
        return { ok: false, logs };
      }
    } else {
      log("ok", "Pull de " + branch + " concluido.");
    }
  }

  const pushR = git(["push", "-u", "origin", branch], absPath);
  if (!pushR.ok) {
    const msg = pushR.stderr;
    log("error", "Erro no push: " + msg);
    if (msg.includes("rejected") || msg.includes("non-fast-forward")) log("hint", "O remoto tem commits que voce nao tem. Ative Pull antes do push e tente de novo.");
    else if (msg.includes("Authentication") || msg.includes("403")) log("hint", "Problema de autenticacao. Verifique seu token do GitHub.");
    else if (msg.includes("not found")) log("hint", "Repositorio nao encontrado. Verifique se a URL esta correta.");
    return { ok: false, logs };
  }

  log("success", "Push realizado com sucesso para origin/" + branch + "!");
  return { ok: true, logs };
}

function parseBody(req) {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { res(JSON.parse(data)); } catch { res({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" };

  if (req.url === "/" && req.method === "GET") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...noCache });
    res.end(html);
    return;
  }
  if (req.url === "/app.js" && req.method === "GET") {
    const js = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
    res.writeHead(200, { "Content-Type": "application/javascript", ...noCache });
    res.end(js);
    return;
  }
  if (req.url === "/profiles" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...noCache });
    res.end(JSON.stringify(loadProfiles()));
    return;
  }
  if (req.url === "/profiles" && req.method === "POST") {
    const { name, data } = await parseBody(req);
    const profiles = loadProfiles();
    profiles[name] = data;
    saveProfiles(profiles);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/push" && req.method === "POST") {
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
  const url = "http://localhost:" + PORT;
  console.log("\n  git autopush rodando em " + url + "\n");
  const { spawn } = require("child_process");
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error("\n  Porta " + PORT + " ja em uso. Feche a outra janela.\n");
  else console.error(e);
  process.exit(1);
});
