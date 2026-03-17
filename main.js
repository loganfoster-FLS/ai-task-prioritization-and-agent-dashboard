const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const DEFAULT_SETTINGS = {
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
  },
}

let mainWindow = null

const SECRET_FIELDS = {
  n8n: ['apiKey'],
  slack: ['clientSecret', 'botToken'],
  asana: ['clientSecret', 'personalAccessToken', 'accessToken', 'refreshToken'],
  google: ['clientSecret', 'accessToken', 'refreshToken'],
  openai: ['apiKey'],
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'dashboard-settings.json')
}

function protectSecret(value) {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return { type: 'plain', value }
  }

  return {
    type: 'safe',
    value: safeStorage.encryptString(value).toString('base64'),
  }
}

function revealSecret(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value.type === 'plain') return value.value || ''
  if (value.type === 'safe' && value.value) {
    try {
      return safeStorage.decryptString(Buffer.from(value.value, 'base64'))
    } catch (_error) {
      return ''
    }
  }
  return ''
}

function mergeSettings(raw) {
  const merged = cloneDefaults()
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

  Object.keys(merged.services).forEach((service) => {
    const defaults = merged.services[service]
    const incoming = sourceServices[service] || {}

    merged.services[service] = {
      ...defaults,
      ...incoming,
      permissions: {
        ...defaults.permissions,
        ...(incoming.permissions || {}),
      },
    }
  })

  return merged
}

function decodeSecrets(raw) {
  const merged = mergeSettings(raw)

  Object.entries(SECRET_FIELDS).forEach(([service, fields]) => {
    fields.forEach((field) => {
      merged.services[service][field] = revealSecret(merged.services[service][field])
    })
  })

  return merged
}

function encodeSecrets(settings) {
  const merged = mergeSettings(settings)

  Object.entries(SECRET_FIELDS).forEach(([service, fields]) => {
    fields.forEach((field) => {
      merged.services[service][field] = protectSecret(merged.services[service][field])
    })
  })

  return merged
}

function readSettings() {
  try {
    if (!fs.existsSync(getSettingsPath())) {
      return cloneDefaults()
    }

    const raw = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))
    return decodeSecrets(raw)
  } catch (_error) {
    return cloneDefaults()
  }
}

function writeSettings(settings) {
  const merged = mergeSettings(settings)
  const payload = encodeSecrets(merged)
  const target = getSettingsPath()

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(payload, null, 2))

  return merged
}

function markServiceAuthState(settings, serviceName, nextState = {}) {
  if (!settings.services[serviceName]) return settings

  settings.services[serviceName] = {
    ...settings.services[serviceName],
    authStatus: nextState.authStatus || settings.services[serviceName].authStatus || 'not_configured',
    lastAuthStep: nextState.lastAuthStep || settings.services[serviceName].lastAuthStep || 'Not configured',
    lastAuthError:
      nextState.lastAuthError !== undefined ? nextState.lastAuthError : settings.services[serviceName].lastAuthError || '',
    lastAuthAttemptAt:
      nextState.lastAuthAttemptAt !== undefined
        ? nextState.lastAuthAttemptAt
        : settings.services[serviceName].lastAuthAttemptAt || '',
  }

  return settings
}

function clearServiceAuthError(settings, serviceName) {
  return markServiceAuthState(settings, serviceName, { lastAuthError: '' })
}

