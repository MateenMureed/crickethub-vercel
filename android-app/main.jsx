import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { AuthProvider } from './context/AuthContext'
import { DataStoreProvider } from './context/DataStore'
import SplashScreen from './components/SplashScreen'
import './index.css'
import App from './App.jsx'

const BACKEND_RAW = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
const API_BASE = BACKEND_RAW.startsWith('http')
  ? (BACKEND_RAW.endsWith('/api') ? BACKEND_RAW : `${BACKEND_RAW}/api`)
  : '/api'
const MEDIA_BASE = API_BASE.replace(/\/api$/, '')
const RESPONSE_CACHE_PREFIX = 'ch_api_cache_v2:'
const RESPONSE_CACHE_INDEX_KEY = 'ch_api_cache_index_v2'
const RESPONSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const RESPONSE_CACHE_MAX_ENTRIES = 180
const HOT_RESPONSE_CACHE = new Map()

const toCacheKey = (url) => `${RESPONSE_CACHE_PREFIX}${encodeURIComponent(url)}`

const canCacheApiGet = (url, method) => {
  if (String(method || 'GET').toUpperCase() !== 'GET') return false
  if (!/^https?:\/\//i.test(String(url || ''))) return false
  return String(url).includes('/api/')
}

const readCachedApiResponse = (url) => {
  const hot = HOT_RESPONSE_CACHE.get(url)
  if (hot?.savedAt && (Date.now() - hot.savedAt) <= RESPONSE_CACHE_TTL_MS) {
    return hot
  }
  try {
    const raw = localStorage.getItem(toCacheKey(url))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.body || !parsed?.savedAt) return null
    const age = Date.now() - parsed.savedAt
    if (age > RESPONSE_CACHE_TTL_MS) return null
    HOT_RESPONSE_CACHE.set(url, parsed)
    return parsed
  } catch {
    return null
  }
}

const writeCacheIndex = (nextItems) => {
  try {
    localStorage.setItem(RESPONSE_CACHE_INDEX_KEY, JSON.stringify(nextItems))
  } catch {
    // Best-effort bookkeeping only.
  }
}

const prunePersistentCache = (latestUrl, latestSavedAt) => {
  try {
    const raw = localStorage.getItem(RESPONSE_CACHE_INDEX_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const valid = Array.isArray(parsed) ? parsed : []

    const map = new Map()
    for (const item of valid) {
      if (!item?.url || !item?.savedAt) continue
      map.set(item.url, item.savedAt)
    }
    map.set(latestUrl, latestSavedAt)

    const sorted = [...map.entries()]
      .map(([url, savedAt]) => ({ url, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt)

    const now = Date.now()
    const keep = []
    for (const item of sorted) {
      const isExpired = (now - Number(item.savedAt || 0)) > RESPONSE_CACHE_TTL_MS
      if (isExpired) {
        localStorage.removeItem(toCacheKey(item.url))
        HOT_RESPONSE_CACHE.delete(item.url)
        continue
      }
      if (keep.length < RESPONSE_CACHE_MAX_ENTRIES) {
        keep.push(item)
      } else {
        localStorage.removeItem(toCacheKey(item.url))
        HOT_RESPONSE_CACHE.delete(item.url)
      }
    }

    writeCacheIndex(keep)
  } catch {
    // Ignore cache index maintenance failures.
  }
}

const writeCachedApiResponse = (url, response) => {
  try {
    if (!response?.ok) return
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) return
    response.clone().text().then((bodyText) => {
      if (!bodyText) return
      const payload = {
        savedAt: Date.now(),
        status: response.status,
        headers: { 'content-type': contentType },
        body: bodyText,
      }
      HOT_RESPONSE_CACHE.set(url, payload)
      localStorage.setItem(toCacheKey(url), JSON.stringify(payload))
      prunePersistentCache(url, payload.savedAt)
    }).catch(() => {})
  } catch {
    // Ignore cache write failures (quota, private mode, etc.)
  }
}

const toCachedResponse = (cached) => {
  const headers = new Headers(cached?.headers || { 'content-type': 'application/json' })
  headers.set('x-ch-cache', 'hit')
  return new Response(cached?.body || '{}', {
    status: cached?.status || 200,
    headers,
  })
}

const withTimeout = async (promiseFactory, timeoutMs) => {
  let timer = null
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Network timeout')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const likelyMediaUrl = (value) => {
  if (typeof value !== 'string') return false
  if (value.startsWith('/uploads/') || value.startsWith('/media/')) return true
  return /^https?:\/\/.*\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(value)
}

const prefetchImage = (src) => {
  if (!src || typeof src !== 'string') return
  const img = new Image()
  img.decoding = 'async'
  img.loading = 'eager'
  img.src = toMediaUrl(src)
}

const extractMediaUrls = (payload, out = new Set()) => {
  if (Array.isArray(payload)) {
    payload.forEach((item) => extractMediaUrls(item, out))
    return out
  }
  if (!payload || typeof payload !== 'object') {
    if (likelyMediaUrl(payload)) out.add(payload)
    return out
  }
  Object.values(payload).forEach((v) => extractMediaUrls(v, out))
  return out
}

const startupWarmCache = async () => {
  const endpoints = [
    '/stats/dashboard',
    '/leagues',
    '/matches/live/all',
    '/matches/upcoming/all',
    '/matches/completed/all',
    '/stats/global/batting',
    '/stats/global/bowling',
  ]

  // Parallel warm cache instead of sequential — much faster startup
  const results = await Promise.allSettled(
    endpoints.map(path =>
      fetch(`${API_BASE}${path}`)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null)
    )
  )

  // Prefetch images from results (reduced from 60 to 20 per endpoint)
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const mediaUrls = [...extractMediaUrls(result.value)]
    mediaUrls.slice(0, 20).forEach((u) => prefetchImage(u))
  }
}

