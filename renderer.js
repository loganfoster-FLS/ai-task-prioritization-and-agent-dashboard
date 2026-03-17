const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SERVICE_ORDER = ['openai', 'n8n', 'slack', 'asana', 'google']
const SERVICE_META = {
  openai: { label: 'AI', description: 'Switch between cloud and local models for ranking, summaries, and semantic retrieval.' },
  n8n: { label: 'n8n', description: 'Workflow engine for future automations and sync jobs.' },
  slack: { label: 'Slack', description: 'Messaging source for standups, blockers, and async follow-ups.' },
  asana: { label: 'Asana', description: 'Task source for due dates, ownership, and project priorities.' },
  google: { label: 'Google', description: 'Inbox and calendar context for daily planning.' },
}
const DEFAULT_STATE = {
  workspace: {
    themeMode: 'light',
    themeAccent: 'wind',
    theme: 'plain',
    adminMessages: [],
    adminTasks: [],
    vectorSummary: {
      documentCount: 0,
      lastIndexedAt: '',
      provider: '',
      model: '',
      requestedProvider: '',
      requestedModel: '',
      fingerprint: '',
      lastError: '',
    },
  },
  services: {
    openai: {
      connected: false,
      provider: 'openai',
      apiKey: '',
      organization: '',
      project: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      embeddingsModel: 'text-embedding-3-small',
      systemPrompt: 'You are a concise executive assistant. Prioritize urgent work, blockers, and items with immediate downstream impact.',
      lastTestedAt: '',
      lastModel: '',
      lastMessage: '',
    },
    n8n: {
      connected: false,
      url: '',
      apiKey: '',
      permissions: {
        readWorkflows: true,
        triggerWorkflows: true,
        executionHistory: true,
      },
    },
    slack: {
      connected: false,
      authStatus: 'not_configured',
      lastAuthError: '',
      lastAuthStep: 'Not configured',
      lastAuthAttemptAt: '',
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      botToken: '',
      standupChannel: '',
      workspaceName: '',
      teamId: '',
      authorizedUser: '',
      channelId: '',
      lastSyncAt: '',
      messagesPreview: [],
      permissions: {
        readChannelMessages: true,
        readDirectMessages: false,
        postMessages: true,
      },
    },
    asana: {
      connected: false,
      authStatus: 'not_configured',
      lastAuthError: '',
      lastAuthStep: 'Not configured',
      lastAuthAttemptAt: '',
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://127.0.0.1:3456/oauth/asana/callback',
      personalAccessToken: '',
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: '',
      workspaceGid: '',
      workspaceName: '',
      userName: '',
      email: '',
      lastSyncAt: '',
      tasksPreview: [],
      permissions: {
        assignedTasks: true,
        teamTasks: true,
        markTasksComplete: false,
      },
    },
    google: {
      connected: false,
      authStatus: 'not_configured',
      lastAuthError: '',
      lastAuthStep: 'Not configured',
      lastAuthAttemptAt: '',
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://127.0.0.1:3456/oauth/google/callback',
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: '',
      email: '',
      displayName: '',
      lastSyncAt: '',
      inboxPreview: [],
      calendarPreview: [],
      permissions: {
        gmailReadUnread: true,
        calendarToday: true,
        gmailSendReplies: false,
      },
    },
  },
}
const LOADING_STEPS = [
  'Preparing request…',
  'Blending synced app data with your notes…',
  'Querying semantic memory…',
  'Sending context to the selected model…',
  'Ranking the highest-value work…',
  'Formatting your top five…',
]

let APP_STATE = cloneState(DEFAULT_STATE)
let activeTab = 'openai'
let editing = false
let dragSrc = null
let latestPriorityResult = null

function cloneState(value) {
  return JSON.parse(JSON.stringify(value))
}

function mergeState(raw) {
  const merged = cloneState(DEFAULT_STATE)
  const sourceServices = raw && raw.services ? raw.services : {}
  const sourceWorkspace = raw && raw.workspace ? raw.workspace : {}

  merged.workspace = {
    ...merged.workspace,
    ...sourceWorkspace,
    themeMode: typeof sourceWorkspace.themeMode === 'string' ? sourceWorkspace.themeMode : merged.workspace.themeMode,
    themeAccent: typeof sourceWorkspace.themeAccent === 'string' ? sourceWorkspace.themeAccent : merged.workspace.themeAccent,
    theme: typeof sourceWorkspace.theme === 'string' ? sourceWorkspace.theme : merged.workspace.theme,
    adminMessages: Array.isArray(sourceWorkspace.adminMessages) ? sourceWorkspace.adminMessages : merged.workspace.adminMessages,
    adminTasks: Array.isArray(sourceWorkspace.adminTasks) ? sourceWorkspace.adminTasks : merged.workspace.adminTasks,
    vectorSummary: {
      ...merged.workspace.vectorSummary,
      ...(sourceWorkspace.vectorSummary || {}),
    },
  }

  if (!sourceWorkspace.themeMode && sourceWorkspace.theme) {
    if (sourceWorkspace.theme === 'star-trek') {
      merged.workspace.themeMode = 'dark'
      merged.workspace.themeAccent = 'wind'
    } else if (sourceWorkspace.theme === 'nature') {
      merged.workspace.themeMode = 'light'
      merged.workspace.themeAccent = 'nature'
    } else {
      merged.workspace.themeMode = 'light'
      merged.workspace.themeAccent = 'wind'
    }
  }

  SERVICE_ORDER.forEach((service) => {
    const defaults = merged.services[service]
    const incoming = sourceServices[service] || {}
    merged.services[service] = {
      ...defaults,
      ...incoming,
      permissions: {
        ...(defaults.permissions || {}),
        ...(incoming.permissions || {}),
      },
    }
  })

  return merged
}

function getAIProviderDefaults(provider) {
  if (provider === 'ollama') {
    return {
      baseURL: 'http://127.0.0.1:11434/api',
      model: 'gemma3:4b',
      embeddingsModel: 'embeddinggemma',
      label: 'Ollama',
    }
  }

  return {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    embeddingsModel: 'text-embedding-3-small',
    label: 'OpenAI',
  }
}

function aiProviderLabel(provider) {
  return provider === 'ollama' ? 'Ollama' : 'OpenAI'
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTimestamp(value) {
  if (!value) return 'Not synced yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

setInterval(tick, 1000)
tick()

const now = new Date()
document.getElementById('h-date').textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
document.getElementById('s-date').textContent = `${DAYS[now.getDay()].slice(0, 3).toUpperCase()} ${MSHORT[now.getMonth()].toUpperCase()} ${now.getDate()}`

function toggleEdit() {
  editing = !editing
  document.body.classList.toggle('editing', editing)
  const btn = document.getElementById('edit-btn')
  btn.classList.toggle('active', editing)
  btn.textContent = editing ? 'Done' : 'Edit Layout'
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.draggable = editing
  })
}

