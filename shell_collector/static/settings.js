const state = {
    user: null,
    users: [],
    editingId: null,
};

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
    if (!res.ok && res.status === 403) {
        window.location.href = '/';
    }
    return { ok: res.ok, status: res.status, data };
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
});

async function checkAuth() {
    const { ok, data } = await api('/api/auth/me');
    if (!ok || !data.user.is_admin) {
        window.location.href = '/';
        return;
    }
    state.user = data.user;
    document.getElementById('user-display').textContent = `Logged in as ${data.user.username}`;
}

async function loadUsers() {
    const { ok, data } = await api('/api/users');
    if (!ok) return;
    state.users = data.users;
    renderUsers();
}

function renderUsers() {
    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = '';

    for (const u of state.users) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.id}</td>
            <td>${esc(u.username)}</td>
            <td>${u.is_admin ? 'Yes' : 'No'}</td>
            <td>${new Date().toLocaleDateString()}</td>
            <td class="actions">
                <button class="btn edit-btn" data-id="${u.id}">Edit</button>
                ${u.id !== state.user.id
                    ? '<button class="btn btn-danger delete-btn" data-id="' + u.id + '">Delete</button>'
                    : ''}
            </td>
        `;
        tbody.appendChild(tr);
    }

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => editUser(parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(parseInt(btn.dataset.id)));
    });
}

function esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// Form
const formContainer = document.getElementById('user-form-container');

document.getElementById('show-create-form').addEventListener('click', () => {
    state.editingId = null;
    document.getElementById('user-form-title').textContent = 'Create User';
    document.getElementById('user-username').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').placeholder = 'Password';
    document.getElementById('user-is-admin').checked = false;
    document.getElementById('user-form-error').classList.add('hidden');
    formContainer.classList.remove('hidden');
});

document.getElementById('user-form-cancel').addEventListener('click', () => {
    formContainer.classList.add('hidden');
});

function editUser(id) {
    state.editingId = id;
    const user = state.users.find(u => u.id === id);
    if (!user) return;

    document.getElementById('user-form-title').textContent = 'Edit User';
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').placeholder = 'Leave blank to keep current';
    document.getElementById('user-is-admin').checked = user.is_admin;
    document.getElementById('user-form-error').classList.add('hidden');
    formContainer.classList.remove('hidden');
}

document.getElementById('user-form-save').addEventListener('click', async () => {
    const username = document.getElementById('user-username').value.trim();
    const password = document.getElementById('user-password').value;
    const isAdmin = document.getElementById('user-is-admin').checked;
    const errEl = document.getElementById('user-form-error');

    errEl.classList.add('hidden');

    if (state.editingId) {
        const body = { username };
        if (password) body.password = password;
        body.is_admin = isAdmin;

        const { ok, data } = await api('/api/users/' + state.editingId, {
            method: 'PUT',
            body: JSON.stringify(body),
        });

        if (ok) {
            formContainer.classList.add('hidden');
            await loadUsers();
        } else {
            errEl.textContent = data.error;
            errEl.classList.remove('hidden');
        }
    } else {
        if (!password) {
            errEl.textContent = 'Password is required';
            errEl.classList.remove('hidden');
            return;
        }

        const { ok, data } = await api('/api/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, is_admin: isAdmin }),
        });

        if (ok) {
            formContainer.classList.add('hidden');
            await loadUsers();
        } else {
            errEl.textContent = data.error;
            errEl.classList.remove('hidden');
        }
    }
});

async function deleteUser(id) {
    if (!confirm('Delete user ' + state.users.find(u => u.id === id)?.username + '?')) return;

    const { ok } = await api('/api/users/' + id, { method: 'DELETE' });
    if (ok) {
        await loadUsers();
    }
}

async function loadSettings() {
    const { ok, data } = await api('/api/settings');
    if (!ok) return;
    document.getElementById('discord-webhook').value = data.settings.discord_webhook_url || '';
}

document.getElementById('webhook-save').addEventListener('click', async () => {
    const url = document.getElementById('discord-webhook').value.trim();
    const errEl = document.getElementById('webhook-error');
    const successEl = document.getElementById('webhook-success');
    errEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const { ok, data } = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ discord_webhook_url: url }),
    });

    if (ok) {
        successEl.textContent = 'Webhook saved';
        successEl.classList.remove('hidden');
        setTimeout(() => successEl.classList.add('hidden'), 3000);
    } else {
        errEl.textContent = data.error || 'Failed to save';
        errEl.classList.remove('hidden');
    }
});

async function init() {
    await checkAuth();
    await loadUsers();
    await loadSettings();
}

init();