function isLoopbackRedirectUri(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  } catch (_error) {
    return false
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

function getServiceSetupValidation(settings, serviceName) {
  const service = settings.services[serviceName]
  const missing = []

  switch (serviceName) {
    case 'google':
      if (!service.clientId) missing.push('Desktop Client ID')
      if (!service.redirectUri) missing.push('Redirect URI')
      if (service.redirectUri && !isLoopbackRedirectUri(service.redirectUri)) missing.push('Loopback Redirect URI')
      break
    case 'asana':
      if (!service.clientId) missing.push('Client ID')
      if (!service.clientSecret) missing.push('Client Secret')
      if (!service.redirectUri) missing.push('Redirect URI')
      if (service.redirectUri && !isValidUrl(service.redirectUri)) missing.push('Valid Redirect URI')
      break
    case 'slack':
      if (!service.clientId) missing.push('Client ID')
      if (!service.clientSecret) missing.push('Client Secret')
      if (!service.redirectUri) {
        missing.push('Hosted HTTPS Redirect URI')
      } else if (!isValidUrl(service.redirectUri)) {
        missing.push('Valid HTTPS Redirect URI')
      } else if (!String(service.redirectUri).startsWith('https://')) {
        missing.push('HTTPS Redirect URI')
      }
      break
    default:
      break
  }

  return {
    ready: missing.length === 0,
    missing,
  }
}

function randomString(size = 32) {
  return crypto.randomBytes(size).toString('hex')
}

function toBase64Url(input) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function createPkcePair() {
  const verifier = toBase64Url(crypto.randomBytes(64))
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function jsonResponsePage(title, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f4f1; color: #1a1917; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      main { background: #fff; border: 1px solid #e8e6e1; border-radius: 14px; padding: 28px 32px; width: min(460px, calc(100vw - 40px)); box-shadow: 0 18px 40px rgba(26,25,23,.08); }
      h1 { font-size: 20px; margin: 0 0 10px; }
      p { font-size: 14px; line-height: 1.6; margin: 0; color: #6b6760; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const contentType = response.headers.get('content-type') || ''
  let payload = null

  if (contentType.includes('application/json')) {
    payload = await response.json()
  } else {
    const text = await response.text()
    try {
      payload = JSON.parse(text)
    } catch (_error) {
      payload = { raw: text }
    }
  }

  if (!response.ok) {
    const message =
      payload.error_description ||
      (payload.error && payload.error.message) ||
      (Array.isArray(payload.errors) && payload.errors.length && payload.errors[0].message) ||
      payload.error ||
      payload.message ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  if (payload && payload.ok === false) {
    const message =
      payload.error_description ||
      payload.error ||
      payload.needed ||
      'The service rejected the request.'
    throw new Error(message)
  }

  return payload
}

function createAuthWindow(authorizeUrl, options = {}) {
  const authWindow = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: false,
    minimizable: false,
    maximizable: false,
    modal: true,
    show: false,
    title: options.title || 'Sign in',
    parent: mainWindow || undefined,
    backgroundColor: '#f5f4f1',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    authWindow.loadURL(url)
    return { action: 'deny' }
  })

  authWindow.once('ready-to-show', () => authWindow.show())
  authWindow.loadURL(authorizeUrl)
  return authWindow
}

async function runLoopbackOAuth({
  authorizeUrl,
  redirectUri,
  state,
  exchangeCode,
  launchMode = 'systemBrowser',
  title = 'Sign in',
  fallbackToSystemBrowser = false,
  onLaunched = null,
}) {
  const redirect = new URL(redirectUri)
  const host = redirect.hostname
  const port = Number(redirect.port || 80)
  const pathname = redirect.pathname || '/'

  return new Promise((resolve, reject) => {
    let settled = false
    let authWindow = null
    let launchedInBrowser = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        if (authWindow && !authWindow.isDestroyed()) authWindow.close()
        server.close()
        reject(new Error('Timed out waiting for sign-in to finish.'))
      }
    }, 5 * 60 * 1000)

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      setTimeout(() => server.close(), 250)
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url, redirectUri)
        if (requestUrl.pathname !== pathname) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(jsonResponsePage('Not Found', 'This redirect path is not part of the current sign-in flow.'))
          return
        }

        const returnedState = requestUrl.searchParams.get('state')
        const error = requestUrl.searchParams.get('error')
        const code = requestUrl.searchParams.get('code')

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(jsonResponsePage('Sign-in rejected', 'The returned state did not match the desktop app request.'))
          finish(new Error('OAuth state mismatch.'))
          return
        }

        if (error) {
          const description = requestUrl.searchParams.get('error_description') || error
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(jsonResponsePage('Sign-in cancelled', description))
          finish(new Error(description))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(jsonResponsePage('Missing code', 'The authorization server did not return a code.'))
          finish(new Error('Authorization code missing from callback.'))
          return
        }

        const result = await exchangeCode(code)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(jsonResponsePage('You can return to Dashboard', 'The account connection is complete. You can close this browser tab.'))
        finish(null, result)
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(jsonResponsePage('Something went wrong', error.message || 'The desktop app could not finish the sign-in flow.'))
        finish(error)
      }
    })

    server.on('error', (error) => {
      finish(new Error(`Could not start the local callback server on ${host}:${port}. ${error.message}`))
    })

    const launchInBrowser = async () => {
      launchedInBrowser = true
      await shell.openExternal(authorizeUrl)
      if (typeof onLaunched === 'function') {
        await onLaunched('browser')
      }
    }

    server.listen(port, host, async () => {
      try {
        if (launchMode === 'embeddedWithFallback') {
          try {
            authWindow = createAuthWindow(authorizeUrl, { title })
            if (typeof onLaunched === 'function') {
              await onLaunched('window')
            }
            authWindow.on('closed', () => {
              authWindow = null
              if (!settled && !launchedInBrowser) {
                finish(new Error('Sign-in window was closed before the account connection finished.'))
              }
            })
            authWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL) => {
              const failedUrl = String(validatedURL || '')
              const isExpectedLoopback = failedUrl.startsWith(redirectUri)
              if (settled || launchedInBrowser || isExpectedLoopback) return

              if (fallbackToSystemBrowser) {
                try {
                  await launchInBrowser()
                } catch (error) {
                  finish(new Error(error.message || 'Could not launch the browser fallback.'))
                }
                return
              }

              finish(new Error(errorDescription || `The sign-in window could not load (${errorCode}).`))
            })
          } catch (_error) {
            if (fallbackToSystemBrowser) {
              await launchInBrowser()
            } else {
              throw _error
            }
          }
        } else {
          await launchInBrowser()
        }
      } catch (error) {
        finish(error)
      }
    })
  })
}

function buildOpenAIHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }

  if (config.organization) {
    headers['OpenAI-Organization'] = config.organization
  }

  if (config.project) {
    headers['OpenAI-Project'] = config.project
  }

  return headers
}

function getAIProviderDefaults(provider) {
  switch (provider) {
    case 'ollama':
      return {
        baseURL: 'http://127.0.0.1:11434/api',
        model: 'gemma3:4b',
        embeddingsModel: 'embeddinggemma',
      }
    case 'openai':
    default:
      return {
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-5-mini',
        embeddingsModel: 'text-embedding-3-small',
      }
  }
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const fragments = []

  ;(payload.output || []).forEach((item) => {
    ;(item.content || []).forEach((content) => {
      if ((content.type === 'output_text' || content.type === 'text') && content.text) {
        fragments.push(content.text)
      }
    })
  })

  return fragments.join('\n').trim()
}

function extractOllamaText(payload) {
  if (payload && payload.message && typeof payload.message.content === 'string') {
    return payload.message.content.trim()
  }

  if (payload && typeof payload.response === 'string') {
    return payload.response.trim()
  }

  return ''
}

async function createOpenAIResponse(config, body) {
  const baseURL = (config.baseURL || DEFAULT_SETTINGS.services.openai.baseURL).replace(/\/+$/, '')
  const response = await fetch(`${baseURL}/responses`, {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify(body),
  })

  let payload = null

  try {
    payload = await response.json()
  } catch (_error) {
    payload = null
  }

  if (!response.ok) {
    const message =
      (payload && payload.error && payload.error.message) ||
      `OpenAI request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

async function createOpenAIEmbedding(config, input) {
  const baseURL = (config.baseURL || getAIProviderDefaults('openai').baseURL).replace(/\/+$/, '')
  const response = await fetch(`${baseURL}/embeddings`, {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: config.embeddingsModel || getAIProviderDefaults('openai').embeddingsModel,
      input,
    }),
  })

  let payload = null

  try {
    payload = await response.json()
  } catch (_error) {
    payload = null
  }

  if (!response.ok) {
    const message =
      (payload && payload.error && payload.error.message) ||
      `OpenAI embeddings request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

async function createOllamaChatResponse(config, body) {
  const baseURL = (config.baseURL || getAIProviderDefaults('ollama').baseURL).replace(/\/+$/, '')
  return fetchJson(`${baseURL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      stream: false,
    }),
  })
}

async function createOllamaEmbeddings(config, input) {
  const baseURL = (config.baseURL || getAIProviderDefaults('ollama').baseURL).replace(/\/+$/, '')
  const payload = await fetchJson(`${baseURL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.embeddingsModel || config.model || getAIProviderDefaults('ollama').embeddingsModel,
      input,
    }),
  })

  return Array.isArray(payload.embeddings) ? payload.embeddings : []
}