document.addEventListener('dragstart', (event) => {
  const panel = event.target.closest('.panel')
  if (!panel || !editing) return
  dragSrc = panel
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', panel.id)
  setTimeout(() => panel.classList.add('dragging'), 0)
})

document.addEventListener('dragend', () => {
  if (dragSrc) dragSrc.classList.remove('dragging')
  document.querySelectorAll('.panel-over').forEach((el) => el.classList.remove('panel-over'))
  document.querySelectorAll('.col-over').forEach((el) => el.classList.remove('col-over'))
  dragSrc = null
})

document.querySelectorAll('.dash-col').forEach((col) => {
  col.addEventListener('dragover', (event) => {
    if (!dragSrc) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const hoverPanel = event.target.closest('.panel')
    document.querySelectorAll('.panel-over').forEach((el) => el.classList.remove('panel-over'))
    document.querySelectorAll('.col-over').forEach((el) => el.classList.remove('col-over'))

    if (hoverPanel && hoverPanel !== dragSrc) {
      hoverPanel.classList.add('panel-over')
    } else {
      col.classList.add('col-over')
    }
  })

  col.addEventListener('dragleave', (event) => {
    if (!col.contains(event.relatedTarget)) {
      col.classList.remove('col-over')
    }
  })

  col.addEventListener('drop', (event) => {
    event.preventDefault()
    if (!dragSrc) return

    document.querySelectorAll('.panel-over').forEach((el) => el.classList.remove('panel-over'))
    document.querySelectorAll('.col-over').forEach((el) => el.classList.remove('col-over'))

    const hoverPanel = event.target.closest('.panel')
    if (hoverPanel && hoverPanel !== dragSrc) {
      const rect = hoverPanel.getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        col.insertBefore(dragSrc, hoverPanel)
      } else {
        col.insertBefore(dragSrc, hoverPanel.nextSibling)
      }
    } else {
      col.appendChild(dragSrc)
    }

    toast('Panel moved — save to keep')
  })
})

function saveLayout() {
  const layout = [...document.querySelectorAll('.dash-col')].map((col) => ({
    id: col.id,
    panels: [...col.querySelectorAll('.panel')].map((panel) => panel.id),
  }))
  localStorage.setItem('cmd-dash-v2', JSON.stringify(layout))
  toast('Layout saved')
}

function resetLayout() {
  localStorage.removeItem('cmd-dash-v2')
  location.reload()
}

;(function restoreLayout() {
  const saved = localStorage.getItem('cmd-dash-v2')
  if (!saved) return
  try {
    JSON.parse(saved).forEach(({ id, panels }) => {
      const col = document.getElementById(id)
      if (!col) return
      panels.forEach((panelId) => {
        const panel = document.getElementById(panelId)
        if (panel) col.appendChild(panel)
      })
    })
  } catch (_error) {}
})()

function serviceHasConfig(key) {
  const service = APP_STATE.services[key]
  const fieldsByService = {
    openai: ['provider', 'apiKey', 'model', 'embeddingsModel', 'baseURL', 'organization', 'project'],
    n8n: ['url', 'apiKey'],
    slack: ['botToken', 'standupChannel', 'clientId', 'redirectUri'],
    asana: ['clientId', 'clientSecret', 'personalAccessToken', 'workspaceGid'],
    google: ['clientId', 'redirectUri'],
  }
  return (fieldsByService[key] || []).some((field) => String(service[field] || '').trim())
}

function getServiceSetupState(serviceName) {
  const service = APP_STATE.services[serviceName] || {}

  switch (serviceName) {
    case 'google': {
      const missing = []
      if (!String(service.clientId || '').trim()) missing.push('Desktop Client ID')
      if (!String(service.redirectUri || '').trim()) missing.push('Redirect URI')
      if (String(service.redirectUri || '').trim() && !isLoopbackRedirect(String(service.redirectUri || '').trim())) {
        missing.push('Loopback Redirect URI')
      }
      return {
        ready: missing.length === 0,
        missing,
        message:
          missing.length === 0
            ? 'Google OAuth is configured and ready to open the browser sign-in page.'
            : `Google setup still needs: ${missing.join(', ')}.`,
      }
    }
    case 'asana': {
      const missing = []
      if (!String(service.clientId || '').trim()) missing.push('Client ID')
      if (!String(service.clientSecret || '').trim()) missing.push('Client Secret')
      if (!String(service.redirectUri || '').trim()) missing.push('Redirect URI')
      if (String(service.redirectUri || '').trim() && !isValidUrl(String(service.redirectUri || '').trim())) {
        missing.push('Valid Redirect URI')
      }
      return {
        ready: missing.length === 0,
        missing,
        message:
          missing.length === 0
            ? 'Asana OAuth is configured and ready to open the browser sign-in page.'
            : `Asana setup still needs: ${missing.join(', ')}.`,
      }
    }
    case 'slack': {
      const missing = []
      if (!String(service.clientId || '').trim()) missing.push('Client ID')
      if (!String(service.clientSecret || '').trim()) missing.push('Client Secret')
      if (!String(service.redirectUri || '').trim()) {
        missing.push('Hosted HTTPS Redirect URI')
      } else if (!isValidUrl(String(service.redirectUri || '').trim())) {
        missing.push('Valid HTTPS Redirect URI')
      } else if (!/^https:\/\//i.test(String(service.redirectUri || '').trim())) {
        missing.push('HTTPS Redirect URI')
      }
      return {
        ready: missing.length === 0,
        missing,
        message:
          missing.length === 0
            ? 'Slack OAuth is configured and ready to open the browser consent page.'
            : `Slack setup still needs: ${missing.join(', ')}.`,
      }
    }
    default:
      return {
        ready: true,
        missing: [],
        message: '',
      }
  }
}

function getConnectGuidance(serviceName) {
  switch (serviceName) {
    case 'google':
      return 'Google sign-in needs a Google OAuth desktop client ID and the loopback redirect shown in the form.'
    case 'asana':
      return 'Asana sign-in needs an Asana OAuth app with a client ID, client secret, and the redirect URI shown in the form.'
    case 'slack':
      return 'Slack sign-in needs a Slack app plus a hosted HTTPS redirect URI for the browser callback.'
    default:
      return 'Finish the setup fields for this provider first.'
  }
}

function isValidUrl(value) {
  try {
    new URL(value)
    return true
  } catch (_error) {
    return false
  }
}

function isLoopbackRedirect(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  } catch (_error) {
    return false
  }
}

