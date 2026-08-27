import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

/* ─── Canvas Helpers ──────────────────────────────────────────────── */

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

let bgRemovalModulePromise = null
let bgRemovalPreloadPromise = null
const playerCutoutCache = new Map()

const BG_REMOVAL_TIMEOUT_MS = 4500
const BG_REMOVAL_MAX_EDGE = 1200

const timeoutAfter = (ms) => new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Background removal timed out')), ms)
})

async function toSegmentationBlob(originalImg, rawSrc) {
  if (!originalImg) {
    return fetch(rawSrc).then((r) => r.blob())
  }

  const maxEdge = Math.max(originalImg.width || 0, originalImg.height || 0)
  if (!maxEdge || maxEdge <= BG_REMOVAL_MAX_EDGE) {
    return fetch(rawSrc).then((r) => r.blob())
  }

  const scale = BG_REMOVAL_MAX_EDGE / maxEdge
  const targetW = Math.max(1, Math.round(originalImg.width * scale))
  const targetH = Math.max(1, Math.round(originalImg.height * scale))

  const resizeCanvas = document.createElement('canvas')
  resizeCanvas.width = targetW
  resizeCanvas.height = targetH
  const resizeCtx = resizeCanvas.getContext('2d')
  resizeCtx.imageSmoothingEnabled = true
  resizeCtx.imageSmoothingQuality = 'high'
  resizeCtx.drawImage(originalImg, 0, 0, targetW, targetH)

  const resizedBlob = await new Promise((resolve) => {
    resizeCanvas.toBlob((blob) => resolve(blob), 'image/png', 0.95)
  })

  return resizedBlob || fetch(rawSrc).then((r) => r.blob())
}

async function loadPlayerPortrait(src, { removeBackground = true } = {}) {
  const key = `${removeBackground ? 'cutout' : 'raw'}:${String(src || '')}`
  if (playerCutoutCache.has(key)) return playerCutoutCache.get(key)

  const task = (async () => {
    const rawSrc = String(src || '').trim()
    if (!rawSrc) return { img: null, backgroundRemoved: false }

    const original = await loadImage(rawSrc)
    if (!removeBackground) return { img: original, backgroundRemoved: false }

    try {
      if (!bgRemovalModulePromise) {
        bgRemovalModulePromise = import('@imgly/background-removal')
      }
      const {
        removeBackground: runBackgroundRemoval,
        preload: preloadBackgroundRemoval,
      } = await bgRemovalModulePromise

      if (!bgRemovalPreloadPromise && typeof preloadBackgroundRemoval === 'function') {
        bgRemovalPreloadPromise = preloadBackgroundRemoval({
          device: 'cpu',
          proxyToWorker: true,
          rescale: true,
          debug: false,
        }).catch(() => {})
      }

      const inputBlob = await toSegmentationBlob(original, rawSrc)
      const outputBlob = await Promise.race([
        runBackgroundRemoval(inputBlob, {
          device: 'cpu',
          proxyToWorker: true,
          rescale: true,
          debug: false,
        }),
        timeoutAfter(BG_REMOVAL_TIMEOUT_MS),
      ])
      const objectUrl = URL.createObjectURL(outputBlob)
      const cutout = await loadImage(objectUrl)
      URL.revokeObjectURL(objectUrl)
      if (cutout) return { img: cutout, backgroundRemoved: true }
    } catch (error) {
      console.warn('Background removal skipped for player image:', error?.message || error)
    }

    return { img: original, backgroundRemoved: false }
  })()

  playerCutoutCache.set(key, task)
  return task
}