function extractJsonObject(text) {
  if (!text || !text.trim()) {
    throw new Error('The model returned an empty response.')
  }

  try {
    return JSON.parse(text)
  } catch (_error) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }
  }

  throw new Error('The model did not return valid JSON.')
}

function normalizeOpenAIConfig(settings, overrides = {}) {
  const base = settings.services.openai
  const providerCandidate = String(
    overrides.provider !== undefined ? overrides.provider : base.provider || 'openai'
  )
    .trim()
    .toLowerCase()
  const provider = providerCandidate === 'ollama' ? 'ollama' : 'openai'
  const defaults = getAIProviderDefaults(provider)
  return {
    ...base,
    ...overrides,
    provider,
    apiKey: (overrides.apiKey !== undefined ? overrides.apiKey : base.apiKey || '').trim(),
    organization: (overrides.organization !== undefined ? overrides.organization : base.organization || '').trim(),
    project: (overrides.project !== undefined ? overrides.project : base.project || '').trim(),
    baseURL:
      (overrides.baseURL !== undefined ? overrides.baseURL : base.baseURL || '').trim() ||
      defaults.baseURL,
    model:
      (overrides.model !== undefined ? overrides.model : base.model || '').trim() ||
      defaults.model,
    embeddingsModel:
      (overrides.embeddingsModel !== undefined ? overrides.embeddingsModel : base.embeddingsModel || '').trim() ||
      defaults.embeddingsModel,
    systemPrompt:
      (overrides.systemPrompt !== undefined ? overrides.systemPrompt : base.systemPrompt || '').trim() ||
      DEFAULT_SETTINGS.services.openai.systemPrompt,
  }
}

function createHashVector(text, dimensions = 256) {
  const vector = new Array(dimensions).fill(0)
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)

  if (!tokens.length) {
    return vector
  }

  tokens.forEach((token) => {
    const digest = crypto.createHash('sha256').update(token).digest()
    for (let index = 0; index < 8; index += 1) {
      const slot = digest.readUInt16BE(index * 2) % dimensions
      vector[slot] += digest[index] % 2 === 0 ? 1 : -1
    }
  })

  return vector
}

function normalizeVector(vector) {
  if (!Array.isArray(vector) || !vector.length) return []
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) return vector.map(() => 0)
  return vector.map((value) => value / magnitude)
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return 0
  }

  let score = 0
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index]
  }

  return score
}

function getVectorStorePath() {
  return path.join(app.getPath('userData'), 'dashboard-vectors.json')
}

function readVectorStore() {
  try {
    if (!fs.existsSync(getVectorStorePath())) {
      return []
    }

    const payload = JSON.parse(fs.readFileSync(getVectorStorePath(), 'utf8'))
    return Array.isArray(payload) ? payload : []
  } catch (_error) {
    return []
  }
}

function writeVectorStore(entries) {
  const target = getVectorStorePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(entries, null, 2))
  return entries
}

function fingerprintDocuments(documents) {
  const hash = crypto.createHash('sha256')
  documents.forEach((document) => {
    hash.update(document.id || '')
    hash.update('\n')
    hash.update(document.text || '')
    hash.update('\n')
  })
  return hash.digest('hex')
}

function collectVectorDocuments(settings) {
  const documents = []
  const google = settings.services.google
  if (google.connected) {
    ;(google.inboxPreview || []).forEach((item) => {
      documents.push({
        id: `google-mail:${item.id}`,
        service: 'google',
        kind: 'mail',
        title: item.subject || '(No subject)',
        text: `Google email from ${item.from || 'Unknown sender'} with subject ${item.subject || '(No subject)'}.\n${item.snippet || ''}`,
      })
    })
    ;(google.calendarPreview || []).forEach((item) => {
      documents.push({
        id: `google-calendar:${item.id}`,
        service: 'calendar',
        kind: 'event',
        title: item.title || '(Untitled event)',
        text: `Google Calendar event ${item.title || '(Untitled event)'} starting ${item.start || 'unknown time'}${item.location ? ` at ${item.location}` : ''}.`,
      })
    })
  }

  const asana = settings.services.asana
  if (asana.connected) {
    ;(asana.tasksPreview || []).forEach((task) => {
      documents.push({
        id: `asana-task:${task.gid}`,
        service: 'asana',
        kind: 'task',
        title: task.name || 'Asana task',
        text: `Asana task ${task.name || 'Untitled'}${task.dueOn ? ` due ${task.dueOn}` : ''}${task.projectNames && task.projectNames.length ? ` in ${task.projectNames.join(', ')}` : ''}.`,
      })
    })
  }

  const slack = settings.services.slack
  if (slack.connected) {
    ;(slack.messagesPreview || []).forEach((message) => {
      documents.push({
        id: `slack-message:${message.ts}`,
        service: 'slack',
        kind: 'message',
        title: message.user || 'Slack message',
        text: `Slack message from ${message.user || 'a teammate'}${slack.standupChannel ? ` in ${slack.standupChannel}` : ''}: ${message.text || ''}`,
      })
    })
  }

  return documents.filter((document) => String(document.text || '').trim())
}

function formatRetrievedContext(results) {
  if (!results.length) return ''
  return (
    'SEMANTIC MEMORY:\n' +
    results
      .map((item) => `- [${item.service}] ${item.title}${item.text ? ` | ${item.text}` : ''}`)
      .join('\n')
  )
}

function getDesiredEmbeddingStrategy(config) {
  if (config.provider === 'ollama') {
    return {
      provider: 'ollama',
      model: config.embeddingsModel || config.model || getAIProviderDefaults('ollama').embeddingsModel,
    }
  }

  if (config.apiKey) {
    return {
      provider: 'openai',
      model: config.embeddingsModel || getAIProviderDefaults('openai').embeddingsModel,
    }
  }

  return {
    provider: 'local-hash',
    model: 'hash-256',
  }
}

