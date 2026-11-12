
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const loginView = $('#loginView');
  const appView = $('#appView');
  const loginForm = $('#loginForm');
  const loginButton = loginForm.querySelector('[type="submit"]');

  let role = 'admin';
  let adminKey = '';
  let token = '';
  let physician = null;
  let physicians = [];
  let tickets = [];
  let socket = null;

  const today = new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'full',
    timeZone: 'Africa/Lagos'
  }).format(new Date());

  $('#todayDate').textContent = today;
  $('#physicianDate').textContent = today;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
    );
  }

  function toast(message, error = false) {
    const node = $('#toast');

    if (!node) return;

    node.textContent = message;
    node.className = 'toast show' + (error ? ' error' : '');

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      node.className = 'toast';
    }, 3200);
  }

  function getErrorMessage(data, status) {
    if (status === 429) {
      return 'Too many login attempts. Please wait before trying again.';
    }

    return data?.error || data?.message || `Request failed (${status})`;
  }

  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (role === 'admin' && adminKey) {
      headers['x-admin-key'] = adminKey;
    }

    if (role === 'physician' && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(getErrorMessage(data, response.status));
    }

    return data;
  }

  function showRole(nextRole) {
    if (!['admin', 'physician'].includes(nextRole)) {
      nextRole = 'admin';
    }

    role = nextRole;

    document.querySelectorAll('.role-option').forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.role === role
      );
    });

    $('#identityLabel').textContent =
      role === 'admin' ? 'Admin username' : 'Physician email';

    $('#identity').placeholder =
      role === 'admin' ? 'admin' : 'doctor@hospital.com';

    $('#identity').value = role === 'admin' ? 'admin' : '';

    $('#secretLabel').textContent =
      role === 'admin' ? 'Admin access key' : 'Password';

    $('#secret').placeholder =
      role === 'admin'
        ? 'Enter admin access key'
        : 'Enter your password';

    $('#secret').value = '';
    $('#loginError').textContent = '';
  }

  document.querySelectorAll('.role-option').forEach((button) => {
    button.addEventListener('click', () => {
      showRole(button.dataset.role);
    });
  });

  function setLoginLoading(loading) {
    loginButton.disabled = loading;
    loginButton.textContent = loading ? 'Signing in...' : 'Sign in';
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    $('#loginError').textContent = '';

    const identity = $('#identity').value.trim();
    const secret = $('#secret').value;

    if (!identity || !secret) {
      $('#loginError').textContent =
        'Enter your login details to continue.';
      return;
    }

    setLoginLoading(true);

    try {
      if (role === 'admin') {
        if (identity.toLowerCase() !== 'admin') {
          throw new Error('Use admin as the administrator username.');
        }

        // Administrator authentication uses the admin API key.
        // It must NOT call /physicians/login.
        const previousKey = adminKey;
        adminKey = secret;

        try {
          const data = await api('/admin/physicians');

          physicians = data.physicians || [];
        } catch (error) {
          adminKey = previousKey;
          throw error;
        }

        token = '';
        physician = null;

        sessionStorage.removeItem('cq-token');
        sessionStorage.setItem('cq-role', 'admin');
        sessionStorage.setItem('cq-admin-key', adminKey);

      } else {
        // Physician authentication uses email and password.
        const response = await fetch('/physicians/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: identity,
            password: secret
          })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            getErrorMessage(data, response.status)
          );
        }

        if (!data.token || !data.physician) {
          throw new Error('The server returned an invalid login response.');
        }

        token = data.token;
        physician = data.physician;

        adminKey = '';

        sessionStorage.removeItem('cq-admin-key');
        sessionStorage.setItem('cq-role', 'physician');
        sessionStorage.setItem('cq-token', token);
      }

      enterApp();

    } catch (error) {
      $('#loginError').textContent = error.message;
    } finally {
      setLoginLoading(false);
    }
  });

  function enterApp() {
    loginView.hidden = true;
    appView.hidden = false;

    const displayName =
      role === 'admin'
        ? 'Administrator'
        : physician?.name || 'Physician';

    $('#userName').textContent = displayName;

    $('#userRole').textContent =
      role === 'admin'
        ? 'Admin & reception workspace'
        : physician?.specialty || 'Physician workspace';

    $('#userAvatar').textContent =
      role === 'admin'
        ? 'A'
        : (physician?.name || 'P')
            .replace(/^Dr\.\s*/i, '')
            .charAt(0)
            .toUpperCase();

    $('#sideNav').innerHTML =
      role === 'admin'
        ? `
          <button class="nav-link active">
            <span class="nav-icon">▦</span>Overview
          </button>
          <a class="nav-link" href="/board">
            <span class="nav-icon">▣</span>Public board
          </a>
        `
        : `
          <button class="nav-link active">
            <span class="nav-icon">▦</span>My queue
          </button>
          <a class="nav-link" href="/board">
            <span class="nav-icon">▣</span>Public board
          </a>
        `;

    $('#crumbCurrent').textContent =
      role === 'admin' ? 'OVERVIEW' : 'MY QUEUE';

    $('#pageTitle').textContent =
      role === 'admin'
        ? 'Hospital overview'
        : 'Physician workspace';

    $('#adminView').hidden = role !== 'admin';
    $('#physicianView').hidden = role !== 'physician';

    if (role === 'admin') {
      refreshAdmin();
    } else {
      refreshPhysician();
    }

    connectRealtime();
  }

  function connectRealtime() {
    if (typeof io !== 'function') return;

    if (socket) {
      socket.disconnect();
      socket = null;
    }

    socket = io({
      auth: role === 'physician' ? { token } : {}
    });

    [
      'queue:updated',
      'physician:status',
      'ticket:called',
      'ticket:created'
    ].forEach((eventName) => {
      socket.on(eventName, () => {
        if (role === 'admin') {
          refreshAdmin();
        } else {
          refreshPhysician();
        }
      });
    });
  }

  const stat = (label, value, foot, icon, tone) => `
    <div class="stat-card"
      style="--tone:${tone};--wash:${tone}18">
      <div class="stat-top">
        <span>${escapeHtml(label)}</span>
        <span class="stat-icon">${icon}</span>
      </div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-foot">${escapeHtml(foot)}</div>
    </div>
  `;

  async function refreshAdmin() {
    try {
      const [physicianData, ticketData] = await Promise.all([
        api('/admin/physicians'),
        api('/admin/tickets')
      ]);

      physicians = physicianData.physicians || [];
      tickets = ticketData.tickets || [];

      const waiting = tickets.filter(
        (ticket) => ticket.status === 'WAITING'
      ).length;

      const called = tickets.filter(
        (ticket) => ticket.status === 'CALLED'
      ).length;

      const completed = tickets.filter(
        (ticket) => ticket.status === 'COMPLETED'
      ).length;

      $('#adminStats').innerHTML =
        stat('Total tickets', tickets.length, 'Registered today', '▤', '#159b89') +
        stat('Waiting patients', waiting, 'In the queue', '◷', '#e5a13a') +
        stat('In consultation', called, 'Currently being seen', '♡', '#5298c8') +
        stat('Completed', completed, 'Consultations finished', '✓', '#7c69c7');

      $('#ticketPhysician').innerHTML =
        '<option value="">Choose a physician</option>' +
        physicians
          .filter((physicianItem) => physicianItem.active)
          .map((physicianItem) => `
            <option value="${escapeHtml(physicianItem.id)}">
              ${escapeHtml(physicianItem.code)} ·
              ${escapeHtml(physicianItem.name)} —
              ${escapeHtml(physicianItem.specialty)}
            </option>
          `)
          .join('');

      renderTickets();
      renderPhysicians();

    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderTickets() {
    const search = $('#ticketSearch').value.toLowerCase();

    const filtered = tickets.filter((ticket) => {
      const searchable = [
        ticket.ticketNumber,
        ticket.patient?.name,
        ticket.patient?.phone,
        ticket.physician?.name,
        ticket.status
      ].join(' ').toLowerCase();

      return searchable.includes(search);
    });

    $('#ticketRows').innerHTML = filtered.length
      ? filtered.map((ticket) => `
          <tr>
            <td class="ticket-cell">
              ${escapeHtml(ticket.ticketNumber)}
            </td>
            <td class="patient-cell">
              <b>${escapeHtml(ticket.patient?.name || 'Patient')}</b>
              <small>
                ${escapeHtml(ticket.patient?.phone || 'No phone supplied')}
              </small>
            </td>
            <td>${escapeHtml(ticket.physician?.name || '—')}</td>
            <td>
              <span class="priority-pill priority-${escapeHtml(ticket.priority)}">
                ${escapeHtml(ticket.priority)}
              </span>
            </td>
            <td>
              <span class="status-pill status-${escapeHtml(ticket.status)}">
                ${escapeHtml(ticket.status)}
              </span>
            </td>
            <td>
              ${new Date(ticket.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </td>
          </tr>
        `).join('')
      : `
        <tr>
          <td colspan="6" class="empty-cell">
            No matching queue tickets.
          </td>
        </tr>
      `;
  }

  function renderPhysicians() {
    $('#physicianCount').textContent =
      `${physicians.length} registered`;

    $('#physicianCards').innerHTML = physicians.length
      ? physicians.map((item) => `
          <article class="physician-card">
            <div class="doc-avatar">
              ${escapeHtml(item.code)}
            </div>

            <div style="min-width:0;flex:1">
              <b>${escapeHtml(item.name)}</b>

              <small>
                ${escapeHtml(item.specialty)}
                ${item.department
                  ? ' · ' + escapeHtml(item.department)
                  : ''}
              </small>

              <span class="status-pill ${
                item.active
                  ? 'status-COMPLETED'
                  : 'status-SKIPPED'
              }">
                ${
                  item.active
                    ? item.status === 'OCCUPIED'
                      ? 'OCCUPIED'
                      : 'ACTIVE'
                    : 'INACTIVE'
                }
              </span>
            </div>

            ${
              item.active
                ? `
                  <div class="physician-actions">
                    <button data-deactivate="${escapeHtml(item.id)}">
                      Deactivate
                    </button>
                  </div>
                `
                : ''
            }
          </article>
        `).join('')
      : '<p class="empty-cell">No physicians registered yet.</p>';

    document.querySelectorAll('[data-deactivate]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm(
          'Deactivate this physician? This is allowed only when they have no active tickets.'
        )) {
          return;
        }

        try {
          await api(
            '/admin/physicians/' + encodeURIComponent(button.dataset.deactivate),
            {
              method: 'PATCH',
              body: JSON.stringify({ active: false })
            }
          );

          toast('Physician deactivated');
          await refreshAdmin();

        } catch (error) {
          toast(error.message, true);
        }
      });
    });
  }

  $('#ticketSearch').addEventListener('input', renderTickets);

  $('#ticketForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());

    try {
      const data = await api('/admin/tickets', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      toast('Ticket ' + data.ticket.ticketNumber + ' created');

      event.currentTarget.reset();

      await refreshAdmin();

    } catch (error) {
      toast(error.message, true);
    }
  });

  $('#physicianForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries()
    );

    try {
      const data = await api('/admin/physicians', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      toast('Physician ' + data.physician.name + ' added');

      event.currentTarget.reset();

      await refreshAdmin();

    } catch (error) {
      toast(error.message, true);
    }
  });

  $('#exportCsv').addEventListener('click', () => {
    const columns = [
      'ticketNumber',
      'patientName',
      'phone',
      'physician',
      'priority',
      'status',
      'createdAt'
    ];

    const rows = tickets.map((ticket) => [
      ticket.ticketNumber,
      ticket.patient?.name || '',
      ticket.patient?.phone || '',
      ticket.physician?.name || '',
      ticket.priority,
      ticket.status,
      ticket.createdAt
    ]);

    const csv = [columns, ...rows]
      .map((row) =>
        row.map((value) =>
          '"' + String(value ?? '').replace(/"/g, '""') + '"'
        ).join(',')
      )
      .join('\r\n');

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      'hospital-queue-' + new Date().toISOString().slice(0, 10) + '.csv';

    link.click();

    URL.revokeObjectURL(url);
  });

  async function refreshPhysician() {
    try {
      const data = await api('/physicians/me/queue');

      const current = data.current;
      const waiting = data.waiting || [];

      $('#physicianStats').innerHTML =
        stat('Waiting patients', waiting.length, 'In your queue', '◷', '#e5a13a') +
        stat(
          'Current patient',
          current?.ticketNumber || '—',
          current ? 'Consultation active' : 'No active consultation',
          '♡',
          '#5298c8'
        ) +
        stat('Your ticket code', physician.code, 'Daily ticket prefix', '▤', '#159b89') +
        stat(
          'Your status',
          current ? 'OCCUPIED' : (data.physician?.status || 'FREE'),
          'Clinic availability',
          '✓',
          '#7c69c7'
        );

      $('#waitingCount').textContent = waiting.length;

      $('#currentPatient').innerHTML = current
        ? `
          <div class="empty-illustration">♡</div>
          <div class="eyebrow teal">
            TICKET ${escapeHtml(current.ticketNumber)}
          </div>
          <div class="current-ticket">
            ${escapeHtml(current.ticketNumber)}
          </div>
          <div class="patient-name">
            ${escapeHtml(current.patient?.name || 'Patient')}
          </div>
          <div class="patient-sub">
            ${escapeHtml(current.patient?.phone || 'No phone supplied')}
            · Called
            ${new Date(current.calledAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        `
        : `
          <div class="empty-illustration">✚</div>
          <h3>No active patient</h3>
          <p>Call the next patient when you are ready.</p>
        `;

      $('#completeBtn').disabled = !current;
      $('#skipBtn').disabled = !current;
      $('#callNextBtn').disabled = !!current || waiting.length === 0;

      $('#waitingList').innerHTML = waiting.length
        ? waiting.map((ticket, index) => `
            <div class="waiting-item">
              <div class="waiting-number">
                ${String(index + 1).padStart(2, '0')}
              </div>

              <div class="waiting-details">
                <b>${escapeHtml(ticket.patient?.name || 'Patient')}</b>
                <small>
                  ${escapeHtml(ticket.ticketNumber)}
                  · ${escapeHtml(ticket.priority)}
                  ${
                    ticket.patient?.phone
                      ? ' · ' + escapeHtml(ticket.patient.phone)
                      : ''
                  }
                </small>
              </div>

              <span class="waiting-position">
                #${index + 1}
              </span>
            </div>
          `).join('')
        : '<div class="empty-cell">No patients waiting.</div>';

    } catch (error) {
      if (
        error.message.toLowerCase().includes('token') ||
        error.message.toLowerCase().includes('unauthorized')
      ) {
        logout();
        return;
      }

      toast(error.message, true);
    }
  }

  $('#callNextBtn').addEventListener('click', async () => {
    try {
      const data = await api('/physicians/me/call-next', {
        method: 'POST'
      });

      toast('Now serving ' + data.ticket.ticketNumber);

      await refreshPhysician();

    } catch (error) {
      toast(error.message, true);
    }
  });

  $('#completeBtn').addEventListener('click', async () => {
    try {
      await api('/physicians/me/complete', {
        method: 'POST'
      });

      toast('Consultation completed');

      await refreshPhysician();

    } catch (error) {
      toast(error.message, true);
    }
  });

  $('#skipBtn').addEventListener('click', async () => {
    if (!confirm('Mark this patient as skipped?')) return;

    try {
      await api('/physicians/me/skip', {
        method: 'POST'
      });

      toast('Patient marked as skipped');

      await refreshPhysician();

    } catch (error) {
      toast(error.message, true);
    }
  });

  function logout() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    // Remove only this application's session data.
    sessionStorage.removeItem('cq-role');
    sessionStorage.removeItem('cq-admin-key');
    sessionStorage.removeItem('cq-token');

    adminKey = '';
    token = '';
    physician = null;
    physicians = [];
    tickets = [];

    // Critical fix: reset the authentication role.
    showRole('admin');

    $('#secret').value = '';
    $('#loginError').textContent = '';

    appView.hidden = true;
    loginView.hidden = false;
  }

  $('#logoutBtn').addEventListener('click', logout);

  // Restore a saved administrator session.
  async function restoreSession() {
    const savedRole = sessionStorage.getItem('cq-role');

    if (
      savedRole === 'admin' &&
      sessionStorage.getItem('cq-admin-key')
    ) {
      showRole('admin');

      adminKey = sessionStorage.getItem('cq-admin-key');

      try {
        const data = await api('/admin/physicians');

        physicians = data.physicians || [];

        enterApp();

      } catch {
        logout();
      }

      return;
    }

    // Restore a saved physician session.
    if (
      savedRole === 'physician' &&
      sessionStorage.getItem('cq-token')
    ) {
      showRole('physician');

      token = sessionStorage.getItem('cq-token');

      try {
        const data = await api('/physicians/me');

        physician = data.physician;

        if (!physician) {
          throw new Error('Physician session is invalid.');
        }

        enterApp();

      } catch {
        logout();
      }

      return;
    }

    // Default login state is always Administrator.
    logout();
  }

  showRole('admin');
  restoreSession();

})();