const toMediaUrl = (value) => {
  if (typeof value !== 'string') return value
  if (value.startsWith('/uploads/') || value.startsWith('/media/')) return `${MEDIA_BASE}${value}`
  return value
}

const normalizePayloadUrls = (payload) => {
  if (Array.isArray(payload)) return payload.map(normalizePayloadUrls)
  if (!payload || typeof payload !== 'object') return toMediaUrl(payload)
  const out = {}
  for (const [k, v] of Object.entries(payload)) {
    out[k] = normalizePayloadUrls(v)
  }
  return out
}

if (Capacitor.isNativePlatform()) {
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  if (srcDescriptor?.set && srcDescriptor?.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: true,
      get() {
        return srcDescriptor.get.call(this)
      },
      set(value) {
        srcDescriptor.set.call(this, toMediaUrl(value))
      }
    })
  }
}

if (Capacitor.isNativePlatform()) {
  const originalFetch = window.fetch.bind(window)

  const normalizeHeaders = (headers) => {
    if (!headers) return {}
    if (headers instanceof Headers) {
      const out = {}
      headers.forEach((value, key) => { out[key] = value })
      return out
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers)
    }
    return { ...headers }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    if (!url || !/^https?:\/\//i.test(url)) {
      return originalFetch(input, init)
    }

    if (init?.body instanceof FormData) {
      return originalFetch(input, init)
    }

    const method = (init?.method || 'GET').toUpperCase()
    const headers = normalizeHeaders(init?.headers)

    let data = undefined
    if (typeof init?.body === 'string') data = init.body
    else if (init?.body != null) data = JSON.stringify(init.body)

    const fromNativeHttp = async () => {
      const res = await CapacitorHttp.request({
        url,
        method,
        headers,
        data,
        connectTimeout: 30000,
        readTimeout: 30000,
      })

      const parsed = typeof res.data === 'string' ? res.data : normalizePayloadUrls(res.data)
      const body = typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? '')
      return new Response(body, {
        status: res.status,
        headers: new Headers(res.headers || {}),
      })
    }

    if (!canCacheApiGet(url, method)) {
      return fromNativeHttp()
    }

    try {
      const networkRes = await withTimeout(fromNativeHttp, 12000)
      writeCachedApiResponse(url, networkRes)
      return networkRes
    } catch (error) {
      const cached = readCachedApiResponse(url)
      if (cached) return toCachedResponse(cached)
      return Promise.reject(error)
    }
  }
}

if (!Capacitor.isNativePlatform()) {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    const method = String(init?.method || 'GET').toUpperCase()

    if (!canCacheApiGet(url, method)) {
      return originalFetch(input, init)
    }

    try {
      const networkRes = await withTimeout(() => originalFetch(input, init), 12000)
      writeCachedApiResponse(url, networkRes)
      return networkRes
    } catch (error) {
      const cached = readCachedApiResponse(url)
      if (cached) return toCachedResponse(cached)
      return Promise.reject(error)
    }
  }
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

setTimeout(() => {
  startupWarmCache().catch(() => {})
}, 1500)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <DataStoreProvider>
        <BrowserRouter>
          <SplashScreen />
          <App />
        </BrowserRouter>
      </DataStoreProvider>
    </AuthProvider>
  </StrictMode>,
)