async function embedTexts(config, texts) {
  const desired = getDesiredEmbeddingStrategy(config)

  try {
    switch (desired.provider) {
      case 'openai': {
        const payload = await createOpenAIEmbedding(config, texts)
        return {
          vectors: (payload.data || []).map((item) => normalizeVector(item.embedding || [])),
          actualProvider: 'openai',
          actualModel: desired.model,
          requestedProvider: desired.provider,
          requestedModel: desired.model,
          lastError: '',
        }
      }
      case 'ollama': {
        const embeddings = await createOllamaEmbeddings(config, texts)
        return {
          vectors: embeddings.map((embedding) => normalizeVector(embedding || [])),
          actualProvider: 'ollama',
          actualModel: desired.model,
          requestedProvider: desired.provider,
          requestedModel: desired.model,
          lastError: '',
        }
      }
      default:
        break
    }
  } catch (error) {
    return {
      vectors: texts.map((text) => normalizeVector(createHashVector(text))),
      actualProvider: 'local-hash',
      actualModel: 'hash-256',
      requestedProvider: desired.provider,
      requestedModel: desired.model,
      lastError: error.message || 'Embedding request failed.',
    }
  }

  return {
    vectors: texts.map((text) => normalizeVector(createHashVector(text))),
    actualProvider: 'local-hash',
    actualModel: 'hash-256',
    requestedProvider: desired.provider,
    requestedModel: desired.model,
    lastError: '',
  }
}

async function embedQueryWithSummary(config, summary, text) {
  switch (summary.provider) {
    case 'openai': {
      const payload = await createOpenAIEmbedding(
        {
          ...config,
          provider: 'openai',
          embeddingsModel: summary.model,
        },
        text
      )
      const item = payload.data && payload.data[0] ? payload.data[0].embedding : []
      return normalizeVector(item || [])
    }
    case 'ollama': {
      const embeddings = await createOllamaEmbeddings(
        {
          ...config,
          provider: 'ollama',
          embeddingsModel: summary.model,
        },
        text
      )
      return normalizeVector(embeddings[0] || [])
    }
    case 'local-hash':
    default:
      return normalizeVector(createHashVector(text))
  }
}

async function reindexSemanticMemory(settings, config = normalizeOpenAIConfig(settings)) {
  const documents = collectVectorDocuments(settings)
  const indexedAt = new Date().toISOString()

  if (!documents.length) {
    writeVectorStore([])
    settings.workspace.vectorSummary = {
      ...settings.workspace.vectorSummary,
      documentCount: 0,
      lastIndexedAt: indexedAt,
      provider: '',
      model: '',
      requestedProvider: '',
      requestedModel: '',
      fingerprint: '',
      lastError: '',
    }
    return settings.workspace.vectorSummary
  }

  const embeddingResult = await embedTexts(
    config,
    documents.map((document) => document.text)
  )

  const entries = documents.map((document, index) => ({
    ...document,
    vector: embeddingResult.vectors[index] || [],
    indexedAt,
  }))

  writeVectorStore(entries)

  settings.workspace.vectorSummary = {
    ...settings.workspace.vectorSummary,
    documentCount: entries.length,
    lastIndexedAt: indexedAt,
    provider: embeddingResult.actualProvider,
    model: embeddingResult.actualModel,
    requestedProvider: embeddingResult.requestedProvider,
    requestedModel: embeddingResult.requestedModel,
    fingerprint: fingerprintDocuments(documents),
    lastError: embeddingResult.lastError || '',
  }

  return settings.workspace.vectorSummary
}

async function ensureSemanticMemory(settings, config = normalizeOpenAIConfig(settings)) {
  const documents = collectVectorDocuments(settings)
  const summary = settings.workspace.vectorSummary || {}
  const desired = getDesiredEmbeddingStrategy(config)
  const fingerprint = documents.length ? fingerprintDocuments(documents) : ''

  const matchesCurrentState =
    Number(summary.documentCount || 0) === documents.length &&
    summary.fingerprint === fingerprint &&
    summary.requestedProvider === desired.provider &&
    summary.requestedModel === desired.model

  if (!matchesCurrentState) {
    await reindexSemanticMemory(settings, config)
  }

  return {
    summary: settings.workspace.vectorSummary,
    entries: readVectorStore(),
  }
}

async function searchSemanticMemory(settings, config, queryText, limit = 5) {
  const { summary, entries } = await ensureSemanticMemory(settings, config)
  if (!summary || !summary.documentCount || !entries.length) {
    return []
  }

  const queryVector = await embedQueryWithSummary(
    config,
    summary,
    queryText && queryText.trim() ? queryText : 'What should I focus on today?'
  )

  return entries
    .map((entry) => ({
      ...entry,
      score: cosineSimilarity(queryVector, entry.vector || []),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

function tokenIsFresh(expiresAt) {
  if (!expiresAt) return false
  const expiration = new Date(expiresAt).getTime()
  return Number.isFinite(expiration) && expiration - Date.now() > 60 * 1000
}

async function refreshGoogleTokens(service) {
  if (!service.refreshToken) {
    return service
  }

  if (service.accessToken && tokenIsFresh(service.tokenExpiresAt)) {
    return service
  }

  const body = new URLSearchParams({
    client_id: service.clientId,
    refresh_token: service.refreshToken,
    grant_type: 'refresh_token',
  })

  if (service.clientSecret) {
    body.set('client_secret', service.clientSecret)
  }

  const payload = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  return {
    ...service,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || service.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(),
  }
}

async function refreshAsanaTokens(service) {
  if (!service.refreshToken) {
    return service
  }

  if (service.accessToken && tokenIsFresh(service.tokenExpiresAt)) {
    return service
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: service.clientId,
    client_secret: service.clientSecret,
    refresh_token: service.refreshToken,
  })

  const payload = await fetchJson('https://app.asana.com/-/oauth_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  return {
    ...service,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || service.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(),
  }
}

async function syncGoogleService(settings) {
  let service = settings.services.google
  if (!service.clientId) {
    throw new Error('Add your Google desktop client ID first.')
  }

  service = await refreshGoogleTokens(service)
  if (!service.accessToken) {
    throw new Error('Google is not signed in yet.')
  }

  const headers = { Authorization: `Bearer ${service.accessToken}` }
  const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', { headers })

  let inboxPreview = service.inboxPreview || []
  if (service.permissions.gmailReadUnread) {
    const mailbox = await fetchJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is%3Aunread%20newer_than%3A7d',
      { headers }
    )

    const messages = mailbox.messages || []
    inboxPreview = await Promise.all(
      messages.slice(0, 5).map(async (message) => {
        const details = await fetchJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          { headers }
        )
        const headerMap = Object.fromEntries(
          (details.payload && details.payload.headers ? details.payload.headers : []).map((header) => [
            header.name,
            header.value,
          ])
        )
        return {
          id: details.id,
          from: headerMap.From || 'Unknown sender',
          subject: headerMap.Subject || '(No subject)',
          snippet: details.snippet || '',
        }
      })
    )
  }

  let calendarPreview = service.calendarPreview || []
  if (service.permissions.calendarToday) {
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '5',
    })

    const events = await fetchJson(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers }
    )

    calendarPreview = (events.items || []).map((event) => ({
      id: event.id,
      title: event.summary || '(Untitled event)',
      start: event.start && (event.start.dateTime || event.start.date) ? event.start.dateTime || event.start.date : '',
      end: event.end && (event.end.dateTime || event.end.date) ? event.end.dateTime || event.end.date : '',
      location: event.location || '',
    }))
  }

  return {
    ...service,
    accessToken: service.accessToken,
    refreshToken: service.refreshToken,
    tokenExpiresAt: service.tokenExpiresAt,
    displayName: profile.name || service.displayName,
    email: profile.email || service.email,
    inboxPreview,
    calendarPreview,
    connected: true,
    authStatus: 'connected',
    lastAuthStep: 'Connected',
    lastAuthError: '',
    lastSyncAt: new Date().toISOString(),
  }
}