function fitText(ctx, text, maxWidth, startSize = 72, minSize = 14, weight = '900') {
  let size = startSize
  while (size >= minSize) {
    ctx.font = `${weight} ${size}px "Barlow Condensed", "Oswald", sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 1
  }
  return size
}

function drawCover(ctx, img, x, y, w, h) {
  if (!img) return
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale, sh = h / scale
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function drawPassport(ctx, img, x, y, w, h) {
  ctx.save()
  ctx.fillStyle = '#0d1730'
  ctx.fillRect(x, y, w, h)
  if (img) {
    const scale = Math.max(w / img.width, h / img.height)
    const sw = w / scale, sh = h / scale
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 3
    ctx.drawImage(img, sx, Math.max(0, sy), sw, sh, x, y, w, h)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

function hexToRgba(hex, alpha = 1) {
  const raw = String(hex || '').trim()
  if (!raw) return `rgba(255,255,255,${alpha})`

  let normalized = raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    normalized = `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  }

  const match = normalized.match(/^#([0-9a-fA-F]{6})$/)
  if (!match) return `rgba(255,255,255,${alpha})`

  const value = match[1]
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/* Gold accent bar */
function goldBar(ctx, x, y, w, h = 6) {
  const g = ctx.createLinearGradient(x, y, x + w, y)
  g.addColorStop(0, '#f0b429')
  g.addColorStop(0.5, '#ffe066')
  g.addColorStop(1, '#c97b10')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/* Diagonal swoosh overlay */
function swoosh(ctx, W, H, color = 'rgba(255,255,255,0.04)') {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(W * 0.55, 0)
  ctx.lineTo(W * 0.72, 0)
  ctx.lineTo(W * 0.62, H)
  ctx.lineTo(W * 0.45, H)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/* Dot matrix texture */
function dotMatrix(ctx, W, H) {
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let i = 0; i < W; i += 28) {
    for (let j = 0; j < H; j += 28) {
      ctx.beginPath()
      ctx.arc(i, j, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/* Bold label + value row */
function statRow(ctx, label, value, x, y, labelColor = '#94a3b8', valueColor = '#ffffff', size = 32) {
  ctx.fillStyle = labelColor
  ctx.font = `600 ${size * 0.7}px "Barlow Condensed", sans-serif`
  ctx.fillText(label.toUpperCase(), x, y)
  ctx.fillStyle = valueColor
  ctx.font = `900 ${size}px "Barlow Condensed", sans-serif`
  ctx.fillText(value, x, y + size * 1.05)
}

function createCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  return { canvas, ctx: canvas.getContext('2d') }
}

async function saveBanner({ category, fileName, imageData }) {
  const res = await fetch(`${API}/banners/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, fileName, imageData })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to save banner')
  return data
}

async function downloadPng(dataUrl, fileName) {
  if (Capacitor.isNativePlatform()) {
    const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '')
    const path = `CricketHub/${fileName}`
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    })

    try {
      const uri = await Filesystem.getUri({ path, directory: Directory.Documents })
      await Share.share({
        title: 'CricketHub Banner',
        text: fileName,
        url: uri.uri,
        dialogTitle: 'Save or Share Banner',
      })
    } catch {
      // Share sheet can be unavailable on some devices; file is still saved.
    }
    return
  }

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.click()
}

/* ─── Banner Generators ───────────────────────────────────────────── */

async function _generateLeagueBanner(leagueId) {
  const leagueDetails = await fetch(`${API}/leagues/${leagueId}`).then(r => r.json())

  // Load league logo + owner photo + up to 5 sponsor logos
  const sponsorList = (leagueDetails.sponsors || []).slice(0, 5)
  const [logo, ownerImg, ...sponsorImgs] = await Promise.all([
    loadImage(leagueDetails.logo),
    loadImage(leagueDetails.owner_photo || leagueDetails.organizer_photo || null),
    ...sponsorList.map(s => loadImage(s.logo || s.image || null)),
  ])

  const W = 1920, H = 720
  const { canvas, ctx } = createCanvas(W, H)

  /* ── 1. ICC-LEVEL BACKGROUND ── */
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0,   '#010a1a')
  bg.addColorStop(0.4, '#041228')
  bg.addColorStop(0.8, '#061530')
  bg.addColorStop(1,   '#020c20')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Radial highlight behind logo
  const loHighlight = ctx.createRadialGradient(W * 0.25, H * 0.45, 0, W * 0.25, H * 0.45, 380)
  loHighlight.addColorStop(0, 'rgba(240,180,41,0.10)')
  loHighlight.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = loHighlight; ctx.fillRect(0, 0, W, H)

  // Right-side cyan accent glow
  const rightGlow = ctx.createLinearGradient(W * 0.7, 0, W, H)
  rightGlow.addColorStop(0, 'rgba(0,200,210,0.0)')
  rightGlow.addColorStop(1, 'rgba(0,200,210,0.10)')
  ctx.fillStyle = rightGlow; ctx.fillRect(0, 0, W, H)

  // Hexagonal grid overlay
  ctx.save()
  ctx.globalAlpha = 0.035
  ctx.strokeStyle = '#6090e0'
  ctx.lineWidth = 1
  const hexR = 50
  for (let row = -1; row < H / (hexR * 1.5) + 2; row++) {
    for (let col = -1; col < W / (hexR * 1.73) + 2; col++) {
      const hx = col * hexR * 1.73 + (row % 2) * hexR * 0.865
      const hy = row * hexR * 1.5
      ctx.beginPath()
      for (let s = 0; s < 6; s++) {
        const a = (Math.PI / 3) * s - Math.PI / 6
        s === 0 ? ctx.moveTo(hx + hexR * Math.cos(a), hy + hexR * Math.sin(a))
                : ctx.lineTo(hx + hexR * Math.cos(a), hy + hexR * Math.sin(a))
      }
      ctx.closePath(); ctx.stroke()
    }
  }
  ctx.globalAlpha = 1; ctx.restore()

  // Diagonal ICC swoosh
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.025)'
  ctx.beginPath()
  ctx.moveTo(W * 0.50, 0); ctx.lineTo(W * 0.68, 0)
  ctx.lineTo(W * 0.58, H); ctx.lineTo(W * 0.40, H)
  ctx.closePath(); ctx.fill()
  ctx.restore()

  goldBar(ctx, 0, 0, W, 10)

  /* ── 2. LEFT: LEAGUE LOGO (large, prominent) ── */
  const LOGO_SIZE = 240
  const LOGO_X = 80, LOGO_Y = H / 2 - LOGO_SIZE / 2

  const logoGlow = ctx.createRadialGradient(LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2, 20,
                                             LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2, LOGO_SIZE * 0.82)
  logoGlow.addColorStop(0, 'rgba(240,180,41,0.22)')
  logoGlow.addColorStop(1, 'rgba(240,180,41,0)')
  ctx.fillStyle = logoGlow; ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.beginPath()
  ctx.arc(LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2, LOGO_SIZE / 2, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,10,30,0.80)'
  ctx.fill()
  if (logo) {
    ctx.clip()
    const lScale = Math.min(LOGO_SIZE / logo.width, LOGO_SIZE / logo.height)
    const lw = logo.width * lScale, lh = logo.height * lScale
    ctx.drawImage(logo, LOGO_X + (LOGO_SIZE - lw) / 2, LOGO_Y + (LOGO_SIZE - lh) / 2, lw, lh)
  }
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2, LOGO_SIZE / 2 + 4, 0, Math.PI * 2)
  ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 3; ctx.stroke()
  ctx.restore()

  /* ── 3. CENTRE: LEAGUE NAME + META INFO ── */
  const textX = LOGO_X + LOGO_SIZE + 60
  const title = (leagueDetails.name || 'LEAGUE').toUpperCase()
  const season = (leagueDetails.season || '').toUpperCase()
  const titleSize = fitText(ctx, title, 880, 100, 36)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 20
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 ${titleSize}px "Barlow Condensed", "Oswald", sans-serif`
  ctx.fillText(title, textX, 280)
  ctx.shadowBlur = 0; ctx.restore()

  goldBar(ctx, textX, 294, Math.min(650, title.length * titleSize * 0.55), 5)

  if (season) {
    ctx.fillStyle = '#f0b429'
    ctx.font = `700 44px "Barlow Condensed", sans-serif`
    ctx.fillText(season, textX, 358)
  }

  const metaParts = [leagueDetails.city, leagueDetails.format || 'T20', leagueDetails.organizer].filter(Boolean)
  if (metaParts.length) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = `600 28px "Barlow Condensed", sans-serif`
    ctx.fillText(metaParts.join('  ·  '), textX, 410)
  }

  /* ── 4. RIGHT: OWNER / ORGANIZER PROFILE CARD ── */
  const ownerPanelX = W - 360
  const ownerPanelY = 80
  const ownerPanelW = 280
  const ownerPanelH = H - 180

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.strokeStyle = 'rgba(240,180,41,0.30)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(ownerPanelX, ownerPanelY, ownerPanelW, ownerPanelH, 12)
  ctx.fill(); ctx.stroke()
  ctx.restore()

  goldBar(ctx, ownerPanelX, ownerPanelY, ownerPanelW, 4)

  ctx.fillStyle = '#f0b429'
  ctx.font = `700 18px "Barlow Condensed", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('LEAGUE ORGANIZER', ownerPanelX + ownerPanelW / 2, ownerPanelY + 28)
  ctx.textAlign = 'left'

  const ownerCX = ownerPanelX + ownerPanelW / 2
  const ownerCY = ownerPanelY + 140
  const ownerR = 80
  ctx.save()
  ctx.beginPath()
  ctx.arc(ownerCX, ownerCY, ownerR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(15,30,60,0.80)'; ctx.fill()
  if (ownerImg) {
    ctx.clip()
    const oScale = Math.max((ownerR * 2) / ownerImg.width, (ownerR * 2) / ownerImg.height)
    const ow = ownerImg.width * oScale, oh = ownerImg.height * oScale
    ctx.drawImage(ownerImg, ownerCX - ow / 2, ownerCY - oh / 2 - oh * 0.05, ow, oh)
  } else {
    const initials = (leagueDetails.organizer || 'O').charAt(0).toUpperCase()
    ctx.font = `900 52px "Barlow Condensed", sans-serif`
    ctx.fillStyle = '#f0b429'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(initials, ownerCX, ownerCY)
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  }
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(ownerCX, ownerCY, ownerR + 3, 0, Math.PI * 2)
  ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2.5; ctx.stroke()
  ctx.restore()

  const ownerName = (leagueDetails.owner_name || leagueDetails.organizer || 'ORGANIZER').toUpperCase()
  const ownerFontSz = fitText(ctx, ownerName, ownerPanelW - 20, 28, 14)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 ${ownerFontSz}px "Barlow Condensed", sans-serif`
  ctx.fillText(ownerName, ownerCX, ownerCY + ownerR + 38)
  ctx.fillStyle = '#94a3b8'
  ctx.font = `600 18px "Barlow Condensed", sans-serif`
  ctx.fillText(leagueDetails.owner_title || 'PRESIDENT & OWNER', ownerCX, ownerCY + ownerR + 62)
  ctx.textAlign = 'left'; ctx.restore()

  /* ── 5. BOTTOM: SPONSORS LOGO STRIP ── */
  const STRIP_H = 100
  const STRIP_Y = H - STRIP_H - 10

  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, STRIP_Y, W - 380, STRIP_H)
  goldBar(ctx, 0, STRIP_Y, W - 380, 3)

  ctx.fillStyle = '#64748b'
  ctx.font = `700 18px "Barlow Condensed", sans-serif`
  ctx.fillText('OFFICIAL PARTNERS', textX, STRIP_Y + 26)

  const SPONSOR_LOGO_H = 52
  const SPONSOR_LOGO_W = 110
  const sponsorY = STRIP_Y + 34

  if (sponsorList.length > 0) {
    sponsorList.forEach((sponsor, idx) => {
      const sx = textX + idx * (SPONSOR_LOGO_W + 24)
      const sImg = sponsorImgs[idx]
      if (sImg) {
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(sx, sponsorY, SPONSOR_LOGO_W, SPONSOR_LOGO_H, 6)
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); ctx.clip()
        const sScale = Math.min(SPONSOR_LOGO_W / sImg.width, SPONSOR_LOGO_H / sImg.height)
        const sw2 = sImg.width * sScale, sh2 = sImg.height * sScale
        ctx.drawImage(sImg, sx + (SPONSOR_LOGO_W - sw2) / 2, sponsorY + (SPONSOR_LOGO_H - sh2) / 2, sw2, sh2)
        ctx.restore()
        ctx.strokeStyle = 'rgba(240,180,41,0.25)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(sx, sponsorY, SPONSOR_LOGO_W, SPONSOR_LOGO_H, 6); ctx.stroke()
      } else {
        ctx.save()
        ctx.fillStyle = 'rgba(240,180,41,0.12)'
        ctx.strokeStyle = 'rgba(240,180,41,0.35)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(sx, sponsorY, SPONSOR_LOGO_W, SPONSOR_LOGO_H, 6); ctx.fill(); ctx.stroke()
        const sName = (sponsor.name || '').toUpperCase()
        const sFontSz = fitText(ctx, sName, SPONSOR_LOGO_W - 12, 20, 10)
        ctx.fillStyle = '#e2e8f0'; ctx.font = `700 ${sFontSz}px "Barlow Condensed", sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(sName, sx + SPONSOR_LOGO_W / 2, sponsorY + SPONSOR_LOGO_H * 0.63)
        ctx.textAlign = 'left'; ctx.restore()
      }
    })
  } else {
    ctx.fillStyle = '#475569'
    ctx.font = `600 24px "Barlow Condensed", sans-serif`
    ctx.fillText('Official Partners TBA', textX, sponsorY + SPONSOR_LOGO_H * 0.65)
  }

  goldBar(ctx, 0, H - 6, W, 6)

  return { canvas, id: leagueDetails.id, name: 'league_banner' }
}

/* ── ICC-style corner bracket around a circular player photo ── */
function drawPlayerCard(ctx, img, cx, cy, r, name, accentColor, nameFontSize) {
  nameFontSize = nameFontSize || 20

  // Dark circle background
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#1a2340'
  ctx.fill()
  ctx.restore()

  if (img) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    // FIT (contain) — entire image visible, no zoom crop
    const diameter = r * 2
    const scale = Math.min(diameter / img.width, diameter / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = cx - dw / 2
    const dy = cy - dh / 2 - dh * 0.04   // nudge up slightly to favour faces
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh)
    ctx.restore()
  }

  // Outer ring
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  // ICC-style corner brackets — sized proportionally to radius
  const pad = Math.round(r * 0.14)
  const bx = cx - r - pad, by = cy - r - pad
  const bw = (r + pad) * 2, bh = (r + pad) * 2
  const bl = Math.round(r * 0.28)
  const bth = Math.max(2, Math.round(r * 0.04))
  ctx.save()
  ctx.strokeStyle = accentColor
  ctx.lineWidth = bth
  ctx.lineCap = 'square'
  ctx.beginPath(); ctx.moveTo(bx, by + bl); ctx.lineTo(bx, by); ctx.lineTo(bx + bl, by); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(bx + bw - bl, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + bl); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(bx, by + bh - bl); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + bl, by + bh); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(bx + bw - bl, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - bl); ctx.stroke()
  ctx.restore()

  // Player name — two lines, centered below circle
  const nameY = cy + r + pad + nameFontSize + 4
  const lineH = nameFontSize * 1.15
  const words = (name || '').toUpperCase().split(' ')
  const mid = Math.ceil(words.length / 2)
  const line1 = words.slice(0, mid).join(' ')
  const line2 = words.slice(mid).join(' ')

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${nameFontSize}px "Barlow Condensed", sans-serif`
  ctx.fillText(line1, cx, nameY)
  if (line2) {
    ctx.fillStyle = '#b8cce0'
    ctx.font = `600 ${Math.round(nameFontSize * 0.88)}px "Barlow Condensed", sans-serif`
    ctx.fillText(line2, cx, nameY + lineH)
  }
  ctx.restore()
}

/* ── ICC-style diagonal geometric spike ── */
function drawSpike(ctx, W, H, color) {
  ctx.save()
  ctx.fillStyle = color
  // Top-right spike
  ctx.beginPath()
  ctx.moveTo(W - 220, 0)
  ctx.lineTo(W, 0)
  ctx.lineTo(W, 260)
  ctx.lineTo(W - 60, 0)
  ctx.closePath()
  ctx.fill()
  // Second spike offset
  ctx.beginPath()
  ctx.moveTo(W - 130, 0)
  ctx.lineTo(W - 60, 0)
  ctx.lineTo(W, 200)
  ctx.lineTo(W, 260)
  ctx.closePath()
  ctx.fillStyle = color + '88'
  ctx.fill()
  // Bottom-right spike
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(W, H - 220)
  ctx.lineTo(W, H)
  ctx.lineTo(W - 220, H)
  ctx.lineTo(W - 60, H - 60)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(W - 130, H)
  ctx.lineTo(W, H - 130)
  ctx.lineTo(W, H - 220)
  ctx.lineTo(W - 220, H)
  ctx.closePath()
  ctx.fillStyle = color + '55'
  ctx.fill()
  ctx.restore()
}

async function _generateTeamBanner(teamId) {
  const [team, players] = await Promise.all([
    fetch(`${API}/teams/${teamId}`).then(r => r.json()),
    fetch(`${API}/teams/${teamId}/players`).then(r => r.json())
  ])
  const leagueObj = team?.league_id
    ? await fetch(`${API}/leagues/${team.league_id}`).then(r => r.json()).catch(() => null)
    : null

  const captain = players.find(p => p.id === team.captain_id) || players.find(p => p.name === team.captain_name) || players[0]
  const others = players.filter(p => p.id !== captain?.id).slice(0, 15)
  const captainImg = await loadImage(captain?.photo)
  const playerImgs = await Promise.all(others.map(p => loadImage(p.photo)))
  const teamLogo = await loadImage(team.logo)

  // ICC accent color — magenta/pink like the reference
  const ACCENT = '#e91e8c'
  const ACCENT2 = '#c2185b'

  const W = 1920, H = 1080
  const { canvas, ctx } = createCanvas(W, H)

  // ── Background: deep navy-indigo gradient ──
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0d0d2b')
  bg.addColorStop(0.5, '#0e1535')
  bg.addColorStop(1, '#0a0d26')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Subtle radial light behind players grid area
  const radial = ctx.createRadialGradient(W * 0.62, H * 0.5, 80, W * 0.62, H * 0.5, 700)
  radial.addColorStop(0, 'rgba(255,255,255,0.04)')
  radial.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = radial
  ctx.fillRect(0, 0, W, H)

  dotMatrix(ctx, W, H)

  // ── Pink geometric spikes (top-right + bottom-right) ──
  drawSpike(ctx, W, H, ACCENT)

  // ── Watermark team name behind captain ──
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 210px "Barlow Condensed", sans-serif`
  ctx.textAlign = 'left'
  const wm = (team.name || 'TEAM').toUpperCase()
  ctx.fillText(wm, -10, H - 30)
  ctx.globalAlpha = 1
  ctx.restore()

  // ── Captain left panel ──
  // Full-height portrait bleed, left side
  const capW = 390, capH = H
  if (captainImg) {
    // Draw captain image covering full left panel height
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, capW, capH)
    ctx.clip()
    // Scale to fill height
    const scale = Math.max(capW / captainImg.width, capH / captainImg.height)
    const sw = capW / scale, sh = capH / scale
    const sx = (captainImg.width - sw) / 2
    const sy = Math.max(0, (captainImg.height - sh) / 5) // show upper body / face
    ctx.drawImage(captainImg, sx, sy, sw, sh, 0, 0, capW, capH)
    // Fade right edge of captain to background
    const fadeW = ctx.createLinearGradient(capW - 120, 0, capW, 0)
    fadeW.addColorStop(0, 'rgba(13,13,43,0)')
    fadeW.addColorStop(1, 'rgba(13,13,43,1)')
    ctx.fillStyle = fadeW
    ctx.fillRect(0, 0, capW, capH)
    ctx.restore()
  } else {
    // Placeholder
    ctx.fillStyle = '#151a3a'
    ctx.fillRect(0, 0, capW, capH)
  }

  // Captain name + label block (bottom-left)
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, H - 160, capW, 160)
  // Pink accent bar on left
  ctx.fillStyle = ACCENT
  ctx.fillRect(0, H - 160, 5, 160)

  // Team logo small top-left
  if (teamLogo) {
    drawCover(ctx, teamLogo, 16, 16, 64, 64)
  }

  // Captain name (large, two lines if needed)
  const capNameParts = (captain?.name || 'CAPTAIN').toUpperCase().split(' ')
  const capFirst = capNameParts.slice(0, -1).join(' ')
  const capLast = capNameParts[capNameParts.length - 1]
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 62px "Barlow Condensed", sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(capFirst || capLast, 18, H - 96)
  if (capFirst) {
    ctx.fillText(capLast, 18, H - 28)
  }
  // CAPTAIN label
  ctx.fillStyle = ACCENT
  ctx.font = `700 22px "Barlow Condensed", sans-serif`
  ctx.fillText('(CAPTAIN)', 18, H - 8)
  ctx.restore()

  // ── Vertical divider line ──
  const divX = capW + 12
  const divGrad = ctx.createLinearGradient(divX, 60, divX, H - 60)
  divGrad.addColorStop(0, 'rgba(233,30,140,0)')
  divGrad.addColorStop(0.3, ACCENT)
  divGrad.addColorStop(0.7, ACCENT)
  divGrad.addColorStop(1, 'rgba(233,30,140,0)')
  ctx.fillStyle = divGrad
  ctx.fillRect(divX, 60, 2, H - 120)

  // ── Title block (centered in right panel) ──
  const rightX = divX + 30
  const rightW = W - rightX - 40
  const titleCx = rightX + rightW / 2

  const titleLine1 = ((team.name || 'TEAM') + ' SQUAD').toUpperCase()
  const titleLine2 = (
    team.event
    || leagueObj?.name
    || team.league_name
    || 'CRICKET LEAGUE'
  ).toUpperCase()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  const t1size = fitText(ctx, titleLine1, rightW - 80, 72, 28)
  ctx.font = `900 ${t1size}px "Barlow Condensed", sans-serif`
  ctx.fillText(titleLine1, titleCx, 90)

  ctx.fillStyle = '#c8d4e8'
  const t2size = fitText(ctx, titleLine2, rightW - 80, 40, 18)
  ctx.font = `700 ${t2size}px "Barlow Condensed", sans-serif`
  ctx.fillText(titleLine2, titleCx, 130)

  // Pink underline below title
  const ulW = Math.min(600, rightW * 0.6)
  const ulGrad = ctx.createLinearGradient(titleCx - ulW / 2, 0, titleCx + ulW / 2, 0)
  ulGrad.addColorStop(0, 'rgba(233,30,140,0)')
  ulGrad.addColorStop(0.5, ACCENT)
  ulGrad.addColorStop(1, 'rgba(233,30,140,0)')
  ctx.fillStyle = ulGrad
  ctx.fillRect(titleCx - ulW / 2, 140, ulW, 3)
  ctx.restore()

  // ── Player grid — auto-fit to available space ──
  const cols = 5
  const rows = Math.ceil(others.length / cols)

  // Available area: from title bottom (y=155) to canvas bottom minus bottom padding (20px)
  const gridTop    = 158
  const gridBottom = H - 22
  const gridLeft   = rightX + 10
  const gridRight  = W - 30          // leave 30px gap from spikes on right
  const availW     = gridRight - gridLeft
  const availH     = gridBottom - gridTop

  // Each card must contain: circle diameter + bracket pad each side + name lines below
  // Name block height = nameFontSize + lineH + small gap ≈ nameFontSize * 2.5
  // We solve for r from: rows * (2r + 2*pad + nameBlock) = availH
  // and cols * (2r + 2*pad + colGap) = availW
  // Estimate nameBlock = r*0.55, pad = r*0.14 each side => total vertical per card ≈ r*(2+0.28+0.55) = r*2.83
  // Estimate colGap = r*0.3 => total horizontal per card ≈ r*(2+0.28+0.30) = r*2.58
  const rFromH = availH / (rows * 2.88)
  const rFromW = availW / (cols * 2.62)
  const playerR = Math.floor(Math.min(rFromH, rFromW))

  // Derive paddings from radius
  const bracketPad  = Math.round(playerR * 0.14)
  const nameFontSz  = Math.max(14, Math.round(playerR * 0.27))
  const nameBlock   = nameFontSz * 2.5          // two name lines + gap
  const cardW       = playerR * 2 + bracketPad * 2 + Math.round(playerR * 0.28)
  const cardH       = playerR * 2 + bracketPad * 2 + nameBlock + Math.round(playerR * 0.1)

  // Center the full grid within available space
  const totalGridW  = cols * cardW
  const totalGridH  = rows * cardH
  const gStartX     = gridLeft + (availW - totalGridW) / 2 + cardW / 2
  const gStartY     = gridTop  + (availH - totalGridH) / 2 + playerR + bracketPad

  others.forEach((player, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx  = gStartX + col * cardW
    const cy  = gStartY + row * cardH
    drawPlayerCard(ctx, playerImgs[i], cx, cy, playerR, player.name || '', ACCENT, nameFontSz)
  })

  return { canvas, id: team.id, name: 'team_banner' }
}

async function _generateCaptainPoster(teamId) {
  const [team, players] = await Promise.all([
    fetch(`${API}/teams/${teamId}`).then(r => r.json()),
    fetch(`${API}/teams/${teamId}/players`).then(r => r.json())
  ])
  const captain = players.find(p => p.id === team.captain_id) || players.find(p => p.name === team.captain_name) || players[0]
  const leagueObj = team?.league_id
    ? await fetch(`${API}/leagues/${team.league_id}`).then(r => r.json()).catch(() => null)
    : null
  const [captainImg, teamLogo, leagueLogo] = await Promise.all([
    loadImage(captain?.photo),
    loadImage(team.logo),
    loadImage(leagueObj?.logo || null)
  ])

  const W = 1600, H = 900
  const { canvas, ctx } = createCanvas(W, H)

  /* ── 1. ICC-LEVEL BACKGROUND ── */
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#010d1f')
  bg.addColorStop(0.5, '#041626')
  bg.addColorStop(1, '#020e1c')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  // Hexagonal background grid
  ctx.save()
  ctx.globalAlpha = 0.04; ctx.strokeStyle = '#4070c0'; ctx.lineWidth = 1
  const hR = 48
  for (let row = -1; row < H / (hR * 1.5) + 2; row++) {
    for (let col = -1; col < W / (hR * 1.73) + 2; col++) {
      const hx = col * hR * 1.73 + (row % 2) * hR * 0.865, hy = row * hR * 1.5
      ctx.beginPath()
      for (let s = 0; s < 6; s++) {
        const a = (Math.PI / 3) * s - Math.PI / 6
        s === 0 ? ctx.moveTo(hx + hR * Math.cos(a), hy + hR * Math.sin(a))
                : ctx.lineTo(hx + hR * Math.cos(a), hy + hR * Math.sin(a))
      }
      ctx.closePath(); ctx.stroke()
    }
  }
  ctx.globalAlpha = 1; ctx.restore()

  // Right-side glow for ICC feel
  const rightGlow = ctx.createRadialGradient(W * 0.72, H * 0.5, 0, W * 0.72, H * 0.5, 500)
  rightGlow.addColorStop(0, 'rgba(240,180,41,0.08)')
  rightGlow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = rightGlow; ctx.fillRect(0, 0, W, H)

  // Diagonal accent strip
  ctx.save()
  ctx.fillStyle = 'rgba(240,180,41,0.06)'
  ctx.beginPath()
  ctx.moveTo(W * 0.48, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.40, H)
  ctx.closePath(); ctx.fill(); ctx.restore()

  goldBar(ctx, 0, 0, W, 10)
  goldBar(ctx, 0, H - 8, W, 8)
  // Left gold accent stripe
  const la = ctx.createLinearGradient(0, 0, 0, H)
  la.addColorStop(0, '#f0b429'); la.addColorStop(1, 'rgba(240,180,41,0)')
  ctx.fillStyle = la; ctx.fillRect(0, 0, 6, H)

  /* ── 2. CAPTAIN FULL-BODY PORTRAIT (left, ICC-style background removed look) ── */
  const capAreaX = 0, capAreaY = 0, capAreaW = 620, capAreaH = H
  if (captainImg) {
    ctx.save()
    // Scale to fill height, containing width
    const scale = Math.min(capAreaW / captainImg.width, capAreaH / captainImg.height)
    const dw = captainImg.width * scale, dh = captainImg.height * scale
    const dx = capAreaX + (capAreaW - dw) / 2
    const dy = capAreaH - dh // anchor to bottom

    ctx.drawImage(captainImg, 0, 0, captainImg.width, captainImg.height, dx, dy, dw, dh)

    // Right fade to blend into background
    const fadeR = ctx.createLinearGradient(capAreaW - 160, 0, capAreaW, 0)
    fadeR.addColorStop(0, 'rgba(1,13,31,0)')
    fadeR.addColorStop(1, 'rgba(1,13,31,1)')
    ctx.fillStyle = fadeR; ctx.fillRect(0, 0, capAreaW, H)

    // Bottom fade
    const fadeB = ctx.createLinearGradient(0, H * 0.75, 0, H)
    fadeB.addColorStop(0, 'rgba(1,13,31,0)')
    fadeB.addColorStop(1, 'rgba(1,13,31,0.35)')
    ctx.fillStyle = fadeB; ctx.fillRect(0, 0, capAreaW, H)
    ctx.restore()
  } else {
    ctx.fillStyle = 'rgba(15,25,50,0.80)'
    ctx.fillRect(capAreaX, capAreaY, capAreaW, capAreaH)
  }

  /* ── 3. RIGHT PANEL: Captain info ── */
  const infX = 660

  // Team logo (large)
  if (teamLogo) {
    ctx.save()
    ctx.globalAlpha = 0.18
    const logoW = 300, logoH = 300
    const scale = Math.min(logoW / teamLogo.width, logoH / teamLogo.height)
    const lw = teamLogo.width * scale, lh = teamLogo.height * scale
    ctx.drawImage(teamLogo, W - lw - 60, 60, lw, lh)
    ctx.globalAlpha = 1; ctx.restore()
    // Solid small logo
    const sW = 90, sH = 90
    const ss = Math.min(sW / teamLogo.width, sH / teamLogo.height)
    const slw = teamLogo.width * ss, slh = teamLogo.height * ss
    ctx.drawImage(teamLogo, infX, 60, slw, slh)
  }

  // League logo (small)
  if (leagueLogo) {
    const lsW = 70, lsH = 70
    const lss = Math.min(lsW / leagueLogo.width, lsH / leagueLogo.height)
    const llw = leagueLogo.width * lss, llh = leagueLogo.height * lss
    ctx.drawImage(leagueLogo, infX + 100, 65, llw, llh)
  }

  // Captain name (large ICC style)
  const capNameParts = (captain?.name || 'CAPTAIN').toUpperCase().split(' ')
  const capFirst = capNameParts.slice(0, -1).join(' ')
  const capLast = capNameParts[capNameParts.length - 1]

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 24
  ctx.fillStyle = '#ffffff'
  const ns1 = fitText(ctx, capFirst || capLast, W - infX - 80, 120, 40)
  ctx.font = `900 italic ${ns1}px "Barlow Condensed", "Oswald", sans-serif`
  ctx.fillText(capFirst || capLast, infX, 340)
  if (capFirst) {
    const ns2 = fitText(ctx, capLast, W - infX - 80, 120, 40)
    ctx.font = `900 italic ${ns2}px "Barlow Condensed", "Oswald", sans-serif`
    ctx.fillText(capLast, infX, 460)
  }
  ctx.shadowBlur = 0; ctx.restore()

  goldBar(ctx, infX, 475, Math.min(700, W - infX - 60), 5)

  // CAPTAIN badge
  ctx.fillStyle = '#f0b429'
  ctx.font = `900 52px "Barlow Condensed", sans-serif`
  ctx.fillText('⭐ CAPTAIN', infX, 540)

  // Team name
  const teamNameSz = fitText(ctx, (team.name || '').toUpperCase(), W - infX - 60, 52, 20)
  ctx.fillStyle = '#e2e8f0'
  ctx.font = `700 ${teamNameSz}px "Barlow Condensed", sans-serif`
  ctx.fillText((team.name || '').toUpperCase(), infX, 600)

  /* ── 4. LEAGUE INFO STRIP ── */
  const leagueStripY = H - 160
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fillRect(infX - 20, leagueStripY, W - infX, 120)
  goldBar(ctx, infX - 20, leagueStripY, W - infX, 3)

  // League name
  const leagueName = (leagueObj?.name || team.league_name || 'CRICKET LEAGUE').toUpperCase()
  const lnSz = fitText(ctx, leagueName, W - infX - 60, 44, 18)
  ctx.fillStyle = '#f0b429'
  ctx.font = `800 ${lnSz}px "Barlow Condensed", sans-serif`
  ctx.fillText(leagueName, infX, leagueStripY + 44)

  const leagueMeta = [
    leagueObj?.season || team.season,
    leagueObj?.city || team.city,
    leagueObj?.format || 'T20',
    leagueObj?.organizer || ''
  ].filter(Boolean).join('  ·  ')

  ctx.fillStyle = '#94a3b8'
  ctx.font = `600 26px "Barlow Condensed", sans-serif`
  ctx.fillText(leagueMeta, infX, leagueStripY + 82)

  /* ── 5. CAPTAIN NAME BLOCK bottom-left overlay ── */
  ctx.fillStyle = 'rgba(0,0,0,0.60)'
  ctx.fillRect(0, H - 140, capAreaW, 140)
  goldBar(ctx, 0, H - 140, capAreaW, 4)
  ctx.fillStyle = '#f0b429'
  ctx.fillRect(0, H - 140, 5, 140)

  ctx.fillStyle = '#ffffff'
  ctx.font = `900 56px "Barlow Condensed", sans-serif`
  ctx.fillText(capFirst || capLast, 18, H - 80)
  if (capFirst) {
    ctx.fillStyle = '#f0b429'
    ctx.font = `700 56px "Barlow Condensed", sans-serif`
    ctx.fillText(capLast, 18, H - 22)
  }

  return { canvas, id: team.id, name: 'captain_banner' }
}

async function _generateVsBanner(match, leagueObj, options = {}) {
  const isIccTheme = String(options?.theme || '').toLowerCase() === 'icc'
  const removeBgForPlayers = options?.removeBackground === true
  const playerVerticalAlign = String(options?.playerVerticalAlign || 'bottom').toLowerCase()

  const normalizeColor = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return null
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
    }
    return null
  }

  const teamPalette = (team, fallbackPrimary, fallbackSecondary) => {
    const primary = normalizeColor(team?.primary_color)
      || normalizeColor(team?.primaryColor)
      || normalizeColor(team?.team_color)
      || normalizeColor(team?.color)
      || normalizeColor(team?.brand_color)
      || fallbackPrimary
    const secondary = normalizeColor(team?.secondary_color)
      || normalizeColor(team?.secondaryColor)
      || normalizeColor(team?.accent_color)
      || fallbackSecondary
    return { primary, secondary }
  }

  const [teamA, teamB, teamAPlayers, teamBPlayers] = await Promise.all([
    fetch(`${API}/teams/${match.team_a_id}`).then(r => r.json()),
    fetch(`${API}/teams/${match.team_b_id}`).then(r => r.json()),
    fetch(`${API}/teams/${match.team_a_id}/players`).then(r => r.json()).catch(() => []),
    fetch(`${API}/teams/${match.team_b_id}/players`).then(r => r.json()).catch(() => [])
  ])

  const pickCaptain = (team, players) => {
    const list = Array.isArray(players) ? players : []
    const capById = list.find((p) => String(p.id) === String(team?.captain_id))
    if (capById) return capById

    const captainName = String(team?.captain_name || '').trim().toLowerCase()
    if (captainName) {
      const capByName = list.find((p) => String(p?.name || '').trim().toLowerCase() === captainName)
      if (capByName) return capByName
    }

    return list.find((p) => !!p?.is_captain) || list[0] || null
  }

  const captainA = pickCaptain(teamA, teamAPlayers)
  const captainB = pickCaptain(teamB, teamBPlayers)

  const [aPortrait, bPortrait, aLogo, bLogo, leagueLogo] = await Promise.all([
    loadPlayerPortrait(captainA?.photo || teamA.captain_photo, { removeBackground: removeBgForPlayers }),
    loadPlayerPortrait(captainB?.photo || teamB.captain_photo, { removeBackground: removeBgForPlayers }),
    loadImage(teamA.logo),
    loadImage(teamB.logo),
    loadImage(leagueObj?.logo || match.league_logo),
  ])

  const aCapImg = aPortrait?.img || null
  const bCapImg = bPortrait?.img || null
  const aIsCutout = !!aPortrait?.backgroundRemoved
  const bIsCutout = !!bPortrait?.backgroundRemoved

  const W = 1920
  const H = 1080
  const { canvas, ctx } = createCanvas(W, H)

  const leftBrand = isIccTheme
    ? { primary: '#3f8cf8', secondary: '#9fd0ff' }
    : teamPalette(teamA, '#1d4ed8', '#93c5fd')
  const rightBrand = isIccTheme
    ? { primary: '#eab308', secondary: '#fde68a' }
    : teamPalette(teamB, '#c026d3', '#f5d0fe')
  const accentBrand = isIccTheme ? '#f7c948' : '#ffffff'

  const roundRect = (x, y, w, h, r) => {
    const rr = Math.min(r, w * 0.5, h * 0.5)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + w - rr, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
    ctx.lineTo(x + w, y + h - rr)
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
    ctx.lineTo(x + rr, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
    ctx.lineTo(x, y + rr)
    ctx.quadraticCurveTo(x, y, x + rr, y)
    ctx.closePath()
  }

  const leagueNameText = String(leagueObj?.name || match.league_name || 'CRICKET LEAGUE').toUpperCase()
  const seasonText = String(leagueObj?.season || match.season || '').trim()
  const displaySeason = seasonText ? `SEASON ${seasonText}` : 'SEASON'

  /* ── Background + mood ── */
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#021024')
  bg.addColorStop(0.45, '#051a35')
  bg.addColorStop(1, '#020a18')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const leftGlow = ctx.createRadialGradient(W * 0.22, H * 0.38, 0, W * 0.22, H * 0.38, H * 0.6)
  leftGlow.addColorStop(0, `${hexToRgba(leftBrand.primary, 0.36)}`)
  leftGlow.addColorStop(1, 'rgba(64,196,255,0)')
  ctx.fillStyle = leftGlow
  ctx.fillRect(0, 0, W, H)

  const rightGlow = ctx.createRadialGradient(W * 0.78, H * 0.38, 0, W * 0.78, H * 0.38, H * 0.6)
  rightGlow.addColorStop(0, `${hexToRgba(rightBrand.primary, 0.34)}`)
  rightGlow.addColorStop(1, 'rgba(233,30,140,0)')
  ctx.fillStyle = rightGlow
  ctx.fillRect(0, 0, W, H)

  const centerBeam = ctx.createLinearGradient(W * 0.5, H * 0.10, W * 0.5, H * 0.92)
  centerBeam.addColorStop(0, 'rgba(145,186,255,0.00)')
  centerBeam.addColorStop(0.52, 'rgba(145,186,255,0.16)')
  centerBeam.addColorStop(1, 'rgba(145,186,255,0.00)')
  ctx.fillStyle = centerBeam
  ctx.fillRect(W * 0.43, H * 0.05, W * 0.14, H * 0.9)

  const centerFlare = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, H * 0.52)
  centerFlare.addColorStop(0, 'rgba(255,255,255,0.12)')
  centerFlare.addColorStop(0.45, 'rgba(143,177,255,0.06)')
  centerFlare.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = centerFlare
  ctx.fillRect(0, 0, W, H)

  // Stadium-style dot texture.
  ctx.save()
  ctx.globalAlpha = 0.09
  ctx.fillStyle = '#9fc2ff'
  for (let x = 0; x < W; x += 16) {
    for (let y = 70; y < H * 0.78; y += 16) {
      const shift = (Math.floor(y / 16) % 2) * 8
      ctx.fillRect(x + shift, y, 2, 2)
    }
  }
  ctx.restore()

  const pitch = ctx.createLinearGradient(0, H * 0.65, 0, H)
  pitch.addColorStop(0, 'rgba(19,72,31,0)')
  pitch.addColorStop(1, 'rgba(30,96,45,0.48)')
  ctx.fillStyle = pitch
  ctx.fillRect(0, 0, W, H)

  /* ── Header strip + season ── */
  ctx.fillStyle = 'rgba(0, 0, 0, 0.46)'
  ctx.fillRect(0, 18, W, 118)
  ctx.fillStyle = '#f5f8ff'
  const leagueTitleSize = fitText(ctx, leagueNameText, W * 0.84, 102, 52)
  ctx.font = `900 italic ${leagueTitleSize}px "Barlow Condensed", sans-serif`
  ctx.textAlign = 'center'
  ctx.strokeStyle = '#1d2d72'
  ctx.lineWidth = 7
  ctx.strokeText(leagueNameText, W * 0.5, 98)
  ctx.fillText(leagueNameText, W * 0.5, 98)

  roundRect(W * 0.43, 103, W * 0.14, 46, 14)
  ctx.fillStyle = 'rgba(5,20,42,0.9)'
  ctx.fill()
  ctx.strokeStyle = isIccTheme ? '#f7c948' : rightBrand.secondary
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = isIccTheme ? '#5df26e' : leftBrand.secondary
  ctx.font = '800 32px "Barlow Condensed", sans-serif'
  ctx.fillText(displaySeason, W * 0.5, 136)

  ctx.fillStyle = 'rgba(255,255,255,0.66)'
  ctx.fillRect(W * 0.18, 117, W * 0.20, 3)
  ctx.fillRect(W * 0.62, 117, W * 0.20, 3)

  /* ── Central logo + match tag ── */
  const logoSize = 190
  const logoX = W * 0.5 - logoSize * 0.5
  const logoY = 150
  const logoGlow = ctx.createRadialGradient(W * 0.5, logoY + logoSize * 0.45, 0, W * 0.5, logoY + logoSize * 0.45, logoSize * 0.85)
  logoGlow.addColorStop(0, 'rgba(115,172,255,0.35)')
  logoGlow.addColorStop(1, 'rgba(115,172,255,0)')
  ctx.fillStyle = logoGlow
  ctx.fillRect(0, 0, W, H)

  if (leagueLogo) {
    drawCover(ctx, leagueLogo, logoX, logoY, logoSize, logoSize)
  } else {
    roundRect(logoX, logoY, logoSize, logoSize, 24)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fill()
  }

  roundRect(W * 0.40, 354, W * 0.20, 82, 16)
  const matchTagGrad = ctx.createLinearGradient(W * 0.40, 354, W * 0.60, 436)
  matchTagGrad.addColorStop(0, 'rgba(8,26,74,0.98)')
  matchTagGrad.addColorStop(1, 'rgba(26,54,130,0.98)')
  ctx.fillStyle = matchTagGrad
  ctx.fill()
  ctx.strokeStyle = '#f5fbff'
  ctx.lineWidth = 2.5
  ctx.stroke()
  const matchLabel = `MATCH ${match.match_number || ''}`.trim()
  ctx.save()
  ctx.font = '900 74px "Barlow Condensed", sans-serif'
  ctx.textAlign = 'center'
  ctx.strokeStyle = 'rgba(6,14,38,0.95)'
  ctx.lineWidth = 7
  ctx.strokeText(matchLabel, W * 0.5, 414)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(matchLabel, W * 0.5, 414)
  ctx.restore()

  /* ── Players (full image fit, centered VS lane) ── */
  const panelW = W * 0.5
  const panelY = 150
  const panelH = H - panelY
  const getCaptainFrame = (side) => {
    const panelX = side === 'left' ? 0 : W * 0.5
    return {
      x: panelX + panelW * 0.08,
      y: panelY + panelH * 0.02,
      w: panelW * 0.84,
      h: panelH * 0.90,
      r: 26,
      panelX,
    }
  }

  const drawCaptainCutout = (img, side, isCutout = false) => {
    if (!img) return

    const frame = getCaptainFrame(side)
    const fitW = frame.w * 0.92
    const fitH = frame.h * 0.95
    const baseScale = Math.min(fitW / img.width, fitH / img.height)
    const tunedScale = Math.max(baseScale * 1.02, 0.08)
    const dw = img.width * tunedScale
    const dh = img.height * tunedScale
    const dx = frame.x + (frame.w - dw) * 0.5
    const dy = playerVerticalAlign === 'bottom'
      ? (frame.y + frame.h - dh - 2)
      : (frame.y + (frame.h - dh) * 0.5)

    ctx.save()
    roundRect(frame.x, frame.y, frame.w, frame.h, frame.r)
    ctx.clip()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.filter = isCutout
      ? 'contrast(1.08) saturate(1.10) brightness(1.14)'
      : 'contrast(1.14) saturate(1.18) brightness(1.22)'
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.filter = 'none'

    // Soft floor blend for a cleaner grounded look.
    const floorFade = ctx.createLinearGradient(0, frame.y + frame.h * 0.72, 0, frame.y + frame.h)
    floorFade.addColorStop(0, 'rgba(2,10,24,0)')
    floorFade.addColorStop(1, 'rgba(2,10,24,0.38)')
    ctx.fillStyle = floorFade
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h)
    ctx.restore()

    ctx.save()
    const shoulderGlow = ctx.createRadialGradient(
      side === 'left' ? frame.x + frame.w * 0.70 : frame.x + frame.w * 0.30,
      frame.y + frame.h * 0.52,
      frame.h * 0.04,
      side === 'left' ? frame.x + frame.w * 0.70 : frame.x + frame.w * 0.30,
      frame.y + frame.h * 0.52,
      frame.h * 0.46,
    )
    shoulderGlow.addColorStop(0, side === 'left' ? hexToRgba(leftBrand.secondary, 0.22) : hexToRgba(rightBrand.secondary, 0.22))
    shoulderGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shoulderGlow
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h)

    // Keep a clean center corridor so VS text never touches portraits.
    const centerMask = side === 'left'
      ? ctx.createLinearGradient(frame.x + frame.w * 0.80, 0, frame.x + frame.w, 0)
      : ctx.createLinearGradient(frame.x, 0, frame.x + frame.w * 0.20, 0)
    centerMask.addColorStop(0, 'rgba(2,10,24,0)')
    centerMask.addColorStop(1, 'rgba(2,10,24,0.52)')
    ctx.fillStyle = centerMask
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h)
    ctx.restore()
  }

  const drawCaptainBorder = (side, primary, secondary) => {
    const frame = getCaptainFrame(side)
    const frameX = frame.x
    const frameY = frame.y
    const frameW = frame.w
    const frameH = frame.h

    // Outer neon aura.
    ctx.save()
    roundRect(frameX, frameY, frameW, frameH, frame.r)
    ctx.strokeStyle = hexToRgba(secondary, 0.30)
    ctx.lineWidth = 12
    ctx.shadowColor = hexToRgba(secondary, 0.95)
    ctx.shadowBlur = 42
    ctx.stroke()
    ctx.restore()

    const edgeGrad = ctx.createLinearGradient(frameX, frameY, frameX, frameY + frameH)
    edgeGrad.addColorStop(0, hexToRgba(secondary, 0.94))
    edgeGrad.addColorStop(1, hexToRgba(primary, 0.80))

    ctx.save()
    roundRect(frameX, frameY, frameW, frameH, frame.r)
    ctx.strokeStyle = edgeGrad
    ctx.lineWidth = 4.5
    ctx.shadowColor = hexToRgba(secondary, 0.95)
    ctx.shadowBlur = 26
    ctx.stroke()
    ctx.restore()

    // Inner hairline for crisp edge definition.
    ctx.save()
    roundRect(frameX + 2, frameY + 2, frameW - 4, frameH - 4, Math.max(8, frame.r - 2))
    ctx.strokeStyle = hexToRgba('#ffffff', 0.32)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    const sideEdgeX = side === 'left' ? frameX : frameX + frameW - 5
    const sideEdge = ctx.createLinearGradient(sideEdgeX, frameY, sideEdgeX, frameY + frameH)
    sideEdge.addColorStop(0, hexToRgba(secondary, 0.24))
    sideEdge.addColorStop(0.5, hexToRgba(secondary, 0.82))
    sideEdge.addColorStop(1, hexToRgba(primary, 0.24))
    ctx.save()
    ctx.fillStyle = sideEdge
    ctx.shadowColor = hexToRgba(secondary, 0.9)
    ctx.shadowBlur = 30
    ctx.fillRect(sideEdgeX, frameY + 10, 5, frameH - 20)
    ctx.restore()
  }

  drawCaptainCutout(aCapImg, 'left', aIsCutout)
  drawCaptainCutout(bCapImg, 'right', bIsCutout)
  drawCaptainBorder('left', leftBrand.primary, leftBrand.secondary)
  drawCaptainBorder('right', rightBrand.primary, rightBrand.secondary)

  if (aLogo) {
    ctx.save()
    ctx.globalAlpha = 0.2
    drawCover(ctx, aLogo, 70, 250, 240, 240)
    ctx.restore()
  }
  if (bLogo) {
    ctx.save()
    ctx.globalAlpha = 0.2
    drawCover(ctx, bLogo, W - 310, 250, 240, 240)
    ctx.restore()
  }

  /* ── VS center badge ── */
  const vsGrad = ctx.createLinearGradient(W * 0.43, H * 0.53, W * 0.57, H * 0.70)
  vsGrad.addColorStop(0, isIccTheme ? '#fff36c' : leftBrand.secondary)
  vsGrad.addColorStop(0.35, isIccTheme ? '#ff9800' : leftBrand.primary)
  vsGrad.addColorStop(0.7, isIccTheme ? '#ff2e2e' : rightBrand.primary)
  vsGrad.addColorStop(1, isIccTheme ? '#9e0d0d' : rightBrand.secondary)

  ctx.textAlign = 'center'
  ctx.font = '900 232px "Barlow Condensed", sans-serif'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = isIccTheme ? '#662400' : '#0f172a'
  ctx.lineWidth = 16
  ctx.strokeText('VS', W * 0.5, 720)
  ctx.save()
  ctx.shadowColor = 'rgba(129,186,255,0.82)'
  ctx.shadowBlur = 46
  ctx.shadowOffsetY = 0
  ctx.fillStyle = vsGrad
  ctx.fillText('VS', W * 0.5, 720)
  ctx.restore()
  ctx.strokeStyle = accentBrand
  ctx.lineWidth = 3
  ctx.strokeText('VS', W * 0.5, 720)

  /* ── Team name plates ── */
  const teamNameA = String(match.team_a_name || teamA.name || 'TEAM A')
  const teamNameB = String(match.team_b_name || teamB.name || 'TEAM B')

  const drawNamePlate = (name, x, y, fg, stroke) => {
    const cap = String(name || '').trim().replace(/\s+/g, ' ').toUpperCase()
    const plateW = W * 0.32
    const plateH = 104
    const plateX = x - (plateW / 2)
    const plateY = y - 70
    const textMaxW = plateW - 34

    let label = cap
    const size = fitText(ctx, label, textMaxW, 94, 28)
    ctx.font = `900 italic ${size}px "Barlow Condensed", sans-serif`
    while (label.length > 4 && ctx.measureText(label).width > textMaxW) {
      label = label.slice(0, -1).trim()
    }
    if (label !== cap) {
      label = `${label.slice(0, Math.max(3, label.length - 1)).trim()}...`
    }

    roundRect(plateX, plateY, plateW, plateH, 18)
    const plateGrad = ctx.createLinearGradient(x, y - 70, x, y + 34)
    plateGrad.addColorStop(0, 'rgba(10, 16, 40, 0.34)')
    plateGrad.addColorStop(1, 'rgba(10, 16, 40, 0.72)')
    ctx.fillStyle = plateGrad
    ctx.fill()
    ctx.strokeStyle = hexToRgba(fg, 0.68)
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.save()
    roundRect(plateX + 2, plateY + 2, plateW - 4, plateH - 4, 16)
    ctx.clip()
    ctx.font = `900 italic ${size}px "Barlow Condensed", sans-serif`
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(4, Math.floor(size * 0.12))
    ctx.strokeText(label, x, y)
    ctx.fillStyle = fg
    ctx.fillText(label, x, y)
    ctx.restore()

    const cleanLine = ctx.createLinearGradient(plateX, y + 36, plateX + plateW, y + 36)
    cleanLine.addColorStop(0, 'rgba(255,255,255,0.08)')
    cleanLine.addColorStop(0.5, hexToRgba(fg, 0.78))
    cleanLine.addColorStop(1, 'rgba(255,255,255,0.08)')
    ctx.fillStyle = cleanLine
    ctx.fillRect(plateX + 8, y + 32, plateW - 16, 3)

    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(plateX, y - 72, plateW, 3)
  }

  drawNamePlate(teamNameA, W * 0.245, 878, leftBrand.secondary, leftBrand.primary)
  drawNamePlate(teamNameB, W * 0.755, 878, rightBrand.secondary, rightBrand.primary)

  /* ── Footer metadata strip ── */
  roundRect(44, H - 104, W - 88, 72, 16)
  ctx.fillStyle = 'rgba(12, 20, 42, 0.76)'
  ctx.fill()
  ctx.strokeStyle = hexToRgba(accentBrand, 0.36)
  ctx.lineWidth = 1.5
  ctx.stroke()

  const bannerDate = match.date || match.match_date || 'DATE TBA'
  const rawTime = match.time || match.match_time || ''
  let bannerTime = 'TIME TBA'
  if (rawTime) {
    try {
      const [hStr, mStr] = rawTime.split(':')
      let hours = parseInt(hStr, 10)
      const mins = String(mStr || '00').replace(/[^0-9]/g, '').padStart(2, '0')
      const ampm = hours >= 12 ? 'PM' : 'AM'
      hours = hours % 12 || 12
      bannerTime = `${hours}:${mins} ${ampm}`
    } catch {
      bannerTime = rawTime
    }
  }

  const footerText = [bannerDate, bannerTime, match.venue || 'VENUE TBA'].join('  ·  ')
  ctx.fillStyle = '#f4f8ff'
  ctx.font = `800 ${isIccTheme ? 56 : 60}px "Barlow Condensed", sans-serif`
  ctx.fillText(footerText.toUpperCase(), W * 0.5, H - 52)

  return { canvas, id: match.id, name: isIccTheme ? 'vs_banner_icc' : 'vs_banner' }
}

async function _generateInningsBanner(match, scorecard, type) {
  const first  = scorecard.find(s => s.innings_number === 1) || scorecard.find(s => s.batting_team_id === match.team_a_id)
  const second = scorecard.find(s => s.innings_number === 2) || scorecard.find(s => s.batting_team_id === match.team_b_id)
  const inn    = type === 'first' ? first : second
  const oppInn = type === 'first' ? second : first

  // Pre-load team logos
  const [aLogo, bLogo, leagueLogo] = await Promise.all([
    loadImage(match.team_a_logo || null),
    loadImage(match.team_b_logo || null),
    loadImage(match.league_logo || null),
  ])
  const battingLogo = type === 'first' ? aLogo : bLogo
  const bowlingLogo = type === 'first' ? bLogo : aLogo

  /* ── Dynamic height ── */
  const W = 1920
  const batting  = inn?.batting  || []
  const bowling  = inn?.bowling  || []
  const extras   = inn?.extras   ?? 0
  const fow      = inn?.fall_of_wickets || []

  const HDR_H     = 180   // top header bar
  const MATCH_H   = 56    // match info strip
  const BAT_HDR   = 52    // batting table header
  const BAT_ROW   = 52    // each batting row
  const EXTRAS_H  = 44
  const TOTAL_H   = 56
  const BOWL_HDR  = 52
  const BOWL_ROW  = 46
  const DIVIDER   = 14    // gap between sections
  const FOOTER_H  = 72

  const totalRows   = batting.length || 11
  const totalBowls  = bowling.length || 0

  const BODY_H = BAT_HDR + totalRows * BAT_ROW + EXTRAS_H + TOTAL_H
              + DIVIDER + BOWL_HDR + totalBowls * BOWL_ROW
  const H = Math.max(1080, HDR_H + MATCH_H + BODY_H + FOOTER_H + 20)

  const { canvas, ctx } = createCanvas(W, H)

  /* ── PALETTE ── */
  const BG_DARK   = '#010d1e'
  const BG_MID    = '#041628'
  const NAVY      = '#0a1835'
  const GOLD      = '#f0b429'
  const GOLD_L    = '#ffe066'
  const WHITE     = '#ffffff'
  const TEXT_SEC  = '#a8c4e8'
  const TEXT_DIM  = '#5a7898'
  const ROW_EVEN  = 'rgba(255,255,255,0.04)'
  const ROW_ODD   = 'rgba(255,255,255,0.09)'
  const HDR_COL   = 'rgba(10,24,56,0.92)'
  const BORDER    = 'rgba(255,255,255,0.10)'
  const GOLD_DIM  = 'rgba(240,180,41,0.18)'
  const GREEN     = '#22c55e'
  const RED       = '#ef4444'
  const MAGENTA   = '#e91e8c'
  const F         = '"Barlow Condensed", "Oswald", sans-serif'
  const FB        = '"Barlow", sans-serif'

  /* ── HELPERS ── */
  const t = (text, x, y, sz, color, align, wt, font) => {
    ctx.save(); ctx.font = `${wt||'600'} ${sz}px ${font||F}`
    ctx.fillStyle = color; ctx.textAlign = align || 'left'
    ctx.fillText(String(text ?? ''), x, y); ctx.restore()
  }
  const r = (x, y, w, h, color) => { if (w>0&&h>0){ctx.fillStyle=color;ctx.fillRect(x,y,w,h)} }
  const hl = (x, y, w, color, th) => r(x, y, w, th||1, color)

  /* ── 1. BACKGROUND ── */
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, BG_DARK); bg.addColorStop(0.5, BG_MID); bg.addColorStop(1, BG_DARK)
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  // Hex grid
  ctx.save(); ctx.globalAlpha=0.03; ctx.strokeStyle='#4070c0'; ctx.lineWidth=1
  const hR=55
  for(let row=-1;row<H/(hR*1.5)+2;row++){for(let col=-1;col<W/(hR*1.73)+2;col++){
    const hx=col*hR*1.73+(row%2)*hR*0.865,hy=row*hR*1.5
    ctx.beginPath()
    for(let s=0;s<6;s++){const a=(Math.PI/3)*s-Math.PI/6;s===0?ctx.moveTo(hx+hR*Math.cos(a),hy+hR*Math.sin(a)):ctx.lineTo(hx+hR*Math.cos(a),hy+hR*Math.sin(a))}
    ctx.closePath();ctx.stroke()
  }}
  ctx.globalAlpha=1;ctx.restore()

  goldBar(ctx, 0, 0, W, 10)

  /* ── 2. HEADER ── */
  // Dark glass header
  r(0, 10, W, HDR_H, 'rgba(0,5,15,0.80)')
  hl(0, HDR_H + 10, W, GOLD, 4)

  // Batting team logo left
  if (battingLogo) {
    ctx.save(); ctx.beginPath(); ctx.arc(90, 10 + HDR_H/2, 60, 0, Math.PI*2)
    ctx.fillStyle='rgba(0,10,30,0.7)'; ctx.fill(); ctx.clip()
    const bls = Math.min(120/battingLogo.width, 120/battingLogo.height)
    ctx.drawImage(battingLogo, 90-battingLogo.width*bls/2, (10+HDR_H/2)-battingLogo.height*bls/2, battingLogo.width*bls, battingLogo.height*bls)
    ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.arc(90, 10+HDR_H/2, 62, 0, Math.PI*2)
    ctx.strokeStyle=GOLD; ctx.lineWidth=2.5; ctx.stroke(); ctx.restore()
  }

  // Innings label + team name
  const inningsLabel = type === 'first' ? '1ST INNINGS' : '2ND INNINGS'
  t(inningsLabel, 174, 10+52, 28, GOLD, 'left', '700')
  const teamNameFull = (inn?.team_name || (type==='first'?match.team_a_name:match.team_b_name) || 'TEAM').toUpperCase()
  const tnSz = fitText(ctx, teamNameFull, 900, 96, 28)
  ctx.save(); ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=16
  t(teamNameFull, 174, 10+120, tnSz, WHITE, 'left', '900')
  ctx.shadowBlur=0; ctx.restore()
  goldBar(ctx, 174, 10+130, Math.min(600, teamNameFull.length * tnSz * 0.52), 4)

  // BIG SCORE (right side of header)
  const totalRuns = inn?.total_runs ?? 0
  const totalWkts = inn?.total_wickets ?? 0
  const totalBalls= inn?.total_balls ?? 0
  const ovFull    = `${Math.floor(totalBalls/6)}.${totalBalls%6}`
  const runRate   = totalBalls > 0 ? ((totalRuns/totalBalls)*6).toFixed(2) : '0.00'

  const scoreTxt  = `${totalRuns}/${totalWkts}`
  const scoreSz   = fitText(ctx, scoreTxt, 560, 140, 60)
  ctx.save(); ctx.textAlign='right'
  ctx.shadowColor='rgba(240,180,41,0.5)'; ctx.shadowBlur=30
  t(scoreTxt, W-60, 10+130, scoreSz, GOLD, 'right', '900')
  ctx.shadowBlur=0; ctx.restore()
  t(`${ovFull} OVERS  ·  RR: ${runRate}`, W-62, 10+162, 26, TEXT_SEC, 'right', '600')

  // League logo top right
  if (leagueLogo) {
    const lgs = Math.min(60/leagueLogo.width, 60/leagueLogo.height)
    ctx.drawImage(leagueLogo, W-140, 18, leagueLogo.width*lgs, leagueLogo.height*lgs)
  }

  /* ── 3. MATCH INFO STRIP ── */
  const MIY = HDR_H + 14
  r(0, MIY, W, MATCH_H, HDR_COL)
  hl(0, MIY, W, GOLD_DIM, 2)
  const matchInfo = [
    match.match_number ? `MATCH #${match.match_number}` : null,
    match.venue || null,
    (match.date || match.match_date) || null,
    match.league_name || null,
    match.format || null,
  ].filter(Boolean).join('   ·   ')
  t(matchInfo, W/2, MIY + MATCH_H*0.66, 24, TEXT_SEC, 'center', '600')
  hl(0, MIY + MATCH_H - 1, W, BORDER)

  /* ── 4. BATTING TABLE ── */
  let Y = MIY + MATCH_H + 2

  // Column positions
  const COL_NAME  = 60
  const COL_DISM  = W * 0.38
  const COL_R     = W * 0.68
  const COL_B     = W * 0.74
  const COL_4S    = W * 0.80
  const COL_6S    = W * 0.86
  const COL_SR    = W * 0.95

  // Batting header
  r(0, Y, W, BAT_HDR, 'rgba(5,20,55,0.95)')
  hl(0, Y, W, GOLD, 3)
  t('BATTING', COL_NAME, Y+BAT_HDR*0.68, 22, GOLD, 'left', '800')
  t('DISMISSAL', COL_DISM, Y+BAT_HDR*0.68, 18, TEXT_DIM, 'left', '600')
  t('R',  COL_R,  Y+BAT_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('B',  COL_B,  Y+BAT_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('4s', COL_4S, Y+BAT_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('6s', COL_6S, Y+BAT_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('SR', COL_SR, Y+BAT_HDR*0.68, 20, TEXT_SEC, 'right',  '700')
  hl(0, Y+BAT_HDR-1, W, BORDER)
  Y += BAT_HDR

  batting.forEach((p, i) => {
    const rowBg = i%2===0 ? ROW_EVEN : ROW_ODD
    r(0, Y, W, BAT_ROW, rowBg)
    hl(0, Y+BAT_ROW-1, W, BORDER)
    const cy = Y + BAT_ROW*0.65

    // Batting order dot
    ctx.save(); ctx.beginPath(); ctx.arc(32, Y+BAT_ROW/2, 12, 0, Math.PI*2)
    ctx.fillStyle=GOLD_DIM; ctx.fill()
    t(String(p.batting_order||i+1), 32, Y+BAT_ROW/2+6, 16, GOLD, 'center', '700')
    ctx.restore()

    // Name (bold, highlight if top scorer)
    const topRuns = Math.max(...batting.map(x=>x.runs||0))
    const isTop = (p.runs||0) === topRuns && topRuns > 0
    const nameColor = isTop ? GOLD_L : WHITE
    const nameWeight = isTop ? '900' : '700'
    t((p.name||'—').toUpperCase(), COL_NAME, cy, 26, nameColor, 'left', nameWeight, FB)
    if (p.is_captain) t(' (c)', COL_NAME + ctx.measureText((p.name||'').toUpperCase()).width + 4, cy, 18, TEXT_DIM, 'left', '600')

    // Dismissal
    const dismText = p.how_out || (p.not_out ? 'not out' : '') || '—'
    const dSz = fitText(ctx, dismText, COL_R - COL_DISM - 20, 22, 12)
    t(dismText, COL_DISM, cy, dSz, p.not_out ? GREEN : TEXT_SEC, 'left', '500')

    // Stats
    const sr = p.balls_faced > 0 ? ((p.runs/p.balls_faced)*100).toFixed(1) : '-'
    const runsColor = p.runs >= 50 ? (p.runs >= 100 ? '#fbbf24' : GREEN) : WHITE
    t(String(p.runs??0), COL_R, cy, 28, runsColor, 'center', '900', FB)
    t(String(p.balls_faced??'-'), COL_B, cy, 22, TEXT_SEC, 'center', '600', FB)
    t(String(p.fours??'-'),       COL_4S, cy, 22, TEXT_SEC, 'center', '600', FB)
    t(String(p.sixes??'-'),       COL_6S, cy, 22, p.sixes>0 ? GREEN : TEXT_SEC, 'center', '600', FB)
    t(sr,                         COL_SR, cy, 22, TEXT_SEC, 'right',  '600', FB)

    // Highlight bar for 50+ scores
    if (p.runs >= 50) {
      r(0, Y, 4, BAT_ROW, p.runs>=100 ? '#fbbf24' : GREEN)
    }
    Y += BAT_ROW
  })

  // Extras row
  r(0, Y, W, EXTRAS_H, 'rgba(5,15,40,0.80)')
  hl(0, Y, W, BORDER)
  t('EXTRAS', COL_NAME, Y+EXTRAS_H*0.68, 20, TEXT_DIM, 'left', '700')
  const extrasDetail = [
    inn?.extra_byes      ? `B ${inn.extra_byes}`      : null,
    inn?.extra_leg_byes  ? `LB ${inn.extra_leg_byes}` : null,
    inn?.extra_wides     ? `W ${inn.extra_wides}`      : null,
    inn?.extra_no_balls  ? `NB ${inn.extra_no_balls}`  : null,
  ].filter(Boolean).join('  ')
  t(extrasDetail || '—', COL_DISM, Y+EXTRAS_H*0.68, 18, TEXT_SEC, 'left', '500')
  t(String(extras), COL_R, Y+EXTRAS_H*0.68, 24, WHITE, 'center', '700', FB)
  hl(0, Y+EXTRAS_H-1, W, BORDER)
  Y += EXTRAS_H

  // Total row
  r(0, Y, W, TOTAL_H, 'rgba(240,180,41,0.14)')
  hl(0, Y, W, GOLD, 3)
  t(`TOTAL  (${ovFull} OVERS)`, COL_NAME, Y+TOTAL_H*0.66, 26, WHITE, 'left', '900')
  t(scoreTxt, COL_R, Y+TOTAL_H*0.66, 30, GOLD, 'center', '900', FB)
  t(`RR: ${runRate}`, COL_SR, Y+TOTAL_H*0.66, 22, TEXT_SEC, 'right', '700')
  hl(0, Y+TOTAL_H-1, W, GOLD, 3)
  Y += TOTAL_H + DIVIDER

  /* ── 5. BOWLING TABLE ── */
  const BCOL_NAME = 60
  const BCOL_O    = W * 0.44
  const BCOL_M    = W * 0.52
  const BCOL_R2   = W * 0.60
  const BCOL_W    = W * 0.68
  const BCOL_NB   = W * 0.76
  const BCOL_WD   = W * 0.84
  const BCOL_ECO  = W * 0.95

  r(0, Y, W, BOWL_HDR, 'rgba(5,20,55,0.95)')
  hl(0, Y, W, MAGENTA, 3)
  t('BOWLING', BCOL_NAME, Y+BOWL_HDR*0.68, 22, MAGENTA, 'left', '800')
  t('O',   BCOL_O,   Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('M',   BCOL_M,   Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('R',   BCOL_R2,  Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('W',   BCOL_W,   Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('NB',  BCOL_NB,  Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('WD',  BCOL_WD,  Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'center', '700')
  t('ECO', BCOL_ECO, Y+BOWL_HDR*0.68, 20, TEXT_SEC, 'right',  '700')
  hl(0, Y+BOWL_HDR-1, W, BORDER)
  Y += BOWL_HDR

  bowling.forEach((p, i) => {
    const rowBg = i%2===0 ? ROW_EVEN : ROW_ODD
    r(0, Y, W, BOWL_ROW, rowBg)
    hl(0, Y+BOWL_ROW-1, W, BORDER)
    const cy = Y + BOWL_ROW*0.65

    // Ball icon dot
    ctx.save(); ctx.beginPath(); ctx.arc(32, Y+BOWL_ROW/2, 11, 0, Math.PI*2)
    ctx.fillStyle='rgba(233,30,140,0.15)'; ctx.fill()
    ctx.strokeStyle=MAGENTA; ctx.lineWidth=1.5; ctx.stroke()
    ctx.restore()

    const topWkts = Math.max(...bowling.map(x=>x.wickets||0))
    const isBestBowler = (p.wickets||0) === topWkts && topWkts > 0
    t((p.name||'—').toUpperCase(), BCOL_NAME, cy, 26, isBestBowler ? GOLD_L : WHITE, 'left', isBestBowler?'900':'700', FB)

    const balls  = p.balls_bowled ?? (typeof p.overs==='number' ? Math.round(p.overs)*6 : 0)
    const ovStr  = balls > 0 ? `${Math.floor(balls/6)}.${balls%6}` : String(p.overs||'0')
    const eco    = balls > 0 ? ((p.runs_conceded/balls)*6).toFixed(2) : '-'
    const wkts   = p.wickets ?? 0
    const wktColor = wkts >= 3 ? RED : wkts >= 1 ? GOLD : TEXT_DIM

    t(ovStr,                             BCOL_O,   cy, 24, TEXT_SEC, 'center', '600', FB)
    t(String(p.maidens??p.maiden_overs??0), BCOL_M, cy, 24, TEXT_SEC, 'center', '600', FB)
    t(String(p.runs_conceded??'-'),      BCOL_R2,  cy, 24, TEXT_SEC, 'center', '600', FB)
    t(String(wkts),                      BCOL_W,   cy, 28, wktColor, 'center', '900', FB)
    t(String(p.no_balls??0),             BCOL_NB,  cy, 22, TEXT_DIM, 'center', '600', FB)
    t(String(p.wides??0),                BCOL_WD,  cy, 22, TEXT_DIM, 'center', '600', FB)
    t(eco,                               BCOL_ECO, cy, 24, TEXT_SEC, 'right',  '600', FB)

    if (wkts >= 3) r(0, Y, 4, BOWL_ROW, RED)
    Y += BOWL_ROW
  })

  /* ── 6. FOR 2ND INNINGS: CHASE PANEL ── */
  if (type === 'second' && first) {
    const target    = (first.total_runs||0) + 1
    const maxBalls  = (match.overs_per_innings||20) * 6
    const ballsLeft = Math.max(0, maxBalls - totalBalls)
    const runsNeed  = Math.max(0, target - totalRuns)
    const rrr       = ballsLeft > 0 ? ((runsNeed/ballsLeft)*6).toFixed(2) : '0.00'

    Y += DIVIDER
    const CHASE_H = 88
    r(0, Y, W, CHASE_H, 'rgba(0,180,130,0.12)')
    hl(0, Y, W, '#00c87a', 4)

    // Chase summary in one bold row
    ctx.save(); ctx.textAlign='center'
    t(`TARGET  ${target}`, W*0.18, Y+CHASE_H*0.55, 44, WHITE, 'center', '900')
    t(`${runsNeed} NEEDED`, W*0.40, Y+CHASE_H*0.55, 44, runsNeed<50?GREEN:GOLD, 'center', '900')
    t(`${Math.floor(ballsLeft/6)}.${ballsLeft%6} OVERS LEFT`, W*0.62, Y+CHASE_H*0.55, 36, TEXT_SEC, 'center', '700')
    t(`RRR: ${rrr}`, W*0.82, Y+CHASE_H*0.55, 36, parseFloat(rrr)>10 ? RED : GOLD, 'center', '700')
    ctx.restore()

    t(`CRR: ${runRate}`, 60, Y+CHASE_H*0.88, 22, TEXT_SEC, 'left', '600')
    hl(0, Y+CHASE_H-1, W, BORDER)
    Y += CHASE_H
  }

  /* ── 7. FOOTER ── */
  goldBar(ctx, 0, H - FOOTER_H, W, 4)
  r(0, H - FOOTER_H, W, FOOTER_H, 'rgba(0,0,0,0.70)')
  // Opponent score (context for first innings)
  const oppTeam = type === 'first' ? match.team_b_name : match.team_a_name
  if (oppInn) {
    const oppSc = `${oppInn.total_runs||0}/${oppInn.total_wickets||0} (${Math.floor((oppInn.total_balls||0)/6)}.${(oppInn.total_balls||0)%6} ov)`
    t(`${(oppTeam||'').toUpperCase()}: ${oppSc}`, 60, H - FOOTER_H + FOOTER_H*0.64, 26, TEXT_SEC, 'left', '700')
  }
  // Match info centre
  const footerMatchInfo = [match.venue, match.date||match.match_date].filter(Boolean).join('  ·  ')
  t(footerMatchInfo, W/2, H - FOOTER_H + FOOTER_H*0.64, 26, TEXT_DIM, 'center', '600')
  // Bowling team right
  if (bowlingLogo) {
    ctx.save(); ctx.globalAlpha=0.80
    const bls2 = Math.min(48/bowlingLogo.width, 48/bowlingLogo.height)
    ctx.drawImage(bowlingLogo, W-120, H-FOOTER_H+12, bowlingLogo.width*bls2, bowlingLogo.height*bls2)
    ctx.restore()
  }
  goldBar(ctx, 0, H - 8, W, 8)

  return { canvas, id: match.id, name: `innings_${type === 'second' ? 'second' : 'first'}` }
}

async function _generateResultBanner(match, scorecard, options = {}) {
  const aInn  = scorecard.find(s => s.batting_team_id === match.team_a_id)
  const bInn  = scorecard.find(s => s.batting_team_id === match.team_b_id)
  // Show top 4 batters and top 5 bowlers — matching reference density
  const aBat  = (aInn?.batting  || []).slice(0, 4)
  const bBat  = (bInn?.batting  || []).slice(0, 4)
  const aBowl = (bInn?.bowling  || []).slice(0, 5)
  const bBowl = (aInn?.bowling  || []).slice(0, 5)

  const [aLogo, bLogo, tourneyLogo] = await Promise.all([
    loadImage(match.team_a_logo  || null),
    loadImage(match.team_b_logo  || null),
    loadImage(match.league_logo  || null),
  ])
  const leagueNameText = String(match.league_name || match.league || match.tournament_name || 'CRICKET LEAGUE').toUpperCase()

  // ── Canvas & Palette ─────────────────────────────────────────────────────
  const W = 1920, H = 1080
  const { canvas, ctx } = createCanvas(W, H)

  const resultTheme = String(options?.resultTheme || options?.theme || 'icc-blue').toLowerCase()
  const RESULT_THEMES = {
    'icc-blue': {
      barTop: '#2dd4ff',
      barBot: '#2563eb',
      navy: '#081a3b',
      goldWin: '#f5c518',
      white: '#eaf2ff',
      offWhite: '#cbd5e1',
      row: 'rgba(18, 38, 86, 0.86)',
      line: 'rgba(127, 177, 255, 0.28)',
      softText: '#9bb6df',
      mainText: '#f3f8ff',
      accentTeal: '#00c4d4',
      bgStops: ['#040b24', '#0a1a45', '#10285e', '#050e2c'],
      wedgeRight: '#1d4ed8',
      rightDots: '#60a5fa',
      cardStops: ['#0f2252', '#102a61', '#0a1a3f'],
      overlayStops: ['rgba(255,255,255,0.14)', 'rgba(56,189,248,0.09)'],
      namesStops: ['rgba(8, 28, 68, 0.98)', 'rgba(13, 38, 92, 0.96)'],
      venueStops: ['rgba(11, 30, 74, 0.95)', 'rgba(14, 44, 108, 0.95)'],
      winStops: ['#0a1f4f', '#102f74'],
    },
    'neon-night': {
      barTop: '#22d3ee',
      barBot: '#a21caf',
      navy: '#120a2e',
      goldWin: '#34f5c5',
      white: '#eefbff',
      offWhite: '#b8f4f4',
      row: 'rgba(34, 12, 72, 0.84)',
      line: 'rgba(73, 245, 217, 0.35)',
      softText: '#9be7df',
      mainText: '#f2f8ff',
      accentTeal: '#16f2d0',
      bgStops: ['#070414', '#17062f', '#22114a', '#050412'],
      wedgeRight: '#7c3aed',
      rightDots: '#c084fc',
      cardStops: ['#1a1240', '#22185a', '#140f34'],
      overlayStops: ['rgba(255,255,255,0.12)', 'rgba(45,212,191,0.10)'],
      namesStops: ['rgba(24, 12, 60, 0.98)', 'rgba(35, 16, 78, 0.96)'],
      venueStops: ['rgba(22, 10, 56, 0.95)', 'rgba(36, 15, 80, 0.95)'],
      winStops: ['#1b0f4f', '#3d1a78'],
    },
    'royal-gold': {
      barTop: '#f8d44f',
      barBot: '#f59e0b',
      navy: '#1a123e',
      goldWin: '#ffd447',
      white: '#fff7e0',
      offWhite: '#f1dfb6',
      row: 'rgba(46, 30, 76, 0.86)',
      line: 'rgba(255, 214, 112, 0.34)',
      softText: '#e7c98b',
      mainText: '#fff8e8',
      accentTeal: '#f8d44f',
      bgStops: ['#120a28', '#27144d', '#3a1f65', '#160a2f'],
      wedgeRight: '#f59e0b',
      rightDots: '#fcd34d',
      cardStops: ['#2a1b4f', '#38225e', '#231648'],
      overlayStops: ['rgba(255,255,255,0.13)', 'rgba(251,191,36,0.10)'],
      namesStops: ['rgba(39, 21, 66, 0.98)', 'rgba(52, 27, 82, 0.96)'],
      venueStops: ['rgba(38, 20, 61, 0.95)', 'rgba(56, 29, 85, 0.95)'],
      winStops: ['#2e1b54', '#4b2a73'],
    },
  }

  const palette = RESULT_THEMES[resultTheme] || RESULT_THEMES['icc-blue']

  const BAR_TOP   = palette.barTop
  const BAR_BOT   = palette.barBot
  const NAVY      = palette.navy
  const GOLD_WIN  = palette.goldWin
  const WHITE     = palette.white
  const OFF_WHITE = palette.offWhite
  const GREY_ROW  = palette.row
  const GREY_LINE = palette.line
  const GREY_TXT  = palette.softText
  const BLACK_TXT = palette.mainText
  const TEAL      = palette.accentTeal
  const F         = '"Barlow Condensed", "Oswald", Impact, sans-serif'

  const calcInnBalls = (inn) => {
    if (!inn) return 0
    const fromTotal = Number(inn.total_balls || 0)
    if (fromTotal > 0) return fromTotal
    const fromBowling = Array.isArray(inn.bowling)
      ? inn.bowling.reduce((sum, b) => sum + Number(b?.balls_bowled || 0), 0)
      : 0
    if (fromBowling > 0) return fromBowling
    return Array.isArray(inn.batting)
      ? inn.batting.reduce((sum, b) => sum + Number(b?.balls_faced || 0), 0)
      : 0
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const t = (text, x, y, sz, color, align, wt) => {
    ctx.save(); ctx.font = `${wt||'700'} ${sz}px ${F}`
    ctx.fillStyle = color; ctx.textAlign = align || 'left'
    ctx.fillText(String(text ?? ''), x, y); ctx.restore()
  }
  const r = (x, y, w, h, color) => { if (w>0&&h>0) { ctx.fillStyle=color; ctx.fillRect(x,y,w,h) } }
  const hl = (x, y, w, color, h=1) => r(x, y, w, h, color)

  // Magenta bat/cricket icon — small rectangle bat shape
  function drawBatIcon(cx, cy, size, color) {
    ctx.save()
    ctx.fillStyle = color
    // Bat handle
    ctx.fillRect(cx - size*0.07, cy - size*0.55, size*0.14, size*0.35)
    // Bat blade
    ctx.beginPath()
    ctx.ellipse(cx, cy + size*0.05, size*0.28, size*0.38, 0, 0, Math.PI*2)
    ctx.fill()
    ctx.restore()
  }

  // Cricket ball — solid circle with seam
  function drawBallIcon(cx, cy, r2, color) {
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI*2)
    ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, r2*0.22)
    ctx.beginPath(); ctx.arc(cx, cy, r2*0.52, Math.PI*0.35, Math.PI*1.65); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, r2*0.52, Math.PI*1.35, Math.PI*2.65); ctx.stroke()
    ctx.restore()
  }

  // ── 1. OUTER BG — deep purple hex-grid ───────────────────────────────────
  const bgG = ctx.createLinearGradient(0,0,W,H)
  bgG.addColorStop(0, palette.bgStops[0]); bgG.addColorStop(0.42, palette.bgStops[1])
  bgG.addColorStop(0.72, palette.bgStops[2]); bgG.addColorStop(1, palette.bgStops[3])
  ctx.fillStyle = bgG; ctx.fillRect(0,0,W,H)

  // Hex grid
  ctx.save(); ctx.globalAlpha=0.07; ctx.strokeStyle='#8050d8'; ctx.lineWidth=1
  const HR=50
  for (let row=-1; row<H/(HR*1.5)+2; row++) {
    for (let col=-1; col<W/(HR*1.73)+2; col++) {
      const hx=col*HR*1.73+(row%2)*HR*0.865, hy=row*HR*1.5
      ctx.beginPath()
      for (let s=0;s<6;s++){const a=(Math.PI/3)*s-Math.PI/6;s===0?ctx.moveTo(hx+HR*Math.cos(a),hy+HR*Math.sin(a)):ctx.lineTo(hx+HR*Math.cos(a),hy+HR*Math.sin(a))}
      ctx.closePath(); ctx.stroke()
    }
  }
  ctx.globalAlpha=1; ctx.restore()

  // Corner wedges
  const wedge = (pts, color, alpha=0.82) => {
    ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle=color
    ctx.beginPath(); pts.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)); ctx.closePath(); ctx.fill()
    ctx.globalAlpha=1; ctx.restore()
  }
  wedge([[0,0],[240,0],[0,240]], TEAL)
  wedge([[0,60],[90,0],[60,0],[0,90]], '#00e0f0', 0.65)
  wedge([[W-240,0],[W,0],[W,240]], palette.wedgeRight)
  wedge([[W-90,0],[W,0],[W,90]], '#ff5500', 0.6)
  wedge([[0,H-200],[200,H],[0,H]], GOLD_WIN, 0.78)
  wedge([[0,H-70],[70,H],[0,H]], '#ff8800', 0.55)
  wedge([[W,H-200],[W-200,H],[W,H]], TEAL, 0.72)

  // Edge dots
  for (let i=0;i<13;i++) {
    const dy=170+i*54
    ctx.save(); ctx.globalAlpha=0.72
    ctx.beginPath(); ctx.arc(20+Math.sin(i*.9)*7, dy, 4.5, 0, Math.PI*2); ctx.fillStyle=GOLD_WIN; ctx.fill()
    ctx.beginPath(); ctx.arc(W-20+Math.sin(i*.9+1)*7, dy, 4.5, 0, Math.PI*2); ctx.fillStyle=palette.rightDots; ctx.fill()
    ctx.globalAlpha=1; ctx.restore()
  }

  // ── 2. MAIN CARD ─────────────────────────────────────────────────────────
  // Card dimensions — tight margins like reference
  const CX=96, CY=44, CW=W-192, CH=H-88, CRAD=12

  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=36; ctx.shadowOffsetY=6
  const cardBase = ctx.createLinearGradient(CX, CY, CX, CY + CH)
  cardBase.addColorStop(0, palette.cardStops[0])
  cardBase.addColorStop(0.52, palette.cardStops[1])
  cardBase.addColorStop(1, palette.cardStops[2])
  ctx.fillStyle=cardBase
  ctx.beginPath(); ctx.roundRect(CX,CY,CW,CH,CRAD); ctx.fill()
  ctx.shadowBlur=0; ctx.restore()

  const cardGrad = ctx.createLinearGradient(CX, CY, CX, CY + CH)
  cardGrad.addColorStop(0, palette.overlayStops[0])
  cardGrad.addColorStop(1, palette.overlayStops[1])
  ctx.save()
  ctx.beginPath(); ctx.roundRect(CX, CY, CW, CH, CRAD)
  ctx.clip()
  ctx.fillStyle = cardGrad
  ctx.fillRect(CX, CY, CW, CH)
  ctx.restore()

  // ── 3. GROUP BADGE STRIP ─────────────────────────────────────────────────
  // Thin strip at very top of card
  const GH=48   // group strip height
  ctx.save()
  ctx.beginPath(); ctx.roundRect(CX,CY,CW,GH,[CRAD,CRAD,0,0])
  ctx.fillStyle='rgba(7, 17, 44, 0.92)'; ctx.fill(); ctx.restore()
  hl(CX, CY+GH-1, CW, GREY_LINE)

  const GCX = CX+CW/2   // centre x of card
  const GCY = CY+GH/2

  // Flag A — left of group pill
  const FLAG_W=58, FLAG_H=30, FLAG_GAP=100
  if (aLogo) {
    ctx.save(); ctx.beginPath()
    ctx.roundRect(GCX-FLAG_GAP-FLAG_W, GCY-FLAG_H/2, FLAG_W, FLAG_H, 3); ctx.clip()
    drawCover(ctx, aLogo, GCX-FLAG_GAP-FLAG_W, GCY-FLAG_H/2, FLAG_W, FLAG_H)
    ctx.restore()
    ctx.strokeStyle=GREY_LINE; ctx.lineWidth=1
    ctx.strokeRect(GCX-FLAG_GAP-FLAG_W, GCY-FLAG_H/2, FLAG_W, FLAG_H)
  }

  // Group pill
  const PILL_W=156, PILL_H=28
  const pillGrad = ctx.createLinearGradient(GCX-PILL_W/2, GCY, GCX+PILL_W/2, GCY)
  pillGrad.addColorStop(0, '#0b1f4f')
  pillGrad.addColorStop(1, '#1e3a8a')
  ctx.fillStyle=pillGrad
  ctx.beginPath(); ctx.roundRect(GCX-PILL_W/2, GCY-PILL_H/2, PILL_W, PILL_H, PILL_H/2); ctx.fill()
  t((match.group_label||match.stage||'GROUP A').toUpperCase(), GCX, GCY+9, 16, WHITE, 'center', '700')

  // Flag B — right of group pill
  if (bLogo) {
    ctx.save(); ctx.beginPath()
    ctx.roundRect(GCX+FLAG_GAP, GCY-FLAG_H/2, FLAG_W, FLAG_H, 3); ctx.clip()
    drawCover(ctx, bLogo, GCX+FLAG_GAP, GCY-FLAG_H/2, FLAG_W, FLAG_H)
    ctx.restore()
    ctx.strokeStyle=GREY_LINE; ctx.lineWidth=1
    ctx.strokeRect(GCX+FLAG_GAP, GCY-FLAG_H/2, FLAG_W, FLAG_H)
  }

  // ── 4. TEAM NAMES ROW ────────────────────────────────────────────────────
  const NH=112   // names row height
  const NY=CY+GH
  const namesGrad = ctx.createLinearGradient(CX, NY, CX, NY + NH)
  namesGrad.addColorStop(0, palette.namesStops[0])
  namesGrad.addColorStop(1, palette.namesStops[1])
  r(CX, NY, CW, NH, namesGrad)
  hl(CX, NY+NH-1, CW, GREY_LINE)

  const leagueGrad = ctx.createLinearGradient(CX, NY, CX + CW, NY)
  leagueGrad.addColorStop(0, OFF_WHITE)
  leagueGrad.addColorStop(0.55, WHITE)
  leagueGrad.addColorStop(1, GOLD_WIN)
  ctx.save()
  ctx.font = `900 24px ${F}`
  ctx.textAlign = 'center'
  ctx.strokeStyle = 'rgba(6,12,28,0.85)'
  ctx.lineWidth = 3
  ctx.strokeText(leagueNameText, GCX, NY + 34)
  ctx.fillStyle = leagueGrad
  ctx.shadowColor = hexToRgba(OFF_WHITE, 0.35)
  ctx.shadowBlur = 10
  ctx.fillText(leagueNameText, GCX, NY + 34)
  ctx.restore()

  // Tournament logo/text centre
  const LOGO_SZ=60
  if (tourneyLogo) {
    drawCover(ctx, tourneyLogo, GCX-LOGO_SZ/2, NY+(NH-LOGO_SZ)/2, LOGO_SZ, LOGO_SZ)
  } else {
    t(match.format||'T20', GCX, NY+74, 28, BLACK_TXT, 'center', '900')
  }

  // Team name sizing — fit into half-card minus logo gap minus padding
  const NAME_MAX_W = CW/2 - LOGO_SZ/2 - 48
  function fitNameSz(text, maxW, startSz=88) {
    let sz=startSz
    while(sz>24){ ctx.font=`900 ${sz}px ${F}`; if(ctx.measureText(text).width<=maxW)break; sz-=2 }
    return sz
  }
  const nameA=(match.team_a_name||'TEAM A').toUpperCase()
  const nameB=(match.team_b_name||'TEAM B').toUpperCase()
  const szA=fitNameSz(nameA, NAME_MAX_W)
  const szB=fitNameSz(nameB, NAME_MAX_W)
  ctx.fillStyle=BLACK_TXT
  ctx.strokeStyle = 'rgba(6,12,28,0.82)'
  ctx.lineWidth = 3
  ctx.shadowColor = hexToRgba(OFF_WHITE, 0.24)
  ctx.shadowBlur = 8
  ctx.font=`900 ${szA}px ${F}`; ctx.textAlign='left'
  ctx.strokeText(nameA, CX+28, NY+88)
  ctx.fillText(nameA, CX+28, NY+88)
  ctx.font=`900 ${szB}px ${F}`; ctx.textAlign='right'
  ctx.strokeText(nameB, CX+CW-28, NY+88)
  ctx.fillText(nameB, CX+CW-28, NY+88)
  ctx.shadowBlur = 0

  // ── 5. VENUE STRIP ───────────────────────────────────────────────────────
  const VH=32
  const VY=NY+NH
  const venueGrad = ctx.createLinearGradient(CX, VY, CX + CW, VY)
  venueGrad.addColorStop(0, palette.venueStops[0])
  venueGrad.addColorStop(1, palette.venueStops[1])
  r(CX, VY, CW, VH, venueGrad)
  t((match.venue||'').toUpperCase(), GCX, VY+22, 16, GREY_TXT, 'center', '600')
  hl(CX, VY+VH-2, CW, GOLD_WIN, 2)   // gold bottom rule

  // ── 6. SCORECARD BODY ────────────────────────────────────────────────────
  const BY = VY+VH       // body start y
  const WIN_H = 52       // winner bar height
  const BH = CY+CH-BY-WIN_H   // total body height (batting+overs+bowling)
  const HW = CW/2        // half width of card

  // Row heights — dynamic to fill space precisely
  const SCORE_H = 50     // magenta score bar
  const OVERS_H = 38     // magenta overs bar
  const nBat    = Math.max(aBat.length, bBat.length)
  const nBowl   = Math.max(aBowl.length, bBowl.length)
  const FIXED   = SCORE_H + OVERS_H
  const AVAIL   = BH - FIXED
  const BAT_RH  = nBat  > 0 ? Math.max(46, Math.floor(AVAIL*0.52/nBat))  : 54
  const BWL_RH  = nBowl > 0 ? Math.max(40, Math.floor(AVAIL*0.48/nBowl)) : 48

  // Magenta gradient bar factory
  function magBar(px, py, pw, ph) {
    const g=ctx.createLinearGradient(px,py,px,py+ph)
    g.addColorStop(0,BAR_TOP); g.addColorStop(1,BAR_BOT)
    ctx.fillStyle=g; ctx.fillRect(px,py,pw,ph)
  }

  // ── Score bar: bat icon | SCORE bold centre | bat icon ───────────────────
  function drawScoreBar(px, py, pw, inn) {
    magBar(px, py, pw, SCORE_H)
    const sc=`${inn?.total_runs??0}-${inn?.total_wickets??0}`
    const icy=py+SCORE_H/2
    // Bat icons
    drawBatIcon(px+28, icy, SCORE_H*0.72, 'rgba(255,255,255,0.9)')
    drawBatIcon(px+pw-28, icy, SCORE_H*0.72, 'rgba(255,255,255,0.9)')
    // Score
    t(sc, px+pw/2, py+SCORE_H-10, 34, WHITE, 'center', '900')
  }

  // ── Batting row: NAME left | RUNS bold right-centre | BALLS small far-right
  function drawBatRow(p, px, py, pw, idx) {
    r(px, py, pw, BAT_RH, idx%2===0 ? 'rgba(13,34,81,0.92)' : GREY_ROW)
    hl(px, py+BAT_RH-1, pw, GREY_LINE)
    if (!p) return
    const cy=py+BAT_RH*0.66
    const NSZ=Math.min(28, Math.floor(BAT_RH*0.46))
    const RSZ=Math.min(34, Math.floor(BAT_RH*0.56))
    const BSZ=Math.min(22, Math.floor(BAT_RH*0.38))
    t((p.name||'—').toUpperCase(), px+18, cy, NSZ, BLACK_TXT, 'left', '700')
    t(p.runs??'-', px+pw-86, cy, RSZ, '#f9fbff', 'right', '900')
    t(p.balls_faced??'-', px+pw-14, cy, BSZ, GREY_TXT, 'right', '600')
  }

  // ── Overs bar: ball icon | NUMBER large "OVERS" small centre | ball icon ─
  function drawOversBar(px, py, pw, inn) {
    magBar(px, py, pw, OVERS_H)
    const balls=calcInnBalls(inn)
    const ovNum=`${Math.floor(balls/6)}.${balls%6}`
    const icy=py+OVERS_H/2
    drawBallIcon(px+24, icy, OVERS_H*0.28, 'rgba(255,255,255,0.88)')
    drawBallIcon(px+pw-24, icy, OVERS_H*0.28, 'rgba(255,255,255,0.88)')
    // Two-part text: number large, "OVERS" smaller — rendered together centred
    const NSZ=Math.floor(OVERS_H*0.58)
    const LSZ=Math.floor(OVERS_H*0.40)
    ctx.save()
    ctx.font=`900 ${NSZ}px ${F}`; const nw=ctx.measureText(ovNum).width
    ctx.font=`700 ${LSZ}px ${F}`; const lw=ctx.measureText(' OVERS').width
    const total=nw+lw
    const sx=px+pw/2-total/2
    const ty=py+OVERS_H-9
    const ovGrad = ctx.createLinearGradient(px, py, px + pw, py)
    ovGrad.addColorStop(0, '#ffffff')
    ovGrad.addColorStop(0.55, '#dbeafe')
    ovGrad.addColorStop(1, '#ffd166')
    ctx.fillStyle=ovGrad; ctx.textAlign='left'
    ctx.font=`900 ${NSZ}px ${F}`; ctx.fillText(ovNum, sx, ty)
    ctx.font=`700 ${LSZ}px ${F}`; ctx.fillText(' OVERS', sx+nw, ty)
    ctx.restore()
  }

  // ── Bowling row: NAME left | W-R bold right-centre | BALLS small far-right
  function drawBowlRow(p, px, py, pw, idx) {
    r(px, py, pw, BWL_RH, idx%2===0 ? 'rgba(13,34,81,0.92)' : GREY_ROW)
    hl(px, py+BWL_RH-1, pw, GREY_LINE)
    if (!p) return
    const cy=py+BWL_RH*0.68
    const NSZ=Math.min(26, Math.floor(BWL_RH*0.46))
    const RSZ=Math.min(30, Math.floor(BWL_RH*0.52))
    const BSZ=Math.min(20, Math.floor(BWL_RH*0.38))
    t((p.name||'—').toUpperCase(), px+18, cy, NSZ, BLACK_TXT, 'left', '700')
    const wR=`${p.wickets??0}-${p.runs_conceded??0}`
    t(wR, px+pw-86, cy, RSZ, '#f9fbff', 'right', '900')
    const mb=p.maidens??p.maiden_overs??'-'
    t(mb, px+pw-14, cy, BSZ, GREY_TXT, 'right', '600')
  }

  // ── Draw both panels ──────────────────────────────────────────────────────
  function drawPanel(px, pw, inn, bat, bowl) {
    let y=BY
    drawScoreBar(px, y, pw, inn); y+=SCORE_H
    for(let i=0;i<nBat;i++){ drawBatRow(bat[i]||null, px, y, pw, i); y+=BAT_RH }
    drawOversBar(px, y, pw, inn); y+=OVERS_H
    for(let i=0;i<nBowl;i++){ drawBowlRow(bowl[i]||null, px, y, pw, i); y+=BWL_RH }
  }

  drawPanel(CX,      HW,    aInn, aBat, aBowl)
  drawPanel(CX+HW+1, HW-1,  bInn, bBat, bBowl)

  // Centre vertical divider (inside card body)
  r(CX+HW, BY, 1, BH, GREY_LINE)

  // ── 7. WINNER BAR — dark navy, gold text, INSIDE card at bottom ───────────
  const WY = CY+CH-WIN_H
  ctx.save()
  ctx.beginPath(); ctx.roundRect(CX, WY, CW, WIN_H, [0,0,CRAD,CRAD])
  const winGrad = ctx.createLinearGradient(CX, WY, CX + CW, WY)
  winGrad.addColorStop(0, palette.winStops[0])
  winGrad.addColorStop(1, palette.winStops[1])
  ctx.fillStyle=winGrad
  ctx.fill(); ctx.restore()
  hl(CX, WY, CW, GOLD_WIN, 2)   // gold top border

  const resultTxt=(match.result_summary||'MATCH COMPLETE').toUpperCase()
  const rSz=fitText(ctx, resultTxt, CW-120, 38, 18, '900')
  ctx.save()
  ctx.font=`900 ${rSz}px ${F}`; ctx.fillStyle=GOLD_WIN; ctx.textAlign='center'
  ctx.shadowColor='rgba(245,197,24,0.55)'; ctx.shadowBlur=18
  ctx.fillText(resultTxt, GCX, WY+WIN_H-14)
  ctx.shadowBlur=0; ctx.restore()

  return { canvas, id: match.id, name: 'result_banner' }
}

async function _generateMatchWinnerBanner(match, scorecard, leagueObj) {
  const aInn = scorecard.find((s) => s.batting_team_id === match.team_a_id)
  const bInn = scorecard.find((s) => s.batting_team_id === match.team_b_id)

  let teamA = null
  let teamB = null
  try { teamA = await fetch(`${API}/teams/${match.team_a_id}`).then((r) => r.json()) } catch (_) {}
  try { teamB = await fetch(`${API}/teams/${match.team_b_id}`).then((r) => r.json()) } catch (_) {}

  const [aLogo, bLogo, leagueLogo, aCaptainPhoto, bCaptainPhoto] = await Promise.all([
    loadImage(teamA?.logo || match.team_a_logo || null),
    loadImage(teamB?.logo || match.team_b_logo || null),
    loadImage(leagueObj?.logo || match.league_logo || null),
    loadImage(teamA?.captain_photo || null),
    loadImage(teamB?.captain_photo || null),
  ])

  const W = 1920
  const H = 1080
  const { canvas, ctx } = createCanvas(W, H)

  const r = (x, y, w, h, color) => { if (w > 0 && h > 0) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) } }
  const t = (text, x, y, size, color, align = 'left', weight = '700') => {
    ctx.save()
    ctx.font = `${weight} ${size}px "Barlow Condensed", sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(String(text ?? ''), x, y)
    ctx.restore()
  }
  const drawContain = (c, img, x, y, w, h) => {
    if (!img || !w || !h) return
    const s = Math.min(w / img.width, h / img.height)
    const dw = img.width * s
    const dh = img.height * s
    c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }

  const winnerId = Number(match.winner_team_id || match.winning_team_id || 0)
  const winnerName = String(
    match.winner_team_name
    || match.winning_team_name
    || (winnerId && winnerId === Number(match.team_a_id) ? match.team_a_name : '')
    || (winnerId && winnerId === Number(match.team_b_id) ? match.team_b_name : '')
    || (String(match.result_summary || '').split(' won ')[0])
    || 'WINNER'
  )

  const winnerIsA = winnerName.toLowerCase() === String(match.team_a_name || '').toLowerCase() || winnerId === Number(match.team_a_id)
  const winnerLogo = winnerIsA ? aLogo : bLogo
  const winnerCaptainPhoto = winnerIsA ? aCaptainPhoto : bCaptainPhoto
  const winnerColor = winnerIsA ? '#5bc0ff' : '#ff6bd6'
  const loserColor = winnerIsA ? '#ff6bd6' : '#5bc0ff'
  const loserName = winnerIsA ? String(match.team_b_name || 'TEAM B') : String(match.team_a_name || 'TEAM A')

  const scoreA = `${aInn?.total_runs ?? 0}/${aInn?.total_wickets ?? 0} (${Math.floor((aInn?.total_balls || 0) / 6)}.${(aInn?.total_balls || 0) % 6} ov)`
  const scoreB = `${bInn?.total_runs ?? 0}/${bInn?.total_wickets ?? 0} (${Math.floor((bInn?.total_balls || 0) / 6)}.${(bInn?.total_balls || 0) % 6} ov)`

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#050f2b')
  bg.addColorStop(0.48, '#140f48')
  bg.addColorStop(1, '#050f2b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Stadium-like scene: flood lights + stand silhouette + grass pitch.
  const lightL = ctx.createRadialGradient(W * 0.18, H * 0.24, 20, W * 0.18, H * 0.24, H * 0.38)
  lightL.addColorStop(0, 'rgba(163,220,255,0.42)')
  lightL.addColorStop(1, 'rgba(163,220,255,0)')
  ctx.fillStyle = lightL
  ctx.fillRect(0, 0, W, H)

  const lightR = ctx.createRadialGradient(W * 0.82, H * 0.24, 20, W * 0.82, H * 0.24, H * 0.38)
  lightR.addColorStop(0, 'rgba(255,203,238,0.40)')
  lightR.addColorStop(1, 'rgba(255,203,238,0)')
  ctx.fillStyle = lightR
  ctx.fillRect(0, 0, W, H)

  const stands = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.64)
  stands.addColorStop(0, 'rgba(6,10,24,0.2)')
  stands.addColorStop(1, 'rgba(4,7,18,0.8)')
  ctx.fillStyle = stands
  ctx.fillRect(0, H * 0.40, W, H * 0.26)

  const pitch = ctx.createLinearGradient(0, H * 0.66, 0, H)
  pitch.addColorStop(0, 'rgba(30,94,44,0.20)')
  pitch.addColorStop(1, 'rgba(12,58,30,0.64)')
  ctx.fillStyle = pitch
  ctx.fillRect(0, H * 0.60, W, H * 0.40)

  goldBar(ctx, 0, 0, W, 8)
  r(0, 24, W, 126, 'rgba(0,0,0,0.36)')
  t((leagueObj?.name || match.league_name || 'CRICKET LEAGUE').toUpperCase(), W / 2, 90, 56, '#ffffff', 'center', '900')
  t(`MATCH #${match.match_number || ''}  ·  ${(match.date || match.match_date || '').toUpperCase()}  ·  ${(match.venue || 'VENUE TBA').toUpperCase()}`, W / 2, 130, 24, '#c5d7ff', 'center', '700')

  const centerX = W / 2
  const winnerY = 160
  r(180, winnerY, W - 360, 166, 'rgba(10,16,42,0.74)')
  ctx.strokeStyle = 'rgba(247,201,72,0.55)'
  ctx.lineWidth = 2
  ctx.strokeRect(180, winnerY, W - 360, 166)

  t('MATCH WINNER', centerX, winnerY + 52, 44, '#f7c948', 'center', '900')
  t(winnerName.toUpperCase(), centerX, winnerY + 114, 76, '#ffffff', 'center', '900')
  t((match.result_summary || 'WINNER DECIDED').toUpperCase(), centerX, winnerY + 152, 28, winnerColor, 'center', '800')

  // Big captain feature panel.
  const heroX = W * 0.5 - 270
  const heroY = 346
  const heroW = 540
  const heroH = 520
  r(heroX - 20, heroY - 18, heroW + 40, heroH + 36, 'rgba(8,14,34,0.66)')
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  ctx.strokeRect(heroX - 20, heroY - 18, heroW + 40, heroH + 36)
  if (winnerCaptainPhoto) {
    drawContain(ctx, winnerCaptainPhoto, heroX, heroY, heroW, heroH)
  } else if (winnerLogo) {
    drawContain(ctx, winnerLogo, heroX + 80, heroY + 70, heroW - 160, heroH - 140)
  }

  // Big winner tag angled from opponent side.
  ctx.save()
  ctx.translate(winnerIsA ? W * 0.80 : W * 0.20, H * 0.56)
  ctx.rotate(winnerIsA ? -0.22 : 0.22)
  ctx.fillStyle = 'rgba(247,201,72,0.92)'
  ctx.fillRect(-230, -74, 460, 148)
  ctx.strokeStyle = 'rgba(11,16,36,0.80)'
  ctx.lineWidth = 4
  ctx.strokeRect(-230, -74, 460, 148)
  ctx.restore()
  t('WINNER', winnerIsA ? W * 0.80 : W * 0.20, H * 0.57, 86, '#101a36', 'center', '900')
  t(`OVER ${loserName.toUpperCase()}`, winnerIsA ? W * 0.80 : W * 0.20, H * 0.62, 36, '#101a36', 'center', '900')

  // Team names and score bars around hero.
  const sideY = 420
  r(86, sideY, 500, 188, 'rgba(8,18,45,0.80)')
  r(W - 586, sideY, 500, 188, 'rgba(8,18,45,0.80)')
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(86, sideY, 500, 188)
  ctx.strokeRect(W - 586, sideY, 500, 188)

  t(String(match.team_a_name || 'TEAM A').toUpperCase(), 126, sideY + 64, 48, winnerIsA ? winnerColor : loserColor, 'left', '900')
  t(scoreA.toUpperCase(), 126, sideY + 126, 34, '#ffffff', 'left', '800')
  t(String(match.team_b_name || 'TEAM B').toUpperCase(), W - 126, sideY + 64, 48, winnerIsA ? loserColor : winnerColor, 'right', '900')
  t(scoreB.toUpperCase(), W - 126, sideY + 126, 34, '#ffffff', 'right', '800')

  if (aLogo) drawCover(ctx, aLogo, 96, sideY + 132, 74, 48)
  if (bLogo) drawCover(ctx, bLogo, W - 170, sideY + 132, 74, 48)

  const mom = String(match.mom_name || '').trim()
  t(`CAPTAIN FEATURED  ·  PLAYER OF THE MATCH: ${(mom || 'N/A').toUpperCase()}`, W / 2, 930, 30, '#f7c948', 'center', '800')
  t(`FORMAT: ${(match.format || leagueObj?.format || 'T20').toUpperCase()}   ·   SEASON: ${(leagueObj?.season || match.season || 'N/A').toUpperCase()}`, W / 2, 968, 26, '#c6d2ef', 'center', '700')

  if (leagueLogo) drawContain(ctx, leagueLogo, W / 2 - 54, 1000, 108, 58)

  r(0, H - 58, W, 58, 'rgba(0,0,0,0.56)')
  t('OFFICIAL WINNER GRAPHIC', W / 2, H - 20, 28, '#ffffff', 'center', '800')
  goldBar(ctx, 0, H - 8, W, 8)

  return { canvas, id: match.id, name: 'winner_banner' }
}

async function _generateLeagueWinnerBanner(leagueId) {
  const [leagueDetails, pointsRows, leagueMatches] = await Promise.all([
    fetch(`${API}/leagues/${leagueId}`).then((r) => r.json()),
    fetch(`${API}/leagues/${leagueId}/points`).then((r) => r.json()).catch(() => []),
    fetch(`${API}/leagues/${leagueId}/matches`).then((r) => r.json()).catch(() => []),
  ])

  const rows = Array.isArray(pointsRows) ? pointsRows : []
  const sorted = [...rows].sort((a, b) => {
    if (Number(b.points || 0) !== Number(a.points || 0)) return Number(b.points || 0) - Number(a.points || 0)
    return Number(b.nrr || b.net_run_rate || 0) - Number(a.nrr || a.net_run_rate || 0)
  })

  const champion = sorted[0] || null
  const championName = String(champion?.name || champion?.team_name || 'LEAGUE WINNER')
  const championId = champion?.team_id || champion?.id
  let championLogo = null
  if (championId) {
    try {
      const team = await fetch(`${API}/teams/${championId}`).then((r) => r.json())
      championLogo = await loadImage(team?.logo || null)
    } catch {
      championLogo = null
    }
  }
  const leagueLogo = await loadImage(leagueDetails?.logo || null)

  const matches = Array.isArray(leagueMatches) ? leagueMatches : []
  const completed = matches.filter((m) => String(m?.status || '').toLowerCase() === 'completed' || !!m?.result_summary)
  const finalMatch = [...completed].sort((a, b) => Number(b.match_number || 0) - Number(a.match_number || 0))[0] || null

  const W = 1920
  const H = 1080
  const { canvas, ctx } = createCanvas(W, H)

  const r = (x, y, w, h, color) => { if (w > 0 && h > 0) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) } }
  const t = (text, x, y, size, color, align = 'left', weight = '700') => {
    ctx.save()
    ctx.font = `${weight} ${size}px "Barlow Condensed", sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(String(text ?? ''), x, y)
    ctx.restore()
  }

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#041325')
  bg.addColorStop(0.52, '#08203a')
  bg.addColorStop(1, '#041325')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const shine = ctx.createRadialGradient(W * 0.5, H * 0.36, 0, W * 0.5, H * 0.36, H * 0.7)
  shine.addColorStop(0, 'rgba(247,201,72,0.30)')
  shine.addColorStop(1, 'rgba(247,201,72,0)')
  ctx.fillStyle = shine
  ctx.fillRect(0, 0, W, H)

  goldBar(ctx, 0, 0, W, 10)
  r(0, 20, W, 144, 'rgba(0,0,0,0.38)')
  t((leagueDetails?.name || 'CRICKET LEAGUE').toUpperCase(), W / 2, 96, 62, '#ffffff', 'center', '900')
  t(`SEASON ${(leagueDetails?.season || 'N/A').toString().toUpperCase()}  ·  ${(leagueDetails?.format || 'T20').toString().toUpperCase()}  ·  ${(leagueDetails?.city || '').toString().toUpperCase()}`, W / 2, 140, 28, '#d7e7ff', 'center', '700')

  const centerY = 210
  r(180, centerY, W - 360, 510, 'rgba(8,18,46,0.72)')
  ctx.strokeStyle = 'rgba(247,201,72,0.62)'
  ctx.lineWidth = 2
  ctx.strokeRect(180, centerY, W - 360, 510)

  if (leagueLogo) drawCover(ctx, leagueLogo, W / 2 - 70, centerY + 24, 140, 140)
  if (championLogo) drawCover(ctx, championLogo, W / 2 - 120, centerY + 176, 240, 220)

  t('LEAGUE CHAMPIONS', W / 2, centerY + 78, 44, '#f7c948', 'center', '900')
  t(championName.toUpperCase(), W / 2, centerY + 452, 78, '#ffffff', 'center', '900')

  const champPoints = Number(champion?.points || 0)
  const champM = Number(champion?.matches || champion?.played || 0)
  const champW = Number(champion?.wins || 0)
  const champL = Number(champion?.losses || 0)
  const champNrr = Number(champion?.nrr || champion?.net_run_rate || 0).toFixed(3)

  t(`POINTS: ${champPoints}   ·   PLAYED: ${champM}   ·   WINS: ${champW}   ·   LOSSES: ${champL}   ·   NRR: ${champNrr}`, W / 2, centerY + 498, 30, '#cae1ff', 'center', '800')

  const finalsInfo = finalMatch
    ? `FINAL MATCH #${finalMatch.match_number || '-'}  ·  ${(finalMatch.result_summary || 'RESULT RECORDED').toUpperCase()}`
    : 'FINAL DETAILS: TO BE UPDATED'
  t(finalsInfo, W / 2, centerY + 536, 26, '#f7c948', 'center', '700')

  r(0, H - 150, W, 150, 'rgba(0,0,0,0.52)')
  t(`ORGANIZER: ${(leagueDetails?.organizer || 'N/A').toString().toUpperCase()}  ·  VENUE: ${(leagueDetails?.venue || 'N/A').toString().toUpperCase()}`, W / 2, H - 88, 30, '#ffffff', 'center', '700')
  t('OFFICIAL LEAGUE WINNER BANNER', W / 2, H - 46, 34, '#f7c948', 'center', '800')
  goldBar(ctx, 0, H - 8, W, 8)

  return { canvas, id: leagueDetails.id || leagueId, name: 'league_winner_banner' }
}

async function _generateSummaryBanner(match, scorecard, leagueObj) {
  /* ── DATA ── */
  const inn1 = scorecard.find(s => s.innings_number === 1) || scorecard.find(s => s.batting_team_id === match.team_a_id)
  const inn2 = scorecard.find(s => s.innings_number === 2) || scorecard.find(s => s.batting_team_id === match.team_b_id)

  // Derive fall-of-wickets from batting array if not present
  function deriveFow(inn) {
    if (inn?.fall_of_wickets?.length) return inn.fall_of_wickets
    // Build from batting dismissals (exclude not-outs)
    const dismissed = (inn?.batting || [])
      .filter(p => p.runs != null && p.how_out !== 'not out' && !p.not_out)
      .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))
    return dismissed.map((p, i) => ({
      wicket: i + 1,
      score: `${p.runs_at_dismissal || p.runs || 0}/${i + 1}`,
      player_name: p.name,
      over: p.over_dismissed || null,
    }))
  }

  async function loadPlayerPhotos(rows) {
    return Promise.all((rows || []).map(p => loadImage(p.photo || null)))
  }
  const [aLogo, bLogo, leagueLogo,
         inn1BatPhotos, inn1BowlPhotos,
         inn2BatPhotos, inn2BowlPhotos] = await Promise.all([
    loadImage(match.team_a_logo || null),
    loadImage(match.team_b_logo || null),
    loadImage(leagueObj?.logo || null),
    loadPlayerPhotos(inn1?.batting),
    loadPlayerPhotos(inn1?.bowling),
    loadPlayerPhotos(inn2?.batting),
    loadPlayerPhotos(inn2?.bowling),
  ])

  const fow1 = deriveFow(inn1)
  const fow2 = deriveFow(inn2)

  /* ── CANVAS — dynamic height ── */
  const W = 2560

  // Pre-calculate how many rows each panel needs to determine canvas height
  const LEAGUE_BAR_H = 90          // ← NEW: league info strip at top
  const TEAM_HDR_H   = 76
  const BAT_HDR_H    = 50
  const EXTRAS_H     = 44
  const TOTAL_H      = 54
  const BOWL_HDR_H   = 56
  const BOWLCOL_H    = 46

  const maxBatRows  = Math.max((inn1?.batting||[]).length,  (inn2?.batting||[]).length)
  const maxBowlRows = Math.max((inn1?.bowling||[]).length,  (inn2?.bowling||[]).length)
  const maxFowRows  = Math.max(fow1.length, fow2.length)
  const bottomRows  = Math.max(maxBowlRows, maxFowRows)

  const MIN_H      = 1440
  const FIXED_H    = LEAGUE_BAR_H + TEAM_HDR_H + BAT_HDR_H + EXTRAS_H + TOTAL_H + BOWL_HDR_H + BOWLCOL_H
  const AVAIL_ROWS = MIN_H - FIXED_H
  const BAT_AVAIL  = Math.floor(AVAIL_ROWS * 0.55)
  const BOWL_AVAIL = Math.floor(AVAIL_ROWS * 0.45)
  const ROW_H      = maxBatRows  > 0 ? Math.max(56, Math.floor(BAT_AVAIL  / maxBatRows))  : 72
  const BOWL_ROW_H = bottomRows  > 0 ? Math.max(50, Math.floor(BOWL_AVAIL / bottomRows))  : 62

  const H = Math.max(MIN_H,
    FIXED_H + maxBatRows * ROW_H + bottomRows * BOWL_ROW_H + 10)

  const { canvas, ctx } = createCanvas(W, H)

  /* ── DARK BRAND TOKENS (matches GraphicsGeneratorPanel deep navy) ── */
  const BG_DEEP    = '#020b1c'
  const BG_MID     = '#071633'
  const ROW_DARK   = 'rgba(255,255,255,0.04)'
  const ROW_ALT    = 'rgba(255,255,255,0.08)'
  const HDR_NAVY   = 'rgba(10,20,50,0.85)'
  const HDR_COL    = 'rgba(15,32,64,0.90)'
  const HDR_FOW    = 'rgba(8,24,56,0.90)'
  const DIVIDER    = 'rgba(240,180,41,0.25)'
  const BORDER     = 'rgba(255,255,255,0.10)'
  const WHITE      = '#ffffff'
  const TEXT_PRI   = '#ffffff'
  const TEXT_SEC   = '#a8c4e8'
  const TEXT_DIM   = '#6080a8'
  const GOLD       = '#f0b429'
  const GOLD_L     = '#ffe066'
  const GREEN      = '#22c55e'
  const RED_BULL   = '#ef4444'
  const BLUE_BULL  = '#60a5fa'
  const F          = '"Barlow Condensed", sans-serif'
  const FB         = '"Barlow", sans-serif'

  /* ── HELPERS ── */
  const t = (text, x, y, sz, color, align, wt, font) => {
    ctx.save()
    ctx.font = `${wt||'600'} ${sz}px ${font||F}`
    ctx.fillStyle = color; ctx.textAlign = align || 'left'
    ctx.fillText(String(text ?? ''), x, y); ctx.restore()
  }
  const r = (x, y, w, h, color) => { if (w > 0 && h > 0) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) } }
  const hl = (x, y, w, color, th) => r(x, y, w, th||1, color)

  function drawCirclePhoto(img, cx, cy, radius, fallbackColor, fallbackLetter) {
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip()
    if (img) {
      const scale = Math.max((radius*2)/img.width, (radius*2)/img.height)
      const dw = img.width * scale, dh = img.height * scale
      ctx.drawImage(img, cx - dw/2, cy - dh/2, dw, dh)
    } else {
      ctx.fillStyle = fallbackColor || 'rgba(255,255,255,0.15)'
      ctx.fillRect(cx-radius, cy-radius, radius*2, radius*2)
      if (fallbackLetter) {
        ctx.font = `700 ${Math.round(radius)}px ${F}`
        ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(fallbackLetter.charAt(0).toUpperCase(), cx, cy)
        ctx.textBaseline = 'alphabetic'
      }
    }
    ctx.restore()
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.restore()
  }

  /* ── LAYOUT ── */
  const PANEL_W = W / 2
  const GAP     = 3
  const P1X     = 0
  const P2X     = PANEL_W + GAP
  const PW      = PANEL_W - GAP / 2

  // Scale font/photo sizes with row height
  const PHOTO_R  = Math.min(30, Math.floor(ROW_H * 0.37))
  const NAME_SZ  = Math.min(26, Math.floor(ROW_H * 0.33))
  const DISM_SZ  = Math.min(18, Math.floor(ROW_H * 0.23))
  const STAT_SZ  = Math.min(26, Math.floor(ROW_H * 0.33))   // ← bigger stat font
  const B_PHOTO  = Math.min(26, Math.floor(BOWL_ROW_H * 0.37))
  const B_NAME   = Math.min(23, Math.floor(BOWL_ROW_H * 0.33))
  const B_STAT   = Math.min(22, Math.floor(BOWL_ROW_H * 0.31))

  // Batting stat columns — wider spacing for bigger numbers
  const COL_SR  = PW - 24
  const COL_6S  = COL_SR  - 128
  const COL_4S  = COL_6S  - 118
  const COL_B   = COL_4S  - 118
  const COL_R   = COL_B   - 118

  // Bowling stat columns (within half-panel)
  const HALF    = PW / 2
  const BC_ECO  = HALF - 24
  const BC_W    = BC_ECO - 88
  const BC_M    = BC_W   - 76
  const BC_R    = BC_M   - 76
  const BC_O    = BC_R   - 76

  /* ════════════ DEEP NAVY BACKGROUND (brand style) ════════════ */
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0,   BG_DEEP)
  bg.addColorStop(0.5, BG_MID)
  bg.addColorStop(1,   BG_DEEP)
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  // Subtle dot matrix texture
  dotMatrix(ctx, W, H)

  // Gold top bar
  goldBar(ctx, 0, 0, W, 7)

  // Centre divider — gold tint
  r(PANEL_W - 1, LEAGUE_BAR_H, GAP + 2, H - LEAGUE_BAR_H, DIVIDER)

  /* ════════════ LEAGUE INFO BAR (full width) ════════════ */
  // Semi-transparent dark overlay for league bar
  r(0, 7, W, LEAGUE_BAR_H - 7, 'rgba(0,0,0,0.45)')
  hl(0, LEAGUE_BAR_H, W, 'rgba(240,180,41,0.5)', 2)

  // League logo left
  const LBY = 7 + (LEAGUE_BAR_H - 7) / 2   // vertical centre of league bar
  if (leagueLogo) {
    const lSize = LEAGUE_BAR_H - 22
    drawCover(ctx, leagueLogo, 28, 7 + 11, lSize, lSize)
  }
  // League name
  const leagueName   = (leagueObj?.name   || match.league_name || '').toUpperCase()
  const leagueSeason = (leagueObj?.season || match.season      || '')
  const matchNum     = match.match_number ? `MATCH ${match.match_number}` : ''
  const matchDateRaw = match.match_date || match.date || ''
  const matchDate    = matchDateRaw ? new Date(matchDateRaw).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''
  const venue        = (match.venue || match.ground || '').toUpperCase()
  const matchFormat  = (match.format || leagueObj?.format || '').toUpperCase()

  let lx = leagueLogo ? (28 + LEAGUE_BAR_H - 22 + 18) : 28
  if (leagueName) {
    t(leagueName, lx, LBY + 6,  32, GOLD,     'left', '900')
    if (leagueSeason) t(`• ${leagueSeason}`, lx + ctx.measureText(leagueName).width + 14, LBY + 6, 26, GOLD_L, 'left', '700')
  }

  // Centre: match number + date + venue
  const centreInfo = [matchNum, matchDate, venue].filter(Boolean).join('   •   ')
  if (centreInfo) t(centreInfo, W/2, LBY + 6, 26, TEXT_SEC, 'center', '700')
  if (matchFormat) t(matchFormat, W/2, LBY + 32, 20, TEXT_DIM, 'center', '600')

  // Right: format badge
  if (matchFormat && !centreInfo.includes(matchFormat)) {
    const fmtW = ctx.measureText(matchFormat).width + 32
    r(W - fmtW - 32, LBY - 18, fmtW, 36, 'rgba(240,180,41,0.15)')
    ctx.strokeStyle = 'rgba(240,180,41,0.4)'; ctx.lineWidth = 1.5
    ctx.strokeRect(W - fmtW - 32, LBY - 18, fmtW, 36)
    t(matchFormat, W - fmtW/2 - 32, LBY + 8, 22, GOLD, 'center', '800')
  }

  /* ════════════ PANEL DRAW ════════════ */
  function drawPanel(px, inn, teamName, teamLogo, batPhotos, bowlPhotos, fow, isLeft) {
    let y = LEAGUE_BAR_H   // start below the league info bar

    /* ── Team header ── */
    r(px, y, PW, TEAM_HDR_H, HDR_NAVY)
    if (teamLogo) drawCover(ctx, teamLogo, px + 16, y + 13, 50, 50)
    t(teamName.toUpperCase(), px + (teamLogo ? 80 : 22), y + 48, 34, WHITE, 'left', '900')
    const sc  = `${inn?.total_runs ?? 0}/${inn?.total_wickets ?? 0}`
    const ov  = `${Math.floor((inn?.total_balls||0)/6)}.${(inn?.total_balls||0)%6}`
    const crr = inn?.total_balls > 0 ? ((inn.total_runs / inn.total_balls)*6).toFixed(2) : '0.00'
    t(sc,               px + PW - 22, y + 34, 32, WHITE,   'right', '900')
    t(`(${ov} overs)`,  px + PW - 22, y + 58, 19, TEXT_SEC,'right', '600')
    t(`CRR: ${crr} rpo`,px + PW - 22, y + 73, 15, TEXT_DIM,'right', '600', FB)
    hl(px, y + TEAM_HDR_H - 1, PW, DIVIDER, 2)
    y += TEAM_HDR_H

    /* ── Batting column header ── */
    r(px, y, PW, BAT_HDR_H, HDR_COL)
    t('/ BATTING', px + 22, y + BAT_HDR_H - 14, 19, TEXT_SEC, 'left', '700')
    t('R',   px + COL_R,  y + BAT_HDR_H - 14, 18, TEXT_SEC, 'center', '700')
    t('B',   px + COL_B,  y + BAT_HDR_H - 14, 18, TEXT_SEC, 'center', '700')
    t('4S',  px + COL_4S, y + BAT_HDR_H - 14, 18, TEXT_SEC, 'center', '700')
    t('6S',  px + COL_6S, y + BAT_HDR_H - 14, 18, TEXT_SEC, 'center', '700')
    t('S/R', px + COL_SR, y + BAT_HDR_H - 14, 18, TEXT_SEC, 'right',  '700')
    hl(px, y + BAT_HDR_H - 1, PW, BORDER)
    y += BAT_HDR_H

    /* ── Batting rows ── */
    const batters = inn?.batting || []
    for (let i = 0; i < maxBatRows; i++) {
      const p     = batters[i]
      const rowBg = i % 2 === 0 ? ROW_DARK : ROW_ALT
      r(px, y, PW, ROW_H, rowBg)
      hl(px, y + ROW_H - 1, PW, BORDER)
      if (p) {
        const cy = y + ROW_H / 2
        ctx.save(); ctx.beginPath(); ctx.arc(px + 14, cy, 7, 0, Math.PI*2)
        ctx.fillStyle = BLUE_BULL; ctx.fill(); ctx.restore()
        const photoCX = px + 14 + 10 + PHOTO_R
        drawCirclePhoto(batPhotos[i], photoCX, cy, PHOTO_R, 'rgba(96,165,250,0.2)', p.name)
        const nameX = photoCX + PHOTO_R + 16
        const nameY = p.dismissal ? y + ROW_H * 0.42 : y + ROW_H * 0.60
        t(p.name || '—', nameX, nameY, NAME_SZ, TEXT_PRI, 'left', '700', FB)
        if (p.dismissal)
          t(p.dismissal, nameX, y + ROW_H * 0.76, DISM_SZ, TEXT_DIM, 'left', '400', FB)
        else if (p.how_out === 'not out' || p.not_out)
          t('not out', nameX, y + ROW_H * 0.76, DISM_SZ, GREEN, 'left', '600', FB)
        const statY = y + ROW_H * 0.62
        const sr = p.balls_faced > 0 ? ((p.runs/p.balls_faced)*100).toFixed(2) : '-'
        t(p.runs??'-',        px+COL_R,  statY, STAT_SZ, WHITE,    'center', '800', FB)
        t(p.balls_faced??'-', px+COL_B,  statY, STAT_SZ, TEXT_SEC, 'center', '600', FB)
        t(p.fours??'-',       px+COL_4S, statY, STAT_SZ, TEXT_SEC, 'center', '600', FB)
        t(p.sixes??'-',       px+COL_6S, statY, STAT_SZ, TEXT_SEC, 'center', '600', FB)
        t(sr,                 px+COL_SR, statY, STAT_SZ, TEXT_DIM, 'right',  '600', FB)
      }
      y += ROW_H
    }

    /* ── Extras ── */
    r(px, y, PW, EXTRAS_H, ROW_DARK)
    hl(px, y + EXTRAS_H - 1, PW, BORDER)
    const extStr = inn?.extras_detail || (inn?.extras != null ? `Extras  ${inn.extras}` : 'Extras  0')
    t(extStr, px + 22, y + EXTRAS_H * 0.68, 18, TEXT_DIM, 'left', '400', FB)
    if (inn?.extras != null)
      t(String(inn.extras), px + PW - 26, y + EXTRAS_H * 0.68, 20, TEXT_SEC, 'right', '600', FB)
    y += EXTRAS_H

    /* ── Total row ── */
    r(px, y, PW, TOTAL_H, HDR_NAVY)
    hl(px, y, PW, DIVIDER, 2)
    t(`TOTAL  ${ov} OVERS`, px + 22, y + TOTAL_H * 0.66, 22, WHITE, 'left', '900')
    t(sc, px + PW - 22, y + TOTAL_H * 0.66, 28, GOLD, 'right', '900')
    hl(px, y + TOTAL_H - 1, PW, DIVIDER, 2)
    y += TOTAL_H

    /* ── Bottom: BOWLING (left half) + FOW (right half) ── */
    const BL_X = px
    const FW_X = px + HALF

    const bowlTeamName = isLeft ? (match.team_b_name||'BOWLING') : (match.team_a_name||'BOWLING')
    const bowlTeamLogo = isLeft ? bLogo : aLogo
    const fowTeamName  = isLeft ? (match.team_a_name||'BATTING') : (match.team_b_name||'BATTING')
    const fowTeamLogo  = isLeft ? aLogo : bLogo

    r(BL_X, y, HALF, BOWL_HDR_H, HDR_NAVY)
    if (bowlTeamLogo) drawCover(ctx, bowlTeamLogo, BL_X+16, y+10, 38, 38)
    t(bowlTeamName.toUpperCase(), BL_X+(bowlTeamLogo?62:16), y+BOWL_HDR_H*0.68, 22, WHITE, 'left', '800')
    hl(BL_X, y + BOWL_HDR_H - 1, HALF, BORDER)

    r(FW_X, y, HALF, BOWL_HDR_H, HDR_FOW)
    if (fowTeamLogo) drawCover(ctx, fowTeamLogo, FW_X+16, y+10, 38, 38)
    t(fowTeamName.toUpperCase(), FW_X+(fowTeamLogo?62:16), y+BOWL_HDR_H*0.68, 22, WHITE, 'left', '800')
    hl(FW_X, y + BOWL_HDR_H - 1, HALF, BORDER)
    y += BOWL_HDR_H

    r(BL_X, y, HALF, BOWLCOL_H, HDR_COL)
    t('● BOWLING', BL_X+16, y+BOWLCOL_H*0.72, 17, TEXT_SEC, 'left', '700')
    t('O',   BL_X+BC_O,   y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'center', '700')
    t('R',   BL_X+BC_R,   y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'center', '700')
    t('M',   BL_X+BC_M,   y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'center', '700')
    t('W',   BL_X+BC_W,   y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'center', '700')
    t('ECO', BL_X+BC_ECO, y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'right',  '700')
    hl(BL_X, y + BOWLCOL_H - 1, HALF, BORDER)

    r(FW_X, y, HALF, BOWLCOL_H, HDR_FOW)
    t('⚡ FALL OF WICKETS', FW_X+16, y+BOWLCOL_H*0.72, 17, TEXT_SEC, 'left', '700')
    t('OVERS', FW_X+HALF-20, y+BOWLCOL_H*0.70, 16, TEXT_SEC, 'right', '700')
    hl(FW_X, y + BOWLCOL_H - 1, HALF, BORDER)
    y += BOWLCOL_H

    const bowlers = inn?.bowling || []
    for (let i = 0; i < bottomRows; i++) {
      const p  = bowlers[i]
      const fw = fow[i]
      const rowBg = i % 2 === 0 ? ROW_DARK : ROW_ALT

      r(BL_X, y, HALF, BOWL_ROW_H, rowBg)
      hl(BL_X, y+BOWL_ROW_H-1, HALF, BORDER)
      r(FW_X, y, HALF, BOWL_ROW_H, i % 2 === 0 ? ROW_DARK : 'rgba(255,255,255,0.06)')
      hl(FW_X, y+BOWL_ROW_H-1, HALF, BORDER)

      const cy2  = y + BOWL_ROW_H / 2
      const txtY = y + BOWL_ROW_H * 0.64

      if (p) {
        ctx.save(); ctx.beginPath(); ctx.arc(BL_X+14, cy2, 7, 0, Math.PI*2)
        ctx.fillStyle = RED_BULL; ctx.fill(); ctx.restore()
        drawCirclePhoto(bowlPhotos[i], BL_X+14+10+B_PHOTO, cy2, B_PHOTO, 'rgba(239,68,68,0.2)', p.name)
        const bNameX = BL_X+14+10+B_PHOTO*2+16
        t(p.name||'—', bNameX, txtY, B_NAME, TEXT_PRI, 'left', '700', FB)
        const ov2  = p.balls_bowled > 0 ? `${Math.floor(p.balls_bowled/6)}.${p.balls_bowled%6}` : String(p.overs||'0')
        const eco2 = p.balls_bowled > 0 ? ((p.runs_conceded/p.balls_bowled)*6).toFixed(2) : '-'
        const wkts = p.wickets ?? 0
        t(ov2,                          BL_X+BC_O,   txtY, B_STAT, TEXT_SEC, 'center', '600', FB)
        t(String(p.runs_conceded??'-'), BL_X+BC_R,   txtY, B_STAT, TEXT_SEC, 'center', '600', FB)
        t(String(p.maidens??'0'),       BL_X+BC_M,   txtY, B_STAT, TEXT_SEC, 'center', '600', FB)
        t(String(wkts), BL_X+BC_W, txtY, B_STAT+2, wkts>0?GOLD:TEXT_DIM, 'center', wkts>0?'900':'600', FB)
        t(eco2,                         BL_X+BC_ECO, txtY, B_STAT, TEXT_SEC, 'right',  '600', FB)
      }
      if (fw) {
        const sc2    = fw.score || `${fw.runs||''}/${fw.wicket||i+1}`
        const plName = (fw.player_name || fw.batsman || '').toUpperCase()
        t(sc2,    FW_X+20,      txtY, B_STAT+1, TEXT_SEC, 'left',  '800', FB)
        t(plName, FW_X+130,     txtY, B_STAT,   TEXT_PRI, 'left',  '700', F)
        if (fw.over) t(String(fw.over), FW_X+HALF-20, txtY, B_STAT, TEXT_DIM, 'right', '600', FB)
      }
      y += BOWL_ROW_H
    }
  }

  // Gold bottom bar
  goldBar(ctx, 0, H - 6, W, 6)

  drawPanel(P1X, inn1, match.team_a_name||'TEAM A', aLogo, inn1BatPhotos, inn1BowlPhotos, fow1, true)
  drawPanel(P2X, inn2, match.team_b_name||'TEAM B', bLogo, inn2BatPhotos, inn2BowlPhotos, fow2, false)

  return { canvas, id: match.id, name: 'summary_banner' }
}

/* ─── Fixtures Banner ─────────────────────────────────────────────── */

async function _generateFixturesBanner(leagueId) {
  const [leagueDetails, allMatches] = await Promise.all([
    fetch(`${API}/leagues/${leagueId}`).then(r => r.json()),
    fetch(`${API}/leagues/${leagueId}/matches`).then(r => r.json()).catch(() => []),
  ])

  const matches = Array.isArray(allMatches) ? allMatches : []
  const sponsorList = Array.isArray(leagueDetails.sponsors) ? leagueDetails.sponsors.slice(0, 6) : []
  const leagueLogo = await loadImage(leagueDetails.logo)

  // Load team logos for each unique team
  const teamIds = [...new Set(matches.flatMap(m => [m.team_a_id, m.team_b_id].filter(Boolean)))]
  const teamLogoMap = {}
  await Promise.all(teamIds.map(async id => {
    try {
      const team = await fetch(`${API}/teams/${id}`).then(r => r.json())
      teamLogoMap[id] = await loadImage(team.logo || null)
    } catch { teamLogoMap[id] = null }
  }))

  /* ── PALETTE ── */
  const PURPLE_0 = '#13003b'
  const PURPLE_1 = '#24005b'
  const PURPLE_2 = '#330a72'
  const INDIGO   = '#1c1a73'
  const MAGENTA  = '#f414b5'
  const MAGENTA_D= '#b10e9c'
  const WHITE    = '#ffffff'
  const TEXT_SOFT= '#d6c7ff'
  const TEXT_DIM = '#9d8ec8'
  const GOLD_L   = '#ffd66d'
  const BORDER   = 'rgba(255,255,255,0.13)'
  const ROW_EVEN = 'rgba(255,255,255,0.05)'
  const ROW_ODD  = 'rgba(255,255,255,0.02)'
  const F        = '"Sora", "Montserrat", "Poppins", "Barlow Condensed", sans-serif'
  const FB       = '"Manrope", "Inter", "Barlow", sans-serif'
  const FT       = '"Bebas Neue", "Sora", "Barlow Condensed", sans-serif'

  const rows = [...matches].sort((a, b) => {
    const aTime = new Date(`${a.match_date || a.date || ''}T${a.match_time || a.time || '00:00'}`).getTime() || 0
    const bTime = new Date(`${b.match_date || b.date || ''}T${b.match_time || b.time || '00:00'}`).getTime() || 0
    return aTime - bTime
  })

  /* ── DYNAMIC HEIGHT ── */
  const W = 1920
  const HDR_H = 240
  const TABLE_TOP = HDR_H + 34
  const ROW_H = 58
  const COL_HDR = 52
  const FOOTER_H = 122
  const H = Math.max(1080, TABLE_TOP + COL_HDR + rows.length * ROW_H + FOOTER_H + 32)

  const { canvas, ctx } = createCanvas(W, H)

  /* ── HELPERS ── */
  const t = (text, x, y, sz, color, align, wt, font) => {
    ctx.save(); ctx.font = `${wt || '600'} ${sz}px ${font || F}`
    ctx.fillStyle = color; ctx.textAlign = align || 'left'
    ctx.fillText(String(text ?? ''), x, y); ctx.restore()
  }
  const r = (x, y, w, h, color) => { if (w > 0 && h > 0) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) } }
  const hl = (x, y, w, color, th) => r(x, y, w, th || 1, color)
  const formatDateLabel = (d) => {
    if (!d) return 'TBD'
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return String(d).toUpperCase()
    const wd = dt.toLocaleDateString('en-US', { weekday: 'short' })
    const day = dt.getDate()
    const month = dt.toLocaleDateString('en-US', { month: 'short' })
    return `${wd}, ${day} ${month}`.toUpperCase()
  }
  const formatRange = () => {
    const validDates = rows.map(m => new Date(m.match_date || m.date || '')).filter(d => !Number.isNaN(d.getTime()))
    if (!validDates.length) return `${(leagueDetails.season || 'SEASON').toUpperCase()}`
    const min = new Date(Math.min(...validDates.map(d => d.getTime())))
    const max = new Date(Math.max(...validDates.map(d => d.getTime())))
    const left = `${min.getDate()} ${min.toLocaleDateString('en-US', { month: 'long' })}`.toUpperCase()
    const right = `${max.getDate()} ${max.toLocaleDateString('en-US', { month: 'long' })} ${max.getFullYear()}`.toUpperCase()
    return `${left} - ${right}`
  }

  const formatLabel = String(leagueDetails.format || 'LEAGUE').replace(/[-_]/g, ' ').toUpperCase()
  const cityLabel = String(leagueDetails.city || leagueDetails.venue || 'CITY TBD').toUpperCase()
  const leagueNameLabel = String(leagueDetails.name || 'CRICKET LEAGUE').toUpperCase()
  const ownerLabel = String(
    leagueDetails.owner_name ||
    leagueDetails.owner ||
    leagueDetails.organizer ||
    leagueDetails.organizer_name ||
    'TBD'
  ).toUpperCase()

  function drawFlagLogo(img, x, y, w, h) {
    if (!img) return
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 4)
    ctx.fillStyle = 'rgba(10,8,34,0.92)'
    ctx.fill()
    ctx.clip()
    const sc = Math.min(w / img.width, h / img.height)
    const dw = img.width * sc
    const dh = img.height * sc
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 4)
    ctx.strokeStyle = 'rgba(255,255,255,0.24)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  /* ── 1. BACKGROUND ── */
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, PURPLE_0)
  bg.addColorStop(0.45, PURPLE_1)
  bg.addColorStop(1, INDIGO)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(W * 0.85, H * 0.2, 20, W * 0.85, H * 0.2, H * 0.8)
  glow.addColorStop(0, 'rgba(255,60,190,0.26)')
  glow.addColorStop(1, 'rgba(255,60,190,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Dot texture to mimic broadcast panel style
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  for (let yy = 130; yy < H; yy += 12) {
    for (let xx = 90; xx < W - 90; xx += 12) {
      if (((xx + yy) / 12) % 2 === 0) ctx.fillRect(xx, yy, 1.8, 1.8)
    }
  }
  ctx.restore()

  /* ── 2. HEADER ── */
  const topBand = ctx.createLinearGradient(0, 0, W, 0)
  topBand.addColorStop(0, '#7f10d8')
  topBand.addColorStop(0.45, MAGENTA)
  topBand.addColorStop(1, MAGENTA_D)
  ctx.fillStyle = topBand
  ctx.fillRect(0, 0, W, 110)

  // Angled right edge block like TV graphics package
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(W - 420, 0)
  ctx.lineTo(W, 0)
  ctx.lineTo(W, 130)
  ctx.lineTo(W - 500, 130)
  ctx.closePath()
  ctx.fillStyle = 'rgba(34,8,78,0.58)'
  ctx.fill()
  ctx.restore()

  // Center logo in a neutral plate and preserve transparent PNG feel using contain-fit.
  const logoPlateW = 124
  const logoPlateH = 84
  const logoPlateX = W * 0.5 - logoPlateW * 0.5
  const logoPlateY = 16
  if (leagueLogo) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(logoPlateX, logoPlateY, logoPlateW, logoPlateH, 16)
    ctx.fillStyle = 'rgba(15,10,40,0.45)'
    ctx.fill()
    const ls = Math.min((logoPlateW - 18) / leagueLogo.width, (logoPlateH - 14) / leagueLogo.height)
    const ldw = leagueLogo.width * ls
    const ldh = leagueLogo.height * ls
    ctx.drawImage(leagueLogo, logoPlateX + (logoPlateW - ldw) / 2, logoPlateY + (logoPlateH - ldh) / 2, ldw, ldh)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  // Bold gradient league name + simple schedule subtitle only.
  const titleGrad = ctx.createLinearGradient(W * 0.25, 0, W * 0.75, 0)
  titleGrad.addColorStop(0, '#ffffff')
  titleGrad.addColorStop(0.45, '#ffe8ff')
  titleGrad.addColorStop(1, '#ffd66d')
  const leagueNameSize = fitText(ctx, leagueNameLabel, W * 0.86, 90, 40)
  t(leagueNameLabel, W * 0.5, 138, leagueNameSize, titleGrad, 'center', '900', FT)
  t('MATCH SCHEDULES', W * 0.5, 176, 36, TEXT_SOFT, 'center', '800', FT)

  /* ── 3. TABLE HEADER ── */
  const tableX = 86
  const tableW = W - tableX * 2
  let Y = TABLE_TOP

  ctx.save()
  ctx.beginPath(); ctx.roundRect(tableX, Y, tableW, COL_HDR, 12)
  ctx.fillStyle = 'rgba(31,11,76,0.96)'
  ctx.fill()
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()

  const dateX = tableX + 120
  const teamANameX = tableX + 760
  const vsX = tableX + tableW * 0.5
  const teamBNameX = tableX + tableW - 760
  const venueX = tableX + tableW - 56

  t('DATE', dateX, Y + 34, 24, TEXT_SOFT, 'center', '800')
  t('TEAM A', teamANameX, Y + 34, 24, TEXT_SOFT, 'right', '800')
  t('V', vsX, Y + 34, 24, GOLD_L, 'center', '900')
  t('TEAM B', teamBNameX, Y + 34, 24, TEXT_SOFT, 'left', '800')
  t('VENUE', venueX, Y + 34, 24, TEXT_SOFT, 'right', '800')

  // Center vertical beam behind the V column.
  const beam = ctx.createLinearGradient(vsX, Y + COL_HDR + 6, vsX, H - FOOTER_H - 6)
  beam.addColorStop(0, 'rgba(255,255,255,0.16)')
  beam.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = beam
  ctx.fillRect(vsX - 2, Y + COL_HDR + 4, 4, H - FOOTER_H - (Y + COL_HDR + 4))
  Y += COL_HDR + 6

  /* ── 4. ROWS ── */
  if (!rows.length) {
    t('NO FIXTURES YET', W / 2, Y + 72, 38, TEXT_SOFT, 'center', '800')
    t('GENERATE FIXTURES FROM ADMIN PANEL', W / 2, Y + 114, 24, TEXT_DIM, 'center', '600', FB)
    Y += 150
  } else {
    rows.forEach((m, idx) => {
      const rowY = Y + idx * ROW_H
      r(tableX, rowY, tableW, ROW_H, idx % 2 === 0 ? ROW_EVEN : ROW_ODD)
      hl(tableX, rowY + ROW_H - 1, tableW, 'rgba(255,255,255,0.09)')

      const cy = rowY + ROW_H * 0.5
      const aName = (m.team_a_name || 'TEAM A').toUpperCase()
      const bName = (m.team_b_name || 'TEAM B').toUpperCase()
      const venue = (m.venue || leagueDetails.city || 'TBD').toUpperCase()

      t(formatDateLabel(m.match_date || m.date), dateX, cy + 10, 23, TEXT_SOFT, 'center', '700', FB)

      drawFlagLogo(teamLogoMap[m.team_a_id], teamANameX + 14, cy - 16, 34, 24)
      const aSize = fitText(ctx, aName, 360, 29, 16)
      t(aName, teamANameX, cy + 10, aSize, WHITE, 'right', '800', FB)

      t('v', vsX, cy + 10, 30, GOLD_L, 'center', '900')

      drawFlagLogo(teamLogoMap[m.team_b_id], teamBNameX - 48, cy - 16, 34, 24)
      const bSize = fitText(ctx, bName, 360, 29, 16)
      t(bName, teamBNameX, cy + 10, bSize, WHITE, 'left', '800', FB)

      const venueSize = fitText(ctx, venue, 360, 24, 15)
      t(venue, venueX, cy + 10, venueSize, TEXT_SOFT, 'right', '600', FB)
    })
    Y += rows.length * ROW_H
  }

  /* ── 5. FOOTER ── */
  const footerY = H - FOOTER_H
  r(0, footerY, W, FOOTER_H, 'rgba(12,8,35,0.94)')
  hl(0, footerY, W, 'rgba(255,255,255,0.22)', 1)
  hl(0, footerY + 58, W, 'rgba(255,255,255,0.08)', 1)

  // Owner and sponsors details only.
  t(`LEAGUE OWNER: ${ownerLabel}`, 70, footerY + 38, 24, WHITE, 'left', '800', FB)
  const sponsorNameLine = sponsorList
    .map((s) => (s && (s.name || s.title || s.company || s.brand)) ? String(s.name || s.title || s.company || s.brand).toUpperCase() : '')
    .filter(Boolean)
    .slice(0, 4)
    .join('  ·  ')
  t('SPONSORS:', W - 72, footerY + 38, 24, WHITE, 'right', '800', FB)
  t(sponsorNameLine || 'NO SPONSORS ADDED', W - 72, footerY + 86, 20, sponsorNameLine ? TEXT_SOFT : TEXT_DIM, 'right', '650', FB)

  return { canvas, id: leagueDetails.id, name: 'fixtures_banner' }
}

async function _finish(result, category, options = {}) {
  const dataUrl = result.canvas.toDataURL('image/png', 1.0)
  const fileName = `${result.name}_${result.id}.png`
  await saveBanner({ category, fileName, imageData: dataUrl })
  if (options.download !== false) {
    await downloadPng(dataUrl, fileName)
  }
  return fileName
}

/* ─── Named Exports for AdminPanel integration ────────────────────── */

export async function generateSquadBannerForTeam(teamId, options = {}) {
  const result = await _generateTeamBanner(teamId)
  return _finish(result, 'teams', options)
}

export async function generateCaptainPosterForTeam(teamId, options = {}) {
  const result = await _generateCaptainPoster(teamId)
  return _finish(result, 'teams', options)
}

export async function generateLeagueBannerForLeague(leagueId, options = {}) {
  const result = await _generateLeagueBanner(leagueId)
  return _finish(result, 'leagues', options)
}

export async function generateVsBannerForMatch(match, leagueObj, options = {}) {
  const result = await _generateVsBanner(match, leagueObj, options)
  return _finish(result, 'matches', options)
}

export async function generateInningsBannerForMatch(match, scorecard, type, options = {}) {
  const result = await _generateInningsBanner(match, scorecard, type)
  return _finish(result, 'matches', options)
}

export async function generateResultBannerForMatch(match, scorecard, options = {}) {
  const result = await _generateResultBanner(match, scorecard, options)
  return _finish(result, 'results', options)
}

export async function generateMatchWinnerBannerForMatch(match, scorecard, leagueObj, options = {}) {
  const result = await _generateMatchWinnerBanner(match, scorecard, leagueObj)
  return _finish(result, 'results', options)
}

export async function generateSummaryBannerForMatch(match, scorecard, leagueObj, options = {}) {
  const result = await _generateSummaryBanner(match, scorecard, leagueObj)
  return _finish(result, 'results', options)
}

export async function generateFixturesBannerForLeague(leagueId, options = {}) {
  const result = await _generateFixturesBanner(leagueId)
  return _finish(result, 'leagues', options)
}

export async function generateLeagueWinnerBannerForLeague(leagueId, options = {}) {
  const result = await _generateLeagueWinnerBanner(leagueId)
  return _finish(result, 'leagues', options)
}

/* ─── Component ───────────────────────────────────────────────────── */

export default function GraphicsGeneratorPanel() {
  const [leagues, setLeagues] = useState([])
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [selectedLeague, setSelectedLeague] = useState('')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedMatch, setSelectedMatch] = useState('')
  const [working, setWorking] = useState(false)
  const [lastGenerated, setLastGenerated] = useState(null)
  const [resultBannerTheme, setResultBannerTheme] = useState('icc-blue')

  useEffect(() => {
    fetch(`${API}/leagues`).then(r => r.json()).then(data => {
      setLeagues(data || [])
      if (data?.[0]) setSelectedLeague(String(data[0].id))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedLeague) return
    fetch(`${API}/leagues/${selectedLeague}/teams`).then(r => r.json()).then(data => {
      setTeams(data || [])
      if (data?.[0]) setSelectedTeam(String(data[0].id))
    }).catch(() => {})
    fetch(`${API}/leagues/${selectedLeague}/matches`).then(r => r.json()).then(data => {
      setMatches(data || [])
      if (data?.[0]) setSelectedMatch(String(data[0].id))
    }).catch(() => {})
  }, [selectedLeague])

  const selectedLeagueObj = useMemo(() => leagues.find(l => String(l.id) === String(selectedLeague)) || null, [leagues, selectedLeague])
  const selectedTeamObj   = useMemo(() => teams.find(t => String(t.id) === String(selectedTeam)) || null, [teams, selectedTeam])
  const selectedMatchObj  = useMemo(() => matches.find(m => String(m.id) === String(selectedMatch)) || null, [matches, selectedMatch])

  const withWorker = async (fn) => {
    setWorking(true)
    setLastGenerated(null)
    try { await fn() }
    catch (err) { alert(err.message || 'Banner generation failed') }
    finally { setWorking(false) }
  }

  const finish = async (result, category) => {
    const dataUrl = result.canvas.toDataURL('image/png', 1.0)
    const fileName = `${result.name}_${result.id}.png`
    await saveBanner({ category, fileName, imageData: dataUrl })
    await downloadPng(dataUrl, fileName)
    setLastGenerated(fileName)
  }

  const generateLeagueBanner   = () => withWorker(async () => { if (!selectedLeagueObj) throw new Error('Select a league'); const result = await _generateLeagueBanner(selectedLeagueObj.id); await finish(result, 'leagues') })
  const generateTeamBanner     = () => withWorker(async () => { if (!selectedTeamObj) throw new Error('Select a team'); const result = await _generateTeamBanner(selectedTeamObj.id); await finish(result, 'teams') })
  const generateCaptainPoster  = () => withWorker(async () => { if (!selectedTeamObj) throw new Error('Select a team'); const result = await _generateCaptainPoster(selectedTeamObj.id); await finish(result, 'teams') })
  const generateVsBanner       = () => withWorker(async () => { if (!selectedMatchObj) throw new Error('Select a fixture match'); const result = await _generateVsBanner(selectedMatchObj, selectedLeagueObj); await finish(result, 'matches') })
  const generateResultBanner   = () => withWorker(async () => { if (!selectedMatchObj) throw new Error('Select a completed match'); const [match, sc] = await Promise.all([fetch(`${API}/matches/${selectedMatchObj.id}`).then(r => r.json()), fetch(`${API}/matches/${selectedMatchObj.id}/scorecard`).then(r => r.json())]); const result = await _generateResultBanner(match, sc, { resultTheme: resultBannerTheme }); await finish(result, 'results') })
  const generateWinnerBanner   = () => withWorker(async () => { if (!selectedMatchObj) throw new Error('Select a completed match'); const [match, sc] = await Promise.all([fetch(`${API}/matches/${selectedMatchObj.id}`).then(r => r.json()), fetch(`${API}/matches/${selectedMatchObj.id}/scorecard`).then(r => r.json())]); const result = await _generateMatchWinnerBanner(match, sc, selectedLeagueObj); await finish(result, 'results') })
  const generateSummaryBanner  = () => withWorker(async () => { if (!selectedMatchObj) throw new Error('Select a match'); const [match, sc] = await Promise.all([fetch(`${API}/matches/${selectedMatchObj.id}`).then(r => r.json()), fetch(`${API}/matches/${selectedMatchObj.id}/scorecard`).then(r => r.json())]); const result = await _generateSummaryBanner(match, sc); await finish(result, 'results') })
  const generateInningsBanner  = (type) => withWorker(async () => { if (!selectedMatchObj) throw new Error('Select a match'); const [match, sc] = await Promise.all([fetch(`${API}/matches/${selectedMatchObj.id}`).then(r => r.json()), fetch(`${API}/matches/${selectedMatchObj.id}/scorecard`).then(r => r.json())]); const result = await _generateInningsBanner(match, sc, type); await finish(result, 'matches') })
  const generateFixturesBanner = () => withWorker(async () => { if (!selectedLeagueObj) throw new Error('Select a league'); const result = await _generateFixturesBanner(selectedLeagueObj.id); await finish(result, 'leagues') })
  const generateLeagueWinnerBanner = () => withWorker(async () => { if (!selectedLeagueObj) throw new Error('Select a league'); const result = await _generateLeagueWinnerBanner(selectedLeagueObj.id); await finish(result, 'leagues') })

  const sections = [
    { group: 'League',     icon: '🏆', color: 'var(--gold)',   items: [{ title: 'League Banner', sub: '1920 × 720 · Owner + Sponsors', action: generateLeagueBanner }, { title: 'Fixtures Schedule', sub: '1920 × Dynamic · All Matches', action: generateFixturesBanner }, { title: 'League Winner', sub: '1920 × 1080 · Champion Details', action: generateLeagueWinnerBanner }] },
    { group: 'Team',       icon: '👥', color: 'var(--accent)', items: [{ title: 'Squad Banner', sub: '1920 × 1080', action: generateTeamBanner }, { title: 'Captain Poster', sub: '1600 × 900 · League Info', action: generateCaptainPoster }] },
    { group: 'Fixtures',   icon: '⚡', color: 'var(--sky)',    items: [{ title: 'VS Banner',            sub: '1920 × 1080 · ICC Style', action: generateVsBanner }] },
    { group: 'Live Match', icon: '🔴', color: 'var(--red)',    items: [{ title: '1st Innings Full Card', sub: '1920 × Dynamic · All Batsmen & Bowlers', action: () => generateInningsBanner('first') }, { title: '2nd Innings / Chase', sub: '1920 × Dynamic · Full Scorecard + Chase', action: () => generateInningsBanner('second') }] },
    { group: 'Results',    icon: '🏅', color: 'var(--orange)', items: [{ title: 'Result Banner', sub: '1920 × 1080', action: generateResultBanner }, { title: 'Match Winner', sub: '1920 × 1080 · Winner Details', action: generateWinnerBanner }, { title: 'Full Match Summary', sub: '2560 × Dynamic', action: generateSummaryBanner }] },
  ]

  return (
    <div style={{ padding: '4px 0 40px' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 28, paddingBottom: 20,
        borderBottom: '1px solid var(--glass-bd)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(135deg, var(--gold), #c97b10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.4rem', flexShrink: 0,
          boxShadow: '0 4px 20px rgba(247,201,72,0.25)',
        }}>🎨</div>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '1.3rem', letterSpacing: '-0.02em', margin: 0 }}>
            Graphics Generator
          </h2>
          <p style={{ color: 'var(--t3)', fontSize: '0.78rem', margin: '2px 0 0', fontFamily: 'var(--font-display)', letterSpacing: '0.3px' }}>
            Broadcast-quality banners · PNG export
          </p>
        </div>
      </div>

      {/* ── Context Selectors ── */}
      <div className="glass-card" style={{
        padding: '18px 20px', marginBottom: 28,
        borderTop: '3px solid var(--gold)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" style={{ color: 'var(--gold)' }}>League</label>
            <select className="form-select" value={selectedLeague} onChange={e => setSelectedLeague(e.target.value)}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23f7c948' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}>
              {leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ color: 'var(--gold)' }}>Team</label>
            <select className="form-select" value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ color: 'var(--gold)' }}>Match</label>
            <select className="form-select" value={selectedMatch} onChange={e => setSelectedMatch(e.target.value)}>
              {matches.map(m => <option key={m.id} value={m.id}>#{m.match_number} · {m.team_a_name} vs {m.team_b_name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ color: 'var(--gold)' }}>Result Banner Theme</label>
            <select className="form-select" value={resultBannerTheme} onChange={e => setResultBannerTheme(e.target.value)}>
              <option value="icc-blue">ICC Blue</option>
              <option value="neon-night">Neon Night</option>
              <option value="royal-gold">Royal Gold</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Banner Sections ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {sections.map(section => (
          <div key={section.group}>
            {/* Section label */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700,
              fontSize: '0.68rem', letterSpacing: '2px', textTransform: 'uppercase',
              color: 'var(--t3)', marginBottom: 10,
            }}>
              <span>{section.icon}</span>
              <span>{section.group}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--glass-bd)', marginLeft: 4 }} />
            </div>

            {/* Cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
              {section.items.map(item => (
                <div key={item.title} className="glass-card" style={{
                  padding: '16px 18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  borderLeft: `3px solid ${section.color}`,
                  transition: 'border-color 0.2s, background 0.2s',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--t1)', letterSpacing: '0.2px', marginBottom: 2 }}>
                      {item.title}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--t3)', letterSpacing: '0.5px' }}>
                      {item.sub}
                    </div>
                  </div>
                  <button
                    disabled={working}
                    onClick={item.action}
                    style={{
                      background: working ? 'var(--glass-bg)' : `linear-gradient(135deg, ${section.color}, ${section.color}cc)`,
                      border: `1px solid ${section.color}55`,
                      borderRadius: 'var(--r-md)',
                      color: working ? 'var(--t3)' : '#fff',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800, fontSize: '0.72rem',
                      letterSpacing: '1px', textTransform: 'uppercase',
                      padding: '8px 16px', cursor: working ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
                      opacity: working ? 0.5 : 1,
                    }}
                  >
                    {working ? '…' : 'Generate'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Status ── */}
      {working && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 24, padding: '12px 16px',
          background: 'var(--gold-dim)',
          border: '1px solid rgba(247,201,72,0.22)',
          borderRadius: 'var(--r-lg)', fontSize: '0.84rem', color: 'var(--gold)',
          fontFamily: 'var(--font-display)', fontWeight: 700,
        }}>
          <span style={{ display: 'inline-block', animation: 'spin .8s linear infinite', fontSize: '1rem' }}>⟳</span>
          Rendering broadcast-quality banner…
        </div>
      )}
      {!working && lastGenerated && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 24, padding: '12px 16px',
          background: 'var(--accent-dim)',
          border: '1px solid rgba(0,232,150,0.22)',
          borderRadius: 'var(--r-lg)', fontSize: '0.84rem', color: 'var(--accent)',
          fontFamily: 'var(--font-display)', fontWeight: 700,
        }}>
          ✓ &nbsp;<strong>{lastGenerated}</strong> saved and downloaded
        </div>
      )}
    </div>
  )
}
