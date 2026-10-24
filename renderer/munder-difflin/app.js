(function munderDifflinOffice() {
  const DESK_COUNT = 12;
  const KNOWN_ENGINES = new Set(['codex', 'claude', 'gemini', 'hermes', 'openclaw']);
  const elements = {
    projectLabel: document.getElementById('project-label'),
    floorStatus: document.querySelector('.floor-status'),
    floorStatusText: document.getElementById('floor-status-text'),
    deskGrid: document.getElementById('desk-grid'),
    agentCount: document.getElementById('agent-count'),
    engineCount: document.getElementById('engine-count'),
    cpuTotal: document.getElementById('cpu-total'),
    message: document.getElementById('office-message'),
    activityList: document.getElementById('activity-list'),
    detail: document.getElementById('agent-detail'),
    detailTitle: document.getElementById('agent-detail-title'),
    detailState: document.getElementById('agent-detail-state'),
    detailEngine: document.getElementById('agent-detail-engine'),
    detailProcess: document.getElementById('agent-detail-process'),
    detailElapsed: document.getElementById('agent-detail-elapsed'),
    detailCwd: document.getElementById('agent-detail-cwd'),
    detailSummary: document.getElementById('agent-detail-summary'),
    refresh: document.getElementById('refresh-office'),
    openTerminal: document.getElementById('open-terminal'),
    openTerminalLabel: document.getElementById('open-terminal-label'),
    terminalStatus: document.getElementById('terminal-status'),
    lastRefreshed: document.getElementById('last-refreshed'),
  };

  const state = {
    projectLabel: 'Workspace root',
    projectPath: '.',
    agents: [],
    refreshedAt: '',
    error: '',
    selectedPid: null,
    openingPid: null,
    terminalResult: '',
    terminalResultIsError: false,
    waiting: true,
  };

  function safeString(value, maxLength = 320) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.slice(0, maxLength);
  }

  function normalizeAgent(agent) {
    const cli = safeString(agent?.cli, 24).toLowerCase();
    const targetOwner = safeString(agent?.terminalTarget?.owner, 16);
    const targetKey = safeString(agent?.terminalTarget?.key, 220);
    const targetKind = safeString(agent?.terminalTarget?.kind, 24);
    const terminalTarget =
      (targetOwner === 'native' || targetOwner === 'bridge') && targetKey
        ? {
            owner: targetOwner,
            key: targetKey,
            kind: targetKind === 'watchdog' ? 'watchdog' : 'project',
          }
        : null;
    return {
      pid: Number(agent?.pid) || 0,
      cli: KNOWN_ENGINES.has(cli) ? cli : 'agent',
      kind: safeString(agent?.kind, 32) || 'agent',
      cpu: Math.max(0, Number(agent?.cpu) || 0),
      mem: Math.max(0, Number(agent?.mem) || 0),
      elapsed: safeString(agent?.elapsed, 24),
      command: safeString(agent?.command, 220),
      cwd: safeString(agent?.cwd, 220),
      transcriptSummary: safeString(agent?.transcriptSummary, 320),
      terminalTarget,
      terminalUnavailableReason: safeString(agent?.terminalUnavailableReason, 220),
    };
  }

  function engineLabel(cli) {
    switch (cli) {
      case 'codex':
        return 'Codex';
      case 'claude':
        return 'Claude';
      case 'gemini':
        return 'Gemini';
      case 'hermes':
        return 'Hermes';
      case 'openclaw':
        return 'OpenClaw';
      default:
        return 'Agent';
    }
  }

  function agentName(agent) {
    const suffix = String(agent.pid || '0000').slice(-4).padStart(4, '0');
    return `${engineLabel(agent.cli)} ${suffix}`;
  }

  function agentIsWorking(agent) {
    return agent.cpu >= 0.1 || agent.kind === 'exec' || agent.kind === 'engine';
  }

  function agentStatus(agent) {
    return agentIsWorking(agent) ? 'Working' : 'Ready';
  }

  function agentActivity(agent) {
    if (agent.transcriptSummary) return agent.transcriptSummary;
    if (agent.kind && agent.elapsed) return `${agent.kind} · ${agent.elapsed}`;
    if (agent.command) return agent.command;
    return `${engineLabel(agent.cli)} process ${agent.pid}`;
  }

  function postToParent(type, detail = {}) {
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
    window.parent.postMessage({ type, ...detail }, targetOrigin);
  }

  function assignDesks(agents) {
    const desks = Array.from({ length: DESK_COUNT }, () => null);
    for (const agent of agents.slice().sort((a, b) => a.pid - b.pid)) {
      let deskIndex = Math.abs(agent.pid) % DESK_COUNT;
      let attempts = 0;
      while (desks[deskIndex] && attempts < DESK_COUNT) {
        deskIndex = (deskIndex + 1) % DESK_COUNT;
        attempts += 1;
      }
      if (attempts < DESK_COUNT) desks[deskIndex] = agent;
    }
    return desks;
  }

  function appendStaticDeskParts(button) {
    const surface = document.createElement('span');
    surface.className = 'desk-surface';
    const monitor = document.createElement('span');
    monitor.className = 'desk-monitor';
    const paper = document.createElement('span');
    paper.className = 'desk-paper';
    surface.append(monitor, paper);
    button.appendChild(surface);
  }

  function renderDesks() {
    elements.deskGrid.replaceChildren();
    const desks = assignDesks(state.agents);
    desks.forEach((agent, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'desk-seat';
      appendStaticDeskParts(button);

      const nameplate = document.createElement('span');
      nameplate.className = 'desk-nameplate';
      const name = document.createElement('strong');
      const status = document.createElement('small');

      if (agent) {
        button.classList.add('has-agent', `cli-${agent.cli}`);
        if (agentIsWorking(agent)) button.classList.add('is-working');
        if (state.selectedPid === agent.pid) button.classList.add('is-selected');
        button.setAttribute('aria-label', `${agentName(agent)}, ${agentStatus(agent)}. Select desk.`);
        button.setAttribute('aria-pressed', String(state.selectedPid === agent.pid));

        const avatar = document.createElement('span');
        avatar.className = 'agent-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        button.appendChild(avatar);
        name.textContent = agentName(agent);
        status.textContent = `${agentStatus(agent)} · ${agent.cpu.toFixed(1)}% CPU`;
        button.addEventListener('click', () => selectAgent(agent.pid));
      } else {
        button.disabled = true;
        button.setAttribute('aria-label', `Desk ${index + 1}, available`);
        name.textContent = `Desk ${String(index + 1).padStart(2, '0')}`;
        status.textContent = 'Available';
      }

      nameplate.append(name, status);
      button.appendChild(nameplate);
      elements.deskGrid.appendChild(button);
    });
  }

  function renderActivity() {
    elements.activityList.replaceChildren();
    for (const agent of state.agents) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `activity-item cli-${agent.cli}`;
      if (state.selectedPid === agent.pid) button.classList.add('is-selected');
      button.setAttribute('aria-label', `Inspect ${agentName(agent)}`);
      button.setAttribute('aria-pressed', String(state.selectedPid === agent.pid));

      const dot = document.createElement('span');
      dot.className = 'activity-dot';
      dot.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'activity-copy';
      const title = document.createElement('strong');
      title.textContent = agentName(agent);
      const summary = document.createElement('span');
      summary.textContent = agentActivity(agent);
      copy.append(title, summary);
      const cpu = document.createElement('span');
      cpu.className = 'activity-cpu';
      cpu.textContent = `${agent.cpu.toFixed(1)}%`;

      button.append(dot, copy, cpu);
      button.addEventListener('click', () => selectAgent(agent.pid));
      elements.activityList.appendChild(button);
    }
  }

  function selectedAgent() {
    return state.agents.find((agent) => agent.pid === state.selectedPid) || null;
  }

  function renderDetail() {
    const agent = selectedAgent();
    elements.detail.hidden = !agent;
    if (!agent) return;
    elements.detailTitle.textContent = agentName(agent);
    elements.detailState.textContent = agentStatus(agent);
    elements.detailEngine.textContent = `${engineLabel(agent.cli)} · ${agent.kind}`;
    elements.detailProcess.textContent = `PID ${agent.pid} · ${agent.cpu.toFixed(1)}% CPU · ${agent.mem.toFixed(1)}% MEM`;
    elements.detailElapsed.textContent = agent.elapsed || 'Unknown';
    elements.detailCwd.textContent = agent.cwd || state.projectPath || 'Unknown';
    elements.detailCwd.title = agent.cwd || state.projectPath || '';
    elements.detailSummary.textContent = agent.transcriptSummary || '';
  }

  function renderTerminalAction() {
    const agent = selectedAgent();
    const target = agent?.terminalTarget || null;
    const opening = Boolean(agent && state.openingPid === agent.pid);
    elements.openTerminal.disabled = !agent || !target || opening;
    elements.openTerminal.setAttribute('aria-busy', String(opening));

    if (!agent) {
      elements.openTerminalLabel.textContent = 'Select an agent terminal';
      elements.terminalStatus.textContent = '';
    } else if (opening) {
      elements.openTerminalLabel.textContent = `Opening ${agentName(agent)}…`;
      elements.terminalStatus.textContent = 'Resolving the managed terminal session…';
    } else if (!target) {
      elements.openTerminalLabel.textContent = 'Terminal unavailable';
      elements.terminalStatus.textContent =
        state.terminalResult ||
        agent.terminalUnavailableReason ||
        'This agent is not running in a Pixelbox-managed terminal.';
    } else {
      const targetLabel = target.kind === 'watchdog' ? 'runtime terminal' : 'terminal';
      elements.openTerminalLabel.textContent = `Open ${agentName(agent)} ${targetLabel}`;
      elements.terminalStatus.textContent = state.terminalResult;
    }

    elements.terminalStatus.classList.toggle('is-error', state.terminalResultIsError || Boolean(agent && !target));
  }

  function renderMetrics() {
    const engines = new Set(state.agents.map((agent) => agent.cli));
    const cpu = state.agents.reduce((total, agent) => total + agent.cpu, 0);
    elements.agentCount.textContent = String(state.agents.length);
    elements.engineCount.textContent = String(engines.size);
    elements.cpuTotal.textContent = `${cpu.toFixed(1)}%`;
  }

  function renderMessage() {
    const text = elements.message.querySelector('span:last-child');
    elements.message.classList.remove('is-error', 'is-empty');
    if (state.waiting) {
      elements.message.hidden = false;
      text.textContent = 'Scanning the selected project for active agents…';
      return;
    }
    if (state.error) {
      elements.message.hidden = false;
      elements.message.classList.add('is-error');
      text.textContent = state.error;
      return;
    }
    if (state.agents.length === 0) {
      elements.message.hidden = false;
      elements.message.classList.add('is-empty');
      text.textContent = 'The floor is quiet. Start an agent from the Pixelbox terminal to fill a desk.';
      return;
    }
    elements.message.hidden = true;
  }

  function updateRefreshLabel() {
    if (!state.refreshedAt) {
      elements.lastRefreshed.textContent = 'Waiting for first scan';
      return;
    }
    const refreshedAtMs = Date.parse(state.refreshedAt);
    if (!Number.isFinite(refreshedAtMs)) {
      elements.lastRefreshed.textContent = 'Last scan time unavailable';
      return;
    }
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - refreshedAtMs) / 1000));
    if (elapsedSeconds < 5) {
      elements.lastRefreshed.textContent = 'Updated just now';
    } else if (elapsedSeconds < 60) {
      elements.lastRefreshed.textContent = `Updated ${elapsedSeconds}s ago`;
    } else {
      elements.lastRefreshed.textContent = `Updated ${Math.floor(elapsedSeconds / 60)}m ago`;
    }
  }

  function renderStatus() {
    elements.floorStatus.classList.remove('is-live', 'is-error');
    if (state.error) {
      elements.floorStatus.classList.add('is-error');
      elements.floorStatusText.textContent = 'Monitor unavailable';
    } else if (state.waiting) {
      elements.floorStatusText.textContent = 'Connecting to Pixelbox…';
    } else {
      elements.floorStatus.classList.add('is-live');
      const count = state.agents.length;
      elements.floorStatusText.textContent = `${count} active agent${count === 1 ? '' : 's'}`;
    }
  }

  function render() {
    elements.projectLabel.textContent = state.projectLabel;
    elements.projectLabel.title = state.projectPath;
    renderMetrics();
    renderMessage();
    renderStatus();
    renderDesks();
    renderActivity();
    renderDetail();
    renderTerminalAction();
    updateRefreshLabel();
  }

  function selectAgent(pid) {
    state.selectedPid = Number(pid) || null;
    state.openingPid = null;
    state.terminalResult = '';
    state.terminalResultIsError = false;
    renderDesks();
    renderActivity();
    renderDetail();
    renderTerminalAction();
  }

  function receiveState(message) {
    const agents = Array.isArray(message.agents) ? message.agents.map(normalizeAgent).filter((agent) => agent.pid) : [];
    state.projectLabel = safeString(message.projectLabel, 100) || 'Workspace root';
    state.projectPath = safeString(message.projectPath, 220) || '.';
    state.agents = agents;
    state.refreshedAt = safeString(message.refreshedAt, 64);
    state.error = safeString(message.error, 300);
    state.waiting = false;
    elements.refresh.disabled = false;
    elements.refresh.removeAttribute('aria-busy');

    if (!state.agents.some((agent) => agent.pid === state.selectedPid)) {
      state.selectedPid = state.agents[0]?.pid || null;
    }
    render();
  }

  elements.refresh.addEventListener('click', () => {
    elements.refresh.disabled = true;
    elements.refresh.setAttribute('aria-busy', 'true');
    postToParent('munder:refresh');
  });

  elements.openTerminal.addEventListener('click', () => {
    const agent = selectedAgent();
    if (!agent?.terminalTarget) return;
    state.openingPid = agent.pid;
    state.terminalResult = '';
    state.terminalResultIsError = false;
    renderTerminalAction();
    postToParent('munder:open-terminal', { pid: agent.pid });
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
    if (event.data?.type === 'pixelbox:munder-state') {
      receiveState(event.data);
      return;
    }
    if (event.data?.type === 'pixelbox:munder-terminal-result') {
      const pid = Number(event.data.pid) || null;
      if (pid !== state.openingPid && pid !== state.selectedPid) return;
      state.openingPid = null;
      state.terminalResult = safeString(event.data.message, 220);
      state.terminalResultIsError = event.data.ok !== true;
      renderTerminalAction();
    }
  });

  window.addEventListener('keydown', (event) => {
    const isViewShortcut =
      !event.repeat &&
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'o';
    if (isViewShortcut) {
      event.preventDefault();
      postToParent('munder:show-project');
      return;
    }
    if (event.key === 'Escape' && state.selectedPid) {
      state.selectedPid = null;
      state.openingPid = null;
      state.terminalResult = '';
      state.terminalResultIsError = false;
      renderDesks();
      renderActivity();
      renderDetail();
      renderTerminalAction();
    }
  });

  window.setInterval(updateRefreshLabel, 5000);
  render();
  postToParent('munder:ready');
})();