function getAuthStatusPresentation(serviceName) {
  const service = APP_STATE.services[serviceName] || {}
  const setup = getServiceSetupState(serviceName)

  if (service.connected) {
    return {
      label: 'Connected',
      detail: buildServiceDetail(serviceName),
      icon: '✓',
      barClass: 'connected',
    }
  }

  if (service.lastAuthError) {
    const label =
      service.authStatus === 'auth_cancelled'
        ? 'Auth cancelled'
        : service.authStatus === 'waiting_for_callback'
          ? 'Waiting for callback'
          : service.lastAuthStep || 'Setup error'
    return {
      label,
      detail: service.lastAuthError,
      icon: '!',
      barClass: 'disconnected',
    }
  }

  if (!setup.ready) {
    return {
      label: 'Not configured',
      detail: setup.message,
      icon: '○',
      barClass: 'disconnected',
    }
  }

  if (service.authStatus === 'opening_browser') {
    return {
      label: 'Opening browser',
      detail: 'The sign-in page is opening in your default browser.',
      icon: '↗',
      barClass: 'disconnected',
    }
  }

  if (service.authStatus === 'opening_window') {
    return {
      label: 'Opening window',
      detail: 'The sign-in window is opening inside Dashboard.',
      icon: '◫',
      barClass: 'disconnected',
    }
  }

  if (service.authStatus === 'waiting_for_callback') {
    return {
      label: 'Waiting for callback',
      detail: 'Finish the sign-in flow, then return here after the provider redirects back.',
      icon: '…',
      barClass: 'disconnected',
    }
  }

  return {
    label: 'Ready to sign in',
    detail: setup.message,
    icon: '○',
    barClass: 'disconnected',
  }
}

async function copyFieldValue(fieldId, label = 'Value') {
  const field = document.getElementById(fieldId)
  const value = field ? String(field.value || '').trim() : ''
  if (!value) {
    toast(`${label} is empty`)
    return
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      field.focus()
      field.select()
      document.execCommand('copy')
    }
    toast(`${label} copied`)
  } catch (_error) {
    toast(`Could not copy ${label.toLowerCase()}`)
  }
}

function openAdminTasks() {
  return (APP_STATE.workspace.adminTasks || []).filter((task) => !task.completedAt)
}

function buildServiceDetail(key) {
  const service = APP_STATE.services[key]
  switch (key) {
    case 'openai': {
      const provider = aiProviderLabel(service.provider)
      if (service.connected) return `${provider} · ${service.lastModel || service.model} ready · last checked ${formatTimestamp(service.lastTestedAt)}`
      if (service.provider === 'ollama') {
        return `Local ${provider} ready to test at ${service.baseURL || getAIProviderDefaults('ollama').baseURL}.`
      }
      if (service.apiKey) return `${provider} key saved locally. Run a test request to verify the connection.`
      return `Choose ${provider} or Ollama, then save the model details to enable AI actions.`
    }
    case 'n8n':
      if (service.url) return `Instance: ${service.url}`
      return 'Workflow URL not saved yet.'
    case 'slack':
      if (service.connected) return `${service.workspaceName || 'Slack'} synced · ${service.standupChannel || 'no channel selected'} · ${formatTimestamp(service.lastSyncAt)}`
      if (service.botToken) return 'Bot token saved. Validate the token to pull channel messages.'
      if (service.clientId && service.redirectUri) return 'Browser OAuth is configured. Connect to launch Slack’s consent page.'
      return 'Slack OAuth is not configured yet.'
    case 'asana':
      if (service.connected) return `${service.workspaceName || 'Workspace ready'} · ${service.userName || 'Signed in'} · ${formatTimestamp(service.lastSyncAt)}`
      if (service.clientId || service.personalAccessToken) return 'Asana credentials saved. Sign in to open Asana in your browser and grant access.'
      return 'Asana OAuth is not configured yet.'
    case 'google':
      if (service.connected) return `${service.email || service.displayName || 'Google account'} synced · ${formatTimestamp(service.lastSyncAt)}`
      if (service.clientId) return `Google OAuth ready · browser sign-in will use ${service.redirectUri || 'your configured redirect'}`
      return 'Google desktop OAuth is not configured yet.'
    default:
      return SERVICE_META[key].description
  }
}

function syncHeaderDots() {
  SERVICE_ORDER.forEach((key) => {
    const dot = document.getElementById(`dot-${key}`)
    if (!dot) return
    dot.className = APP_STATE.services[key].connected ? 'h-dot on' : 'h-dot off'
  })
}

function syncTabDots() {
  SERVICE_ORDER.forEach((key) => {
    const dot = document.getElementById(`tdot-${key}`)
    if (!dot) return
    dot.style.background = APP_STATE.services[key].connected ? 'var(--green)' : 'var(--border-2)'
  })
}

function populateForms() {
  document.querySelectorAll('[data-service][data-field]').forEach((field) => {
    const { service, field: name } = field.dataset
    field.value = APP_STATE.services[service][name] || ''
  })
  document.querySelectorAll('[data-service][data-permission]').forEach((toggle) => {
    const { service, permission } = toggle.dataset
    toggle.classList.toggle('on', Boolean(APP_STATE.services[service].permissions[permission]))
  })
  document.getElementById('openai-last-response').textContent = APP_STATE.services.openai.lastMessage || 'No test has been run yet.'
}