async function connectGoogle(settings) {
  const current = settings.services.google
  const setup = getServiceSetupValidation(settings, 'google')
  if (!setup.ready) {
    throw new Error(`Google setup is incomplete. Missing: ${setup.missing.join(', ')}.`)
  }

  markServiceAuthState(settings, 'google', {
    authStatus: 'opening_browser',
    lastAuthStep: 'Opening browser',
    lastAuthError: '',
    lastAuthAttemptAt: new Date().toISOString(),
  })
  writeSettings(settings)

  const { verifier, challenge } = createPkcePair()
  const state = randomString(16)
  const scopes = ['openid', 'email', 'profile']
  if (current.permissions.gmailReadUnread) scopes.push('https://www.googleapis.com/auth/gmail.readonly')
  if (current.permissions.calendarToday) scopes.push('https://www.googleapis.com/auth/calendar.readonly')

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizeUrl.searchParams.set('client_id', current.clientId)
  authorizeUrl.searchParams.set('redirect_uri', current.redirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', scopes.join(' '))
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('access_type', 'offline')
  authorizeUrl.searchParams.set('prompt', 'consent')
  authorizeUrl.searchParams.set('include_granted_scopes', 'true')
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  const exchanged = await runLoopbackOAuth({
    authorizeUrl: authorizeUrl.toString(),
    redirectUri: current.redirectUri,
    state,
    launchMode: 'systemBrowser',
    title: 'Sign in with Google',
    onLaunched: async () => {
      markServiceAuthState(settings, 'google', {
        authStatus: 'waiting_for_callback',
        lastAuthStep: 'Waiting for callback',
        lastAuthError: '',
      })
      writeSettings(settings)
    },
    exchangeCode: async (code) => {
      const body = new URLSearchParams({
        client_id: current.clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: current.redirectUri,
      })

      if (current.clientSecret) {
        body.set('client_secret', current.clientSecret)
      }

      return fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    },
  })

  settings.services.google = {
    ...settings.services.google,
    accessToken: exchanged.access_token,
    refreshToken: exchanged.refresh_token || settings.services.google.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (exchanged.expires_in || 3600) * 1000).toISOString(),
  }

  settings.services.google = await syncGoogleService(settings)
  return settings.services.google
}

async function syncAsanaService(settings) {
  let service = settings.services.asana
  if (service.personalAccessToken) {
    service = { ...service, accessToken: service.personalAccessToken }
  } else {
    service = await refreshAsanaTokens(service)
  }

  if (!service.accessToken) {
    throw new Error('Asana is not signed in yet.')
  }

  const headers = { Authorization: `Bearer ${service.accessToken}` }
  const userPayload = await fetchJson('https://app.asana.com/api/1.0/users/me', { headers })
  const user = userPayload.data || {}
  const workspacesPayload = await fetchJson('https://app.asana.com/api/1.0/workspaces', { headers })
  const workspaces = workspacesPayload.data || []
  const workspace =
    workspaces.find((item) => item.gid === service.workspaceGid) ||
    workspaces[0] ||
    { gid: '', name: '' }

  let tasksPreview = []
  if (workspace.gid) {
    try {
      const params = new URLSearchParams({
        'assignee.any': 'me',
        completed: 'false',
        sort_by: 'due_date',
        limit: '5',
        opt_fields: 'name,due_on,permalink_url,projects.name',
      })
      const searchPayload = await fetchJson(
        `https://app.asana.com/api/1.0/workspaces/${workspace.gid}/tasks/search?${params.toString()}`,
        { headers }
      )
      tasksPreview = (searchPayload.data || []).map((task) => ({
        gid: task.gid,
        name: task.name,
        dueOn: task.due_on || '',
        projectNames: (task.projects || []).map((project) => project.name),
        permalinkUrl: task.permalink_url || '',
      }))
    } catch (_error) {
      const userTaskListPayload = await fetchJson('https://app.asana.com/api/1.0/users/me/user_task_list', {
        headers,
      })
      const taskList = userTaskListPayload.data
      if (taskList && taskList.gid) {
        const params = new URLSearchParams({
          completed_since: 'now',
          limit: '5',
          opt_fields: 'name,due_on,permalink_url,projects.name',
        })
        const tasksPayload = await fetchJson(
          `https://app.asana.com/api/1.0/user_task_lists/${taskList.gid}/tasks?${params.toString()}`,
          { headers }
        )
        tasksPreview = (tasksPayload.data || []).map((task) => ({
          gid: task.gid,
          name: task.name,
          dueOn: task.due_on || '',
          projectNames: (task.projects || []).map((project) => project.name),
          permalinkUrl: task.permalink_url || '',
        }))
      }
    }
  }

  return {
    ...service,
    workspaceGid: workspace.gid || service.workspaceGid,
    workspaceName: workspace.name || service.workspaceName,
    userName: user.name || service.userName,
    email: user.email || service.email,
    tasksPreview,
    connected: true,
    authStatus: 'connected',
    lastAuthStep: 'Connected',
    lastAuthError: '',
    lastSyncAt: new Date().toISOString(),
  }
}

