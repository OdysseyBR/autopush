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
  list.innerHTML = '';
  names.forEach(function(n) {
    var btn = document.createElement('button');
    btn.className = 'profile-btn';
    btn.textContent = n;
    btn.onclick = function() { loadProfile(n); };
    list.appendChild(btn);
  });
}

function loadProfile(name) {
  var p = profiles[name];
  if (!p) return;
  document.getElementById('repoPath').value = p.repoPath || '';
  document.getElementById('repoUrl').value = p.repoUrl || '';
  document.getElementById('branch').value = p.branch || 'main';
  document.getElementById('doPull').checked = p.doPull !== false;
  document.getElementById('initRepo').checked = p.initIfNeeded || false;
  document.querySelectorAll('.profile-btn').forEach(function(b) {
    b.classList.toggle('active', b.textContent === name);
  });
  document.getElementById('commitMsg').focus();
}

async function saveProfile() {
  var name = document.getElementById('profileName').value.trim();
  if (!name) { alert('Digite um nome para o perfil.'); return; }
  var data = {
    repoPath: document.getElementById('repoPath').value.trim(),
    repoUrl: document.getElementById('repoUrl').value.trim(),
    branch: document.getElementById('branch').value.trim() || 'main',
    doPull: document.getElementById('doPull').checked,
    initIfNeeded: document.getElementById('initRepo').checked
  };
  await fetch('/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, data: data })
  });
  document.getElementById('profileName').value = '';
  await loadProfiles();
}

async function doPush() {
  var repoPath = document.getElementById('repoPath').value.trim();
  var repoUrl = document.getElementById('repoUrl').value.trim();
  var branch = document.getElementById('branch').value.trim() || 'main';
  var commitMsg = document.getElementById('commitMsg').value.trim();
  var doPull = document.getElementById('doPull').checked;
  var initIfNeeded = document.getElementById('initRepo').checked;

  if (!repoPath) { alert('Informe o caminho da pasta.'); return; }
  if (!commitMsg) { alert('Informe a mensagem do commit.'); return; }

  var btn = document.getElementById('pushBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Executando...';

  var logArea = document.getElementById('logArea');
  logArea.innerHTML = '';
  logArea.classList.add('visible');

  try {
    var res = await fetch('/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: repoPath, repoUrl: repoUrl, branch: branch, commitMsg: commitMsg, doPull: doPull, initIfNeeded: initIfNeeded })
    });
    var result = await res.json();
    result.logs.forEach(function(item) {
      var line = document.createElement('div');
      line.className = 'log-line log-' + item.type;
      var icon = document.createElement('span');
      icon.className = 'log-icon';
      var msg = document.createElement('span');
      msg.className = 'log-msg';
      msg.textContent = item.msg;
      line.appendChild(icon);
      line.appendChild(msg);
      logArea.appendChild(line);
    });
  } catch(e) {
    var line = document.createElement('div');
    line.className = 'log-line log-error';
    line.innerHTML = '<span class="log-icon"></span><span class="log-msg">Erro de comunicação com o servidor: ' + e.message + '</span>';
    logArea.appendChild(line);
  }

  btn.disabled = false;
  btn.innerHTML = '⬆ Fazer push';
  logArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

loadProfiles();