function updateAIProviderUI() {
  const provider = APP_STATE.services.openai.provider === 'ollama' ? 'ollama' : 'openai'
  const defaults = getAIProviderDefaults(provider)
  const hideForOllama = provider === 'ollama'
  const toggleRow = (id, visible) => {
    const element = document.getElementById(id)
    if (element) element.style.display = visible ? 'block' : 'none'
  }

  toggleRow('row-openai-apiKey', !hideForOllama)
  toggleRow('row-openai-organization', !hideForOllama)
  toggleRow('row-openai-project', !hideForOllama)

  const heroName = document.getElementById('openai-hero-name')
  const heroDesc = document.getElementById('openai-hero-desc')
  const apiKeyHint = document.getElementById('openai-apiKey-hint')
  const modelHint = document.getElementById('openai-model-hint')
  const baseUrlHint = document.getElementById('openai-baseURL-hint')
  const vectorHint = document.getElementById('vector-summary-hint')
  const modelInput = document.getElementById('openai-model')
  const embeddingsInput = document.getElementById('openai-embeddingsModel')
  const baseURLInput = document.getElementById('openai-baseURL')

  if (heroName) heroName.textContent = provider === 'ollama' ? 'AI Models · Ollama' : 'AI Models · OpenAI'
  if (heroDesc) {
    heroDesc.textContent =
      provider === 'ollama'
        ? 'Use a local Ollama model for priority ranking while the dashboard keeps a lightweight semantic memory of your synced apps.'
        : 'Use OpenAI for ranking and retrieval while the dashboard keeps a lightweight semantic memory of your synced apps.'
  }
  if (apiKeyHint) apiKeyHint.textContent = 'Used for OpenAI requests only. Ollama runs locally without an API key.'
  if (modelHint) {
    modelHint.textContent =
      provider === 'ollama'
        ? 'Use any local Ollama chat model, for example gemma3:4b or the model name you installed.'
        : 'Default model for connection tests and daily priority ranking.'
  }
  if (baseUrlHint) {
    baseUrlHint.textContent =
      provider === 'ollama'
        ? 'Point this at your local Ollama API, usually http://127.0.0.1:11434/api.'
        : 'Leave the default unless you intentionally proxy OpenAI somewhere else.'
  }
  if (vectorHint) {
    vectorHint.textContent =
      provider === 'ollama'
        ? 'The semantic index will try Ollama embeddings first and fall back to a local hash vector if needed.'
        : 'The semantic index will try OpenAI embeddings first and fall back to a local hash vector if needed.'
  }
  if (modelInput) modelInput.placeholder = defaults.model
  if (embeddingsInput) embeddingsInput.placeholder = defaults.embeddingsModel
  if (baseURLInput) baseURLInput.placeholder = defaults.baseURL
}

function readFormsIntoState() {
  document.querySelectorAll('[data-service][data-field]').forEach((field) => {
    const { service, field: name } = field.dataset
    APP_STATE.services[service][name] = field.value
  })
  document.querySelectorAll('[data-service][data-permission]').forEach((toggle) => {
    const { service, permission } = toggle.dataset
    APP_STATE.services[service].permissions[permission] = toggle.classList.contains('on')
  })
}

function renderSummary() {
  const list = document.getElementById('summary-list')
  const connectedServices = SERVICE_ORDER.filter((key) => APP_STATE.services[key].connected)
  list.innerHTML = ''

  document.getElementById('summary-updated').textContent = connectedServices.length
    ? `${connectedServices.length} integration${connectedServices.length === 1 ? '' : 's'} ready`
    : 'No live integrations yet'

  if (!connectedServices.length && !openAdminTasks().length) {
    list.innerHTML = '<div class="empty-note">This shell is now free of canned people, emails, and fake tasks. Start by opening Integrations, saving your Google or Asana credentials, and connecting an AI provider for ranking.</div>'
  } else {
    openAdminTasks().slice(0, 2).forEach((task) => {
      const item = document.createElement('div')
      item.className = 'summary-item'
      item.innerHTML = `
        <div class="summary-mark configured"></div>
        <div>
          <div class="summary-title">Admin task</div>
          <div class="summary-copy">${escapeHtml(task.text)}</div>
        </div>
      `
      list.appendChild(item)
    })
    connectedServices.forEach((key) => {
      const item = document.createElement('div')
      item.className = 'summary-item'
      item.innerHTML = `
        <div class="summary-mark connected"></div>
        <div>
          <div class="summary-title">${escapeHtml(SERVICE_META[key].label)}</div>
          <div class="summary-copy">${escapeHtml(buildServiceDetail(key))}</div>
        </div>
      `
      list.appendChild(item)
    })
  }

  const digest = latestPriorityResult && latestPriorityResult.rationale
    ? latestPriorityResult.rationale
    : APP_STATE.services.openai.connected
      ? `${aiProviderLabel(APP_STATE.services.openai.provider)} is connected. Generate a ranked plan from your pasted notes plus any synced Google, Slack, or Asana data.`
      : 'No AI provider is connected yet. Save OpenAI or Ollama details in Integrations and run a test request.'
  document.getElementById('summary-digest-text').textContent = digest
}

function applyTheme() {
  const mode = APP_STATE.workspace.themeMode || 'light'
  const accent = APP_STATE.workspace.themeAccent || 'wind'
  document.body.setAttribute('data-mode', mode)
  document.body.setAttribute('data-accent', accent)
  const modeSelect = document.getElementById('theme-mode-select')
  const accentSelect = document.getElementById('theme-accent-select')
  if (modeSelect) modeSelect.value = mode
  if (accentSelect) accentSelect.value = accent
}

function renderServiceCards() {
  const list = document.getElementById('service-list')
  const connectedCount = SERVICE_ORDER.filter((key) => APP_STATE.services[key].connected).length
  document.getElementById('service-connected-count').textContent = `${connectedCount} connected`
  list.innerHTML = ''

  SERVICE_ORDER.forEach((key) => {
    const service = APP_STATE.services[key]
    const configured = serviceHasConfig(key)
    const modeClass = service.connected ? 'running' : configured ? 'queued' : 'idle'
    const statusClass = service.connected ? 'running' : configured ? 'queued' : 'idle'
    const statusLabel = service.connected ? 'Connected' : configured ? 'Configured' : 'Not set'
    const card = document.createElement('div')
    card.className = `agent-card ${modeClass}`
    card.innerHTML = `
      <div class="agent-row">
        <div class="agent-name">${escapeHtml(SERVICE_META[key].label)}</div>
        <div class="agent-status ${statusClass}"><div class="status-pip"></div> ${escapeHtml(statusLabel)}</div>
      </div>
      <div class="agent-desc">${escapeHtml(SERVICE_META[key].description)}</div>
      <div class="agent-foot">
        <div class="agent-last">${escapeHtml(buildServiceDetail(key))}</div>
        <button class="agent-btn" data-open-service="${escapeHtml(key)}">${service.connected || configured ? 'Manage' : 'Set up'}</button>
      </div>
    `
    list.appendChild(card)
  })
}

function renderOpenAIHelper() {
  const connectedSources = []
  if (APP_STATE.services.google.connected) connectedSources.push('Google')
  if (APP_STATE.services.asana.connected) connectedSources.push('Asana')
  if (APP_STATE.services.slack.connected) connectedSources.push('Slack')
  const provider = aiProviderLabel(APP_STATE.services.openai.provider)
  const vectors = APP_STATE.workspace.vectorSummary || {}
  const vectorNote = vectors.documentCount
    ? ` Semantic memory has ${vectors.documentCount} indexed item${vectors.documentCount === 1 ? '' : 's'}.`
    : ' Semantic memory will build after you sync a service.'
  const helper = document.getElementById('priority-helper')
  if (!APP_STATE.services.openai.connected) {
    helper.textContent = `Save your ${provider} connection details in Integrations, then paste your real work context here.${vectorNote}`
    return
  }
  if (connectedSources.length) {
    helper.textContent = `Using ${provider} ${APP_STATE.services.openai.lastModel || APP_STATE.services.openai.model}. This will include synced ${connectedSources.join(', ')} context along with anything you paste below.${vectorNote}`
  } else {
    helper.textContent = `Using ${provider} ${APP_STATE.services.openai.lastModel || APP_STATE.services.openai.model}. Paste your real context and generate a ranked plan.${vectorNote}`
  }
}