async function connectAsana(settings) {
  const current = settings.services.asana
  const setup = getServiceSetupValidation(settings, 'asana')
  if (!setup.ready) {
    throw new Error(`Asana setup is incomplete. Missing: ${setup.missing.join(', ')}.`)
  }

  markServiceAuthState(settings, 'asana', {
    authStatus: 'opening_window',
    lastAuthStep: 'Opening window',
    lastAuthError: '',
    lastAuthAttemptAt: new Date().toISOString(),
  })
  writeSettings(settings)

  const { verifier, challenge } = createPkcePair()
  const state = randomString(16)
  const scopes = ['openid', 'email', 'profile', 'users:read', 'workspaces:read', 'tasks:read']
  if (current.permissions.markTasksComplete) scopes.push('tasks:write')

  const authorizeUrl = new URL('https://app.asana.com/-/oauth_authorize')
  authorizeUrl.searchParams.set('client_id', current.clientId)
  authorizeUrl.searchParams.set('redirect_uri', current.redirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', scopes.join(' '))
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('code_challenge', challenge)

  const exchanged = await runLoopbackOAuth({
    authorizeUrl: authorizeUrl.toString(),
    redirectUri: current.redirectUri,
    state,
    launchMode: 'embeddedWithFallback',
    fallbackToSystemBrowser: true,
    title: 'Sign in with Asana',
    onLaunched: async (mode) => {
      markServiceAuthState(settings, 'asana', {
        authStatus: 'waiting_for_callback',
        lastAuthStep: 'Waiting for callback',
        lastAuthError: '',
      })
      writeSettings(settings)
    },
    exchangeCode: async (code) => {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: current.clientId,
        client_secret: current.clientSecret,
        code,
        redirect_uri: current.redirectUri,
        code_verifier: verifier,
      })

      return fetchJson('https://app.asana.com/-/oauth_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    },
  })

  settings.services.asana = {
    ...settings.services.asana,
    accessToken: exchanged.access_token,
    refreshToken: exchanged.refresh_token || settings.services.asana.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (exchanged.expires_in || 3600) * 1000).toISOString(),
  }

  settings.services.asana = await syncAsanaService(settings)
  return settings.services.asana
}