function renderVectorSummary() {
  const summary = APP_STATE.workspace.vectorSummary || {}
  const container = document.getElementById('vector-summary')
  if (!container) return

  if (!summary.documentCount) {
    container.textContent = 'No semantic memory has been built yet. Sync Google, Asana, or Slack, then reindex.'
    return
  }

  const provider = summary.provider === 'local-hash' ? 'Local hash fallback' : aiProviderLabel(summary.provider)
  const message = [
    `${summary.documentCount} indexed item${summary.documentCount === 1 ? '' : 's'}`,
    `${provider}${summary.model ? ` · ${summary.model}` : ''}`,
    summary.lastIndexedAt ? `updated ${formatTimestamp(summary.lastIndexedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  container.textContent = summary.lastError ? `${message} · fallback reason: ${summary.lastError}` : message
}

function renderPreviewList(items, renderer, emptyText) {
  if (!items || !items.length) return escapeHtml(emptyText)
  return `<div class="preview-list">${items.map(renderer).join('')}</div>`
}

function renderSlackPreview() {
  const service = APP_STATE.services.slack
  document.getElementById('preview-slack').innerHTML = renderPreviewList(
    service.messagesPreview,
    (item) => `
      <div class="preview-item">
        <div class="preview-title">${escapeHtml(item.user || 'User')}</div>
        <div class="preview-meta">${escapeHtml(service.standupChannel || 'Slack channel')} · ${escapeHtml(formatShortDate(item.ts ? Number(item.ts) * 1000 : ''))}</div>
        <div class="preview-copy">${escapeHtml(item.text)}</div>
      </div>
    `,
    'No Slack data loaded yet.'
  )
}

function renderAsanaPreview() {
  const service = APP_STATE.services.asana
  document.getElementById('preview-asana').innerHTML = renderPreviewList(
    service.tasksPreview,
    (item) => `
      <div class="preview-item">
        <div class="preview-title">${escapeHtml(item.name)}</div>
        <div class="preview-meta">${escapeHtml(item.dueOn || 'No due date')}${item.projectNames && item.projectNames.length ? ` · ${escapeHtml(item.projectNames.join(', '))}` : ''}</div>
        <div class="preview-copy">${item.permalinkUrl ? `<a href="${escapeHtml(item.permalinkUrl)}" target="_blank">Open in Asana</a>` : 'Loaded from your assigned tasks.'}</div>
      </div>
    `,
    'No Asana data loaded yet.'
  )
}

function renderGooglePreview() {
  const service = APP_STATE.services.google
  const inbox = renderPreviewList(
    service.inboxPreview,
    (item) => `
      <div class="preview-item">
        <div class="preview-title">${escapeHtml(item.subject)}</div>
        <div class="preview-meta">${escapeHtml(item.from)}</div>
        <div class="preview-copy">${escapeHtml(item.snippet)}</div>
      </div>
    `,
    'No Gmail preview loaded yet.'
  )
  const calendar = renderPreviewList(
    service.calendarPreview,
    (item) => `
      <div class="preview-item">
        <div class="preview-title">${escapeHtml(item.title)}</div>
        <div class="preview-meta">${escapeHtml(formatShortDate(item.start))}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</div>
        <div class="preview-copy">${escapeHtml(item.end ? `Ends ${formatShortDate(item.end)}` : 'Calendar event')}</div>
      </div>
    `,
    'No Calendar preview loaded yet.'
  )
  document.getElementById('preview-google').innerHTML = `<div class="preview-list"><div class="preview-copy"><strong>Inbox</strong></div>${inbox}<div class="preview-copy" style="margin-top:8px"><strong>Calendar</strong></div>${calendar}</div>`
}

function renderBriefingFeed() {
  const sections = []
  if (APP_STATE.services.google.inboxPreview.length) {
    sections.push('<div class="preview-copy"><strong>Unread Gmail</strong></div>')
    sections.push(
      renderPreviewList(
        APP_STATE.services.google.inboxPreview.slice(0, 3),
        (item) => `
          <div class="preview-item">
            <div class="preview-title">${escapeHtml(item.subject)}</div>
            <div class="preview-meta">${escapeHtml(item.from)}</div>
            <div class="preview-copy">${escapeHtml(item.snippet)}</div>
          </div>
        `,
        ''
      )
    )
  }
  if (APP_STATE.services.google.calendarPreview.length) {
    sections.push('<div class="preview-copy" style="margin-top:8px"><strong>Today&apos;s calendar</strong></div>')
    sections.push(
      renderPreviewList(
        APP_STATE.services.google.calendarPreview.slice(0, 3),
        (item) => `
          <div class="preview-item">
            <div class="preview-title">${escapeHtml(item.title)}</div>
            <div class="preview-meta">${escapeHtml(formatShortDate(item.start))}</div>
            <div class="preview-copy">${escapeHtml(item.location || 'No location')}</div>
          </div>
        `,
        ''
      )
    )
  }
  if (APP_STATE.services.asana.tasksPreview.length) {
    sections.push('<div class="preview-copy" style="margin-top:8px"><strong>Asana tasks</strong></div>')
    sections.push(
      renderPreviewList(
        APP_STATE.services.asana.tasksPreview.slice(0, 3),
        (item) => `
          <div class="preview-item">
            <div class="preview-title">${escapeHtml(item.name)}</div>
            <div class="preview-meta">${escapeHtml(item.dueOn || 'No due date')}</div>
            <div class="preview-copy">${escapeHtml((item.projectNames || []).join(', ') || 'Assigned task')}</div>
          </div>
        `,
        ''
      )
    )
  }
  if (APP_STATE.services.slack.messagesPreview.length) {
    sections.push('<div class="preview-copy" style="margin-top:8px"><strong>Slack highlights</strong></div>')
    sections.push(
      renderPreviewList(
        APP_STATE.services.slack.messagesPreview.slice(0, 3),
        (item) => `
          <div class="preview-item">
            <div class="preview-title">${escapeHtml(item.user || 'User')}</div>
            <div class="preview-meta">${escapeHtml(APP_STATE.services.slack.standupChannel || 'Slack')}</div>
            <div class="preview-copy">${escapeHtml(item.text)}</div>
          </div>
        `,
        ''
      )
    )
  }
  document.getElementById('briefing-feed').innerHTML = sections.length
    ? sections.join('')
    : '<div class="empty-note">Sync Google, Asana, or Slack to turn this panel into a live briefing feed.</div>'
}

function renderAdminDesk() {
  const tasks = APP_STATE.workspace.adminTasks || []
  const openTasks = tasks.filter((task) => !task.completedAt)
  const doneTasks = tasks.filter((task) => task.completedAt)
  document.getElementById('admin-tasks-list').innerHTML = [
    openTasks.length
      ? openTasks
          .map(
            (task) => `
              <div class="preview-item">
                <div class="preview-title">${escapeHtml(task.text)}</div>
                <div class="preview-meta">Pinned ${escapeHtml(formatTimestamp(task.createdAt))}</div>
                <div class="config-actions">
                  <button class="btn primary" data-admin-complete="${escapeHtml(task.id)}">Mark done</button>
                </div>
              </div>
            `
          )
          .join('')
      : '<div class="empty-note">No pinned admin tasks yet.</div>',
    doneTasks.length
      ? `<div class="preview-copy" style="margin-top:10px"><strong>Completed</strong></div>${doneTasks
          .slice(-3)
          .reverse()
          .map(
            (task) => `
              <div class="preview-item">
                <div class="preview-title" style="text-decoration:line-through;color:var(--text-3)">${escapeHtml(task.text)}</div>
                <div class="preview-meta">Completed ${escapeHtml(formatTimestamp(task.completedAt))}</div>
              </div>
            `
          )
          .join('')}`
      : '',
  ].join('')

  const messages = APP_STATE.workspace.adminMessages || []
  document.getElementById('admin-chat-list').innerHTML = messages.length
    ? messages
        .slice()
        .reverse()
        .map(
          (message) => `
            <div class="preview-item">
              <div class="preview-title">${escapeHtml(message.role === 'admin' ? 'Admin' : 'You')}</div>
              <div class="preview-meta">${escapeHtml(formatTimestamp(message.createdAt))}</div>
              <div class="preview-copy">${escapeHtml(message.text)}</div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-note">Your admin conversation will live here.</div>'
}

function renderAdminPriorityList() {
  const openTasks = openAdminTasks()
  const container = document.getElementById('admin-priority-list')
  if (!openTasks.length) {
    container.innerHTML = ''
    return
  }
  container.innerHTML = `
    <div class="config-section-title">Pinned Admin Tasks</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${openTasks
        .map(
          (task, index) => `
            <div class="priority-card">
              <div class="priority-rank">${index + 1}</div>
              <div class="p-check" data-admin-complete="${escapeHtml(task.id)}"></div>
              <div class="p-body">
                <div class="p-title">${escapeHtml(task.text)}</div>
                <div class="p-why">Pinned from Admin Desk until completed.</div>
                <div class="p-meta">
                  <span class="p-src src-asana">Admin</span>
                  <span class="p-due urgent">Top priority</span>
                </div>
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `
}

function updateStatusBars() {
  SERVICE_ORDER.forEach((key) => {
    const service = APP_STATE.services[key]
    const presentation = ['google', 'asana', 'slack'].includes(key)
      ? getAuthStatusPresentation(key)
      : {
          label: service.connected ? 'Connected' : 'Not connected',
          detail: buildServiceDetail(key),
          icon: service.connected ? '✓' : '○',
          barClass: service.connected ? 'connected' : 'disconnected',
        }
    const bar = document.getElementById(`status-${key}`)
    const label = document.getElementById(`status-label-${key}`)
    const detail = document.getElementById(`status-detail-${key}`)
    const icon = document.getElementById(`status-icon-${key}`)
    if (!bar || !label || !detail || !icon) return
    bar.className = `int-status-bar ${presentation.barClass}`
    label.textContent = presentation.label
    detail.textContent = presentation.detail
    icon.textContent = presentation.icon
  })

  const toggleVisibility = (id, visible) => {
    const el = document.getElementById(id)
    if (el) el.style.display = visible ? 'inline-flex' : 'none'
  }
  toggleVisibility('openai-disconnect-btn', APP_STATE.services.openai.connected)
  toggleVisibility('slack-disconnect-btn', APP_STATE.services.slack.connected)
  toggleVisibility('asana-disconnect-btn', APP_STATE.services.asana.connected)
  toggleVisibility('google-disconnect-btn', APP_STATE.services.google.connected)

  ;['google', 'asana', 'slack'].forEach((serviceName) => {
    const service = APP_STATE.services[serviceName]
    const state = getServiceSetupState(serviceName)
    const connectButton = document.getElementById(`${serviceName}-connect-btn`)
    const syncButton = document.getElementById(`${serviceName}-sync-btn`)
    const helper = document.getElementById(`${serviceName}-setup-helper`)
    if (connectButton) {
      connectButton.disabled = !state.ready
      connectButton.classList.toggle('disabled', !state.ready)
      connectButton.title = state.ready ? '' : getConnectGuidance(serviceName)
    }
    if (syncButton) {
      syncButton.disabled = !service.connected
      syncButton.classList.toggle('disabled', !service.connected)
    }
    if (helper) {
      helper.textContent = service.connected ? buildServiceDetail(serviceName) : service.lastAuthError || state.message
    }
  })

  const n8nToggle = document.getElementById('toggle-btn-n8n')
  if (n8nToggle) {
    n8nToggle.className = `connect-btn ${APP_STATE.services.n8n.connected ? 'do-disconnect' : 'do-connect'}`
    n8nToggle.textContent = APP_STATE.services.n8n.connected ? 'Disconnect' : 'Mark connected'
  }
}

function renderApp() {
  applyTheme()
  populateForms()
  updateAIProviderUI()
  updateStatusBars()
  syncHeaderDots()
  syncTabDots()
  renderSummary()
  renderServiceCards()
  renderOpenAIHelper()
  renderVectorSummary()
  renderSlackPreview()
  renderAsanaPreview()
  renderGooglePreview()
  renderBriefingFeed()
  renderAdminDesk()
  renderAdminPriorityList()
}

async function setThemeMode(mode) {
  APP_STATE.workspace.themeMode = mode || 'light'
  try {
    await persistSettings({ toastMessage: `${APP_STATE.workspace.themeMode} palette applied` })
  } catch (error) {
    toast(error.message || 'Could not save palette')
  }
}

async function setThemeAccent(accent) {
  APP_STATE.workspace.themeAccent = accent || 'wind'
  try {
    await persistSettings({ toastMessage: `${APP_STATE.workspace.themeAccent} accent applied` })
  } catch (error) {
    toast(error.message || 'Could not save accent')
  }
}

async function setAIProvider(provider) {
  const nextProvider = provider === 'ollama' ? 'ollama' : 'openai'
  const previousDefaults = getAIProviderDefaults(APP_STATE.services.openai.provider)
  const nextDefaults = getAIProviderDefaults(nextProvider)

  APP_STATE.services.openai.provider = nextProvider

  if (!String(APP_STATE.services.openai.baseURL || '').trim() || APP_STATE.services.openai.baseURL === previousDefaults.baseURL) {
    APP_STATE.services.openai.baseURL = nextDefaults.baseURL
  }
  if (!String(APP_STATE.services.openai.model || '').trim() || APP_STATE.services.openai.model === previousDefaults.model) {
    APP_STATE.services.openai.model = nextDefaults.model
  }
  if (
    !String(APP_STATE.services.openai.embeddingsModel || '').trim() ||
    APP_STATE.services.openai.embeddingsModel === previousDefaults.embeddingsModel
  ) {
    APP_STATE.services.openai.embeddingsModel = nextDefaults.embeddingsModel
  }

  renderApp()

  try {
    await persistSettings({ toastMessage: `${aiProviderLabel(nextProvider)} selected` })
  } catch (error) {
    toast(error.message || 'Could not save AI provider')
  }
}

function showState(id) {
  ['state-loading', 'state-error', 'state-results', 'state-empty'].forEach((stateId) => {
    document.getElementById(stateId).style.display = stateId === id ? 'block' : 'none'
  })
}

function renderPriorities(data) {
  latestPriorityResult = data
  document.getElementById('p-rationale').textContent = data.rationale || ''
  const list = document.getElementById('p-list')
  list.innerHTML = ''
  const srcMap = { context: 'Context', slack: 'Slack', asana: 'Asana', google: 'Google', calendar: 'Calendar', n8n: 'n8n' }
  const classMap = { context: 'src-calendar', slack: 'src-slack', asana: 'src-asana', google: 'src-gmail', calendar: 'src-calendar', n8n: 'src-slack' }
  ;(data.tasks || []).slice(0, 5).forEach((task, index) => {
    const dueClass = task.urgency === 'urgent' ? 'urgent' : task.urgency === 'soon' ? 'soon' : ''
    const card = document.createElement('div')
    card.className = 'priority-card'
    card.style.animationDelay = `${index * 0.07}s`
    card.innerHTML = `
      <div class="priority-rank">${escapeHtml(task.rank)}</div>
      <div class="p-check" onclick="checkPriority(this)"></div>
      <div class="p-body">
        <div class="p-title">${escapeHtml(task.title)}</div>
        <div class="p-why">${escapeHtml(task.why)}</div>
        <div class="p-meta">
          <span class="p-src ${classMap[task.source] || 'src-calendar'}">${escapeHtml(srcMap[task.source] || task.source)}</span>
          ${task.due ? `<span class="p-due ${dueClass}">${escapeHtml(task.due)}</span>` : ''}
        </div>
      </div>
    `
    list.appendChild(card)
  })
  showState('state-results')
  renderSummary()
}

function checkPriority(el) {
  el.classList.toggle('done')
  el.textContent = el.classList.contains('done') ? '✓' : ''
  el.closest('.priority-card').querySelector('.p-title').classList.toggle('done')
}

async function persistSettings(options = {}) {
  readFormsIntoState()
  ;['google', 'asana', 'slack'].forEach((serviceName) => {
    const service = APP_STATE.services[serviceName]
    if (service && !service.connected) {
      const setup = getServiceSetupState(serviceName)
      service.lastAuthError = ''
      service.authStatus = setup.ready ? 'ready_to_sign_in' : 'not_configured'
      service.lastAuthStep = setup.ready ? 'Ready to sign in' : 'Not configured'
    }
  })
  const saved = await window.dashboardApi.saveSettings(APP_STATE)
  APP_STATE = mergeState(saved)
  renderApp()
  if (options.toastMessage) toast(options.toastMessage)
}

async function saveIntegration() {
  try {
    await persistSettings({ toastMessage: 'Integration settings saved' })
    closeSettings()
  } catch (error) {
    toast(error.message || 'Could not save settings')
  }
}

function openSettings(tab) {
  document.getElementById('settings-overlay').classList.add('open')
  document.getElementById('settings-drawer').classList.add('open')
  switchTab(tab || activeTab)
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open')
  document.getElementById('settings-drawer').classList.remove('open')
}

function switchTab(key) {
  activeTab = key
  document.querySelectorAll('.int-tab').forEach((tab) => tab.classList.remove('active'))
  document.querySelectorAll('.int-pane').forEach((pane) => pane.classList.remove('active'))
  document.getElementById(`tab-${key}`).classList.add('active')
  document.getElementById(`pane-${key}`).classList.add('active')
}

async function toggleConnection(key) {
  readFormsIntoState()
  APP_STATE.services[key].connected = !APP_STATE.services[key].connected
  try {
    await persistSettings({ toastMessage: `${SERVICE_META[key].label} ${APP_STATE.services[key].connected ? 'connected' : 'disconnected'}` })
  } catch (error) {
    APP_STATE.services[key].connected = !APP_STATE.services[key].connected
    renderApp()
    toast(error.message || 'Could not update connection')
  }
}

async function disconnectOpenAI() {
  try {
    const saved = await window.dashboardApi.disconnectService('openai')
    APP_STATE = mergeState(saved)
    renderApp()
    toast('AI provider disconnected')
  } catch (error) {
    toast(error.message || 'Could not disconnect the AI provider')
  }
}

async function disconnectService(serviceName) {
  try {
    const saved = await window.dashboardApi.disconnectService(serviceName)
    APP_STATE = mergeState(saved)
    renderApp()
    toast(`${SERVICE_META[serviceName].label} disconnected`)
  } catch (error) {
    toast(error.message || `Could not disconnect ${SERVICE_META[serviceName].label}`)
  }
}

async function withButtonState(buttonId, busyLabel, task) {
  const button = document.getElementById(buttonId)
  const original = button ? button.textContent : ''
  if (button) {
    button.disabled = true
    button.textContent = busyLabel
  }
  try {
    return await task()
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = original
    }
  }
}

async function testOpenAI() {
  readFormsIntoState()
  try {
    const result = await withButtonState('openai-test-btn', 'Testing…', () =>
      window.dashboardApi.testOpenAI({ ...APP_STATE.services.openai, persist: true })
    )
    APP_STATE.services.openai.connected = true
    APP_STATE.services.openai.provider = APP_STATE.services.openai.provider || result.provider || 'openai'
    APP_STATE.services.openai.lastTestedAt = result.testedAt
    APP_STATE.services.openai.lastModel = result.model
    APP_STATE.services.openai.lastMessage = result.outputText
    await persistSettings()
    toast(`${result.providerLabel || aiProviderLabel(APP_STATE.services.openai.provider)} connected`)
  } catch (error) {
    toast(error.message || 'AI test failed')
  }
}

async function reindexVectors() {
  try {
    const saved = await withButtonState('vector-reindex-btn', 'Reindexing…', () => window.dashboardApi.reindexVectors())
    APP_STATE = mergeState(saved)
    renderApp()
    toast('Semantic memory refreshed')
  } catch (error) {
    toast(error.message || 'Could not refresh semantic memory')
  }
}

async function connectService(serviceName) {
  const buttonMap = { google: 'google-connect-btn', asana: 'asana-connect-btn', slack: 'slack-connect-btn' }
  const setupState = getServiceSetupState(serviceName)
  if (!setupState.ready) {
    toast(getConnectGuidance(serviceName))
    return
  }
  try {
    await persistSettings()
    const saved = await withButtonState(buttonMap[serviceName], 'Opening…', () => window.dashboardApi.connectService(serviceName))
    APP_STATE = mergeState(saved)
    renderApp()
    toast(`${SERVICE_META[serviceName].label} connected`)
  } catch (error) {
    try {
      APP_STATE = mergeState(await window.dashboardApi.getSettings())
      renderApp()
    } catch (_reloadError) {}
    toast(error.message || `Could not connect ${SERVICE_META[serviceName].label}`)
  }
}

async function syncService(serviceName) {
  const buttonMap = { slack: 'slack-sync-btn', asana: 'asana-sync-btn', google: 'google-sync-btn' }
  try {
    await persistSettings()
    const saved = await withButtonState(buttonMap[serviceName], 'Syncing…', () => window.dashboardApi.syncService(serviceName))
    APP_STATE = mergeState(saved)
    renderApp()
    toast(`${SERVICE_META[serviceName].label} synced`)
  } catch (error) {
    try {
      APP_STATE = mergeState(await window.dashboardApi.getSettings())
      renderApp()
    } catch (_reloadError) {}
    toast(error.message || `Could not sync ${SERVICE_META[serviceName].label}`)
  }
}

function addAdminReply(text) {
  APP_STATE.workspace.adminMessages.push({
    id: randomId(),
    role: 'admin',
    text,
    createdAt: new Date().toISOString(),
  })
}

function addAdminTask(text) {
  APP_STATE.workspace.adminTasks.unshift({
    id: randomId(),
    text,
    createdAt: new Date().toISOString(),
    completedAt: '',
  })
}

async function submitAdminMessage(pinTask) {
  const input = document.getElementById('admin-message-input')
  const text = input.value.trim()
  if (!text) {
    toast('Add a message first')
    return
  }
  APP_STATE.workspace.adminMessages.push({
    id: randomId(),
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
  })
  if (pinTask) {
    addAdminTask(text)
    addAdminReply('Pinned at the top of your priorities until you mark it done.')
  } else {
    addAdminReply('Logged in the Admin Desk conversation.')
  }
  input.value = ''
  await persistSettings({ toastMessage: pinTask ? 'Admin task pinned' : 'Admin note saved' })
}

async function markAdminTaskDone(taskId) {
  const task = APP_STATE.workspace.adminTasks.find((item) => item.id === taskId)
  if (!task) return
  task.completedAt = new Date().toISOString()
  addAdminReply(`Marked "${task.text}" done.`)
  await persistSettings({ toastMessage: 'Admin task completed' })
}

async function runPriorityAI() {
  readFormsIntoState()
  const context = document.getElementById('priority-context').value.trim()
  const hasSyncedContext = APP_STATE.services.google.connected || APP_STATE.services.asana.connected || APP_STATE.services.slack.connected || openAdminTasks().length
  if (!context && !hasSyncedContext) {
    toast('Paste some context or sync a service first')
    showState('state-empty')
    return
  }
  showState('state-loading')
  const btn = document.getElementById('refresh-btn')
  btn.disabled = true
  btn.textContent = 'Working…'
  const label = document.getElementById('loading-lbl')
  let step = 0
  const timer = setInterval(() => {
    label.textContent = LOADING_STEPS[step % LOADING_STEPS.length]
    step += 1
  }, 700)
  try {
    const result = await window.dashboardApi.generatePriorities({ context, openai: APP_STATE.services.openai })
    clearInterval(timer)
    APP_STATE.services.openai.connected = true
    APP_STATE.services.openai.provider = result.provider || APP_STATE.services.openai.provider
    APP_STATE.services.openai.lastTestedAt = result.generatedAt
    APP_STATE.services.openai.lastModel = result.model
    APP_STATE.services.openai.lastMessage = result.data.rationale || APP_STATE.services.openai.lastMessage
    if (result.vectorSummary) {
      APP_STATE.workspace.vectorSummary = {
        ...APP_STATE.workspace.vectorSummary,
        ...result.vectorSummary,
      }
    }
    renderApp()
    renderPriorities(result.data)
    document.getElementById('priority-ts').textContent = `Updated ${new Date(result.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
    toast(`${result.providerLabel || aiProviderLabel(APP_STATE.services.openai.provider)} ranked your day${result.retrievedCount ? ` with ${result.retrievedCount} semantic match${result.retrievedCount === 1 ? '' : 'es'}` : ''}`)
  } catch (error) {
    clearInterval(timer)
    showState('state-error')
    document.getElementById('error-msg').textContent = error.message || 'Something went wrong.'
  } finally {
    btn.disabled = false
    btn.textContent = 'Generate'
  }
}

function toast(message) {
  const toastEl = document.getElementById('toast')
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastEl._timeout)
  toastEl._timeout = setTimeout(() => toastEl.classList.remove('show'), 2200)
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettings()
})

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-service][data-permission]').forEach((toggle) => {
    toggle.addEventListener('click', () => toggle.classList.toggle('on'))
  })
  document.getElementById('service-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-service]')
    if (!button) return
    openSettings(button.dataset.openService)
  })
  document.body.addEventListener('click', (event) => {
    const adminButton = event.target.closest('[data-admin-complete]')
    if (adminButton) {
      markAdminTaskDone(adminButton.dataset.adminComplete)
    }
  })
  SERVICE_ORDER.forEach((key) => {
    const pill = document.getElementById(`pill-${key}`)
    if (pill) pill.addEventListener('click', () => openSettings(key))
  })
  document.getElementById('settings-overlay').addEventListener('click', () => closeSettings())

  try {
    if (window.dashboardApi) {
      const settings = await window.dashboardApi.getSettings()
      APP_STATE = mergeState(settings)
    }
  } catch (error) {
    toast(error.message || 'Could not load saved settings')
  }

  renderApp()
  showState('state-empty')
})