async function connectSlack(settings) {
  const current = settings.services.slack
  const setup = getServiceSetupValidation(settings, 'slack')
  if (!setup.ready) {
    throw new Error(`Slack setup is incomplete. Missing: ${setup.missing.join(', ')}.`)
  }

  let configuredRedirect = null
  try {
    configuredRedirect = new URL(current.redirectUri)
  } catch (_error) {
    throw new Error('Enter a valid Slack HTTPS redirect URI first.')
  }

  if (configuredRedirect.protocol !== 'https:') {
    throw new Error('Slack browser OAuth needs an HTTPS redirect URI. Host the bridge page over HTTPS, then try again.')
  }

  const relayUri = 'http://127.0.0.1:3456/oauth/slack/relay'
  const state = randomString(16)
  const scopes = ['channels:read', 'groups:read', 'channels:history', 'groups:history']
  if (current.permissions.readDirectMessages) scopes.push('im:history')
  if (current.permissions.postMessages) scopes.push('chat:write')

  const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize')
  authorizeUrl.searchParams.set('client_id', current.clientId)
  authorizeUrl.searchParams.set('redirect_uri', current.redirectUri)
  authorizeUrl.searchParams.set('scope', scopes.join(','))
  authorizeUrl.searchParams.set('state', state)

  markServiceAuthState(settings, 'slack', {
    authStatus: 'opening_browser',
    lastAuthStep: 'Opening browser',
    lastAuthError: '',
    lastAuthAttemptAt: new Date().toISOString(),
  })
  writeSettings(settings)

  const exchanged = await runLoopbackOAuth({
    authorizeUrl: authorizeUrl.toString(),
    redirectUri: relayUri,
    state,
    launchMode: 'systemBrowser',
    title: 'Connect with Slack',
    onLaunched: async () => {
      markServiceAuthState(settings, 'slack', {
        authStatus: 'waiting_for_callback',
        lastAuthStep: 'Waiting for callback',
        lastAuthError: '',
      })
      writeSettings(settings)
    },
    exchangeCode: async (code) => {
      const body = new URLSearchParams({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        code,
        redirect_uri: current.redirectUri,
      })

      return fetchJson('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
    },
  })

  if (!exchanged.access_token) {
    throw new Error('Slack did not return a bot token.')
  }

  settings.services.slack = {
    ...settings.services.slack,
    botToken: exchanged.access_token,
    workspaceName: exchanged.team && exchanged.team.name ? exchanged.team.name : settings.services.slack.workspaceName,
    teamId: exchanged.team && exchanged.team.id ? exchanged.team.id : settings.services.slack.teamId,
    authorizedUser:
      exchanged.authed_user && exchanged.authed_user.id ? exchanged.authed_user.id : settings.services.slack.authorizedUser,
  }

  settings.services.slack = await syncSlackService(settings)
  return settings.services.slack
}

async function syncSlackService(settings) {
  const service = settings.services.slack
  if (!service.botToken) {
    throw new Error('Enter a Slack bot token first.')
  }

  const headers = {
    Authorization: `Bearer ${service.botToken}`,
    'Content-Type': 'application/json; charset=utf-8',
  }

  const auth = await fetchJson('https://slack.com/api/auth.test', { headers })
  let messagesPreview = []
  let channelId = service.channelId || ''

  if (service.permissions.readChannelMessages && service.standupChannel) {
    const channelName = service.standupChannel.replace(/^#/, '').trim()
    const conversations = await fetchJson(
      'https://slack.com/api/conversations.list?exclude_archived=true&limit=200&types=public_channel,private_channel',
      { headers }
    )
    const channel = (conversations.channels || []).find((item) => item.name === channelName)
    if (channel) {
      channelId = channel.id
      const history = await fetchJson(
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel.id)}&limit=5`,
        { headers }
      )
      messagesPreview = (history.messages || []).map((message) => ({
        ts: message.ts,
        text: message.text || '',
        user: message.user || message.username || '',
      }))
    }
  }

  return {
    ...service,
    workspaceName: auth.team || service.workspaceName,
    teamId: auth.team_id || service.teamId,
    authorizedUser: auth.user || service.authorizedUser,
    channelId,
    messagesPreview,
    connected: true,
    authStatus: 'connected',
    lastAuthStep: 'Connected',
    lastAuthError: '',
    lastSyncAt: new Date().toISOString(),
  }
}

function buildServiceContext(settings) {
  const parts = []
  const adminTasks =
    settings.workspace && Array.isArray(settings.workspace.adminTasks)
      ? settings.workspace.adminTasks.filter((task) => !task.completedAt)
      : []

  if (adminTasks.length) {
    parts.push(
      'ADMIN TASKS:\n' +
        adminTasks
          .map((task) => `- ${task.text}`)
          .join('\n')
    )
  }

  const google = settings.services.google
  if (google.connected) {
    if (google.inboxPreview.length) {
      parts.push(
        'GOOGLE INBOX:\n' +
          google.inboxPreview
            .map((item) => `- From: ${item.from} | Subject: ${item.subject} | Snippet: ${item.snippet}`)
            .join('\n')
      )
    }
    if (google.calendarPreview.length) {
      parts.push(
        'GOOGLE CALENDAR:\n' +
          google.calendarPreview
            .map((item) => `- ${item.title} | Start: ${item.start}${item.location ? ` | Location: ${item.location}` : ''}`)
            .join('\n')
      )
    }
  }

  const asana = settings.services.asana
  if (asana.connected && asana.tasksPreview.length) {
    parts.push(
      'ASANA TASKS:\n' +
        asana.tasksPreview
          .map((task) => `- ${task.name}${task.dueOn ? ` | Due: ${task.dueOn}` : ''}`)
          .join('\n')
    )
  }

  const slack = settings.services.slack
  if (slack.connected && slack.messagesPreview.length) {
    parts.push(
      'SLACK MESSAGES:\n' +
        slack.messagesPreview
          .map((message) => `- ${message.user || 'User'}: ${message.text}`)
          .join('\n')
    )
  }

  return parts.join('\n\n')
}

function classifyAuthFailure(error) {
  const message = String((error && error.message) || error || '')
  const lower = message.toLowerCase()

  if (lower.includes('cancel') || lower.includes('closed before') || lower.includes('denied')) {
    return {
      authStatus: 'auth_cancelled',
      lastAuthStep: 'Auth cancelled',
      lastAuthError: message,
    }
  }

  if (lower.includes('timed out')) {
    return {
      authStatus: 'setup_error',
      lastAuthStep: 'Waiting for callback',
      lastAuthError: message,
    }
  }

  return {
    authStatus: 'setup_error',
    lastAuthStep: 'Setup error',
    lastAuthError: message,
  }
}

function providerDisplayName(provider) {
  return provider === 'ollama' ? 'Ollama' : 'OpenAI'
}

async function testAIConnection(config) {
  if (config.provider === 'ollama') {
    const payload = await createOllamaChatResponse(config, {
      model: config.model,
      messages: [
        {
          role: 'user',
          content:
            'Reply with CONNECTED on the first line and one short sentence on the second line confirming the local model is reachable.',
        },
      ],
    })

    return {
      model: payload.model || config.model,
      outputText: extractOllamaText(payload),
    }
  }

  if (!config.apiKey) {
    throw new Error('Enter your OpenAI API key first.')
  }

  const payload = await createOpenAIResponse(config, {
    model: config.model,
    input: 'Reply with CONNECTED on the first line and one short sentence on the second line confirming the model is reachable.',
  })

  return {
    model: payload.model || config.model,
    outputText: extractOutputText(payload),
  }
}

async function generatePriorityPlan(config, today, context) {
  if (config.provider === 'ollama') {
    const payload = await createOllamaChatResponse(config, {
      model: config.model,
      format: 'json',
      messages: [
        {
          role: 'system',
          content:
            `${config.systemPrompt}\nReturn JSON only. Produce exactly one object with keys rationale and tasks. The tasks array must include rank, title, why, source, due, and urgency.`,
        },
        {
          role: 'user',
          content:
            `Today is ${today}. Review the context below and produce a prioritized plan for the day.\n\n` +
            `Context:\n${context}\n\n` +
            `Return valid JSON only in this exact shape:\n` +
            `{"rationale":"string","tasks":[{"rank":1,"title":"string","why":"string","source":"context","due":"string","urgency":"urgent"}]}\n` +
            `Use source values from: context, slack, asana, google, calendar, n8n. Use urgency values from: urgent, soon, normal. Return up to five tasks.`,
        },
      ],
    })

    return {
      model: payload.model || config.model,
      data: extractJsonObject(extractOllamaText(payload)),
    }
  }

  if (!config.apiKey) {
    throw new Error('Connect OpenAI before generating priorities.')
  }

  const payload = await createOpenAIResponse(config, {
    model: config.model,
    input: [
      {
        role: 'system',
        content: `${config.systemPrompt}\nReturn a concise ranking of the five highest-value actions for today.`,
      },
      {
        role: 'user',
        content:
          `Today is ${today}. Review the context below and produce a prioritized plan for the day.\n\n` +
          `Context:\n${context}\n\n` +
          `Focus on urgent deadlines, blockers, upcoming meetings, dependencies, and items with outsized impact.`,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'priority_plan',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['rationale', 'tasks'],
          properties: {
            rationale: { type: 'string' },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['rank', 'title', 'why', 'source', 'due', 'urgency'],
                properties: {
                  rank: { type: 'integer' },
                  title: { type: 'string' },
                  why: { type: 'string' },
                  source: {
                    type: 'string',
                    enum: ['context', 'slack', 'asana', 'google', 'calendar', 'n8n'],
                  },
                  due: { type: 'string' },
                  urgency: {
                    type: 'string',
                    enum: ['urgent', 'soon', 'normal'],
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  return {
    model: payload.model || config.model,
    data: extractJsonObject(extractOutputText(payload)),
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'Dashboard',
    backgroundColor: '#f5f4f1',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadFile('command-dashboard.html')

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    if (mainWindow && mainWindow.isDestroyed()) {
      mainWindow = null
    }
  })
}

ipcMain.handle('dashboard:get-settings', async () => {
  return readSettings()
})

ipcMain.handle('dashboard:save-settings', async (_event, nextSettings) => {
  return writeSettings(nextSettings)
})

ipcMain.handle('dashboard:test-openai', async (_event, overrides = {}) => {
  const currentSettings = readSettings()
  const config = normalizeOpenAIConfig(currentSettings, overrides)
  const result = await testAIConnection(config)
  const testedAt = new Date().toISOString()

  if (overrides.persist !== false) {
    currentSettings.services.openai = {
      ...currentSettings.services.openai,
      ...config,
      connected: true,
      lastTestedAt: testedAt,
      lastModel: result.model || config.model,
      lastMessage: result.outputText,
    }
    writeSettings(currentSettings)
  }

  return {
    ok: true,
    provider: config.provider,
    providerLabel: providerDisplayName(config.provider),
    model: result.model || config.model,
    outputText: result.outputText,
    testedAt,
  }
})

ipcMain.handle('dashboard:generate-priorities', async (_event, request = {}) => {
  const manualContext = (request.context || '').trim()
  const currentSettings = readSettings()
  const config = normalizeOpenAIConfig(currentSettings, request.openai || {})
  const syncedContext = buildServiceContext(currentSettings)
  const semanticMatches = await searchSemanticMemory(
    currentSettings,
    config,
    [manualContext, syncedContext].filter(Boolean).join('\n\n'),
    6
  )
  const semanticContext = formatRetrievedContext(semanticMatches)
  const context = [manualContext, semanticContext, syncedContext].filter(Boolean).join('\n\n')
  if (!context) {
    throw new Error('Add some context before generating priorities.')
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const result = await generatePriorityPlan(config, today, context)
  const generatedAt = new Date().toISOString()

  currentSettings.services.openai = {
    ...currentSettings.services.openai,
    ...config,
    connected: true,
    lastTestedAt: generatedAt,
    lastModel: result.model || config.model,
    lastMessage: result.data.rationale || currentSettings.services.openai.lastMessage,
  }
  writeSettings(currentSettings)

  return {
    ok: true,
    provider: config.provider,
    providerLabel: providerDisplayName(config.provider),
    data: result.data,
    model: result.model || config.model,
    generatedAt,
    retrievedCount: semanticMatches.length,
    vectorSummary: currentSettings.workspace.vectorSummary,
  }
})

ipcMain.handle('dashboard:connect-service', async (_event, serviceName) => {
  const settings = readSettings()
  try {
    switch (serviceName) {
      case 'google':
        await connectGoogle(settings)
        break
      case 'asana':
        await connectAsana(settings)
        break
      case 'slack':
        await connectSlack(settings)
        break
      default:
        throw new Error(`OAuth sign-in is not available for ${serviceName}.`)
    }

    if (['google', 'asana', 'slack'].includes(serviceName)) {
      await reindexSemanticMemory(settings)
    }

    return writeSettings(settings)
  } catch (error) {
    if (['google', 'asana', 'slack'].includes(serviceName)) {
      markServiceAuthState(settings, serviceName, classifyAuthFailure(error))
      writeSettings(settings)
    }
    throw error
  }
})

ipcMain.handle('dashboard:sync-service', async (_event, serviceName) => {
  const settings = readSettings()

  switch (serviceName) {
    case 'google':
      settings.services.google = await syncGoogleService(settings)
      break
    case 'asana':
      settings.services.asana = await syncAsanaService(settings)
      break
    case 'slack':
      settings.services.slack = await syncSlackService(settings)
      break
    default:
      throw new Error(`Sync is not available for ${serviceName}.`)
  }

  if (['google', 'asana', 'slack'].includes(serviceName)) {
    await reindexSemanticMemory(settings)
  }

  return writeSettings(settings)
})

ipcMain.handle('dashboard:disconnect-service', async (_event, serviceName) => {
  const settings = readSettings()
  if (!settings.services[serviceName]) {
    throw new Error(`Unknown service: ${serviceName}`)
  }

  settings.services[serviceName] = {
    ...cloneDefaults().services[serviceName],
    clientId: settings.services[serviceName].clientId || cloneDefaults().services[serviceName].clientId || '',
    clientSecret: settings.services[serviceName].clientSecret || cloneDefaults().services[serviceName].clientSecret || '',
    redirectUri: settings.services[serviceName].redirectUri || cloneDefaults().services[serviceName].redirectUri || '',
    apiKey: settings.services[serviceName].apiKey || cloneDefaults().services[serviceName].apiKey || '',
    provider: settings.services[serviceName].provider || cloneDefaults().services[serviceName].provider || '',
    model: settings.services[serviceName].model || cloneDefaults().services[serviceName].model || '',
    embeddingsModel: settings.services[serviceName].embeddingsModel || cloneDefaults().services[serviceName].embeddingsModel || '',
    baseURL: settings.services[serviceName].baseURL || cloneDefaults().services[serviceName].baseURL || '',
    organization: settings.services[serviceName].organization || cloneDefaults().services[serviceName].organization || '',
    project: settings.services[serviceName].project || cloneDefaults().services[serviceName].project || '',
    systemPrompt: settings.services[serviceName].systemPrompt || cloneDefaults().services[serviceName].systemPrompt || '',
  }

  if (serviceName === 'openai') {
    settings.services.openai.apiKey = settings.services.openai.apiKey || ''
  }

  if (['google', 'asana', 'slack'].includes(serviceName)) {
    await reindexSemanticMemory(settings)
  }

  return writeSettings(settings)
})

ipcMain.handle('dashboard:reindex-vectors', async () => {
  const settings = readSettings()
  const config = normalizeOpenAIConfig(settings)
  await reindexSemanticMemory(settings, config)
  return writeSettings(settings)
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
