const BACKEND_RAW = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '');
const API_BASE = BACKEND_RAW.startsWith('http')
  ? (BACKEND_RAW.endsWith('/api') ? BACKEND_RAW : `${BACKEND_RAW}/api`)
  : '/api';
const MEDIA_BASE = API_BASE.replace(/\/api$/, '');

let bannerPreviewEl = null;
let bannerPreviewEscHandler = null;

const ensureBannerPreviewStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ch-banner-preview-styles')) return;

  const style = document.createElement('style');
  style.id = 'ch-banner-preview-styles';
  style.textContent = `
    .ch-banner-preview-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(2, 6, 14, 0.78);
      backdrop-filter: blur(10px) saturate(120%);
      -webkit-backdrop-filter: blur(10px) saturate(120%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: chBannerFade .18s ease;
    }

    .ch-banner-preview-card {
      width: min(92vw, 760px);
      max-height: 90vh;
      background: linear-gradient(165deg, rgba(14, 24, 42, 0.96), rgba(7, 12, 24, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.48);
      display: flex;
      flex-direction: column;
      animation: chBannerPop .2s ease;
    }

    .ch-banner-preview-media-wrap {
      padding: 10px;
      overflow: auto;
    }

    .ch-banner-preview-media {
      width: 100%;
      max-height: calc(90vh - 120px);
      object-fit: contain;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.03);
    }

    .ch-banner-preview-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 12px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.02);
    }

    .ch-banner-preview-btn {
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      color: #e8f3ff;
      background: rgba(255, 255, 255, 0.05);
    }

    .ch-banner-preview-btn-primary {
      color: #042014;
      border-color: rgba(0, 232, 150, 0.4);
      background: linear-gradient(135deg, #00e896, #00b876);
    }

    @keyframes chBannerFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes chBannerPop {
      from { opacity: 0; transform: scale(0.96) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
  `;

  document.head.appendChild(style);
};

const closeBannerPreview = () => {
  if (!bannerPreviewEl || typeof document === 'undefined') return;
  bannerPreviewEl.remove();
  bannerPreviewEl = null;
  if (bannerPreviewEscHandler) {
    window.removeEventListener('keydown', bannerPreviewEscHandler);
    bannerPreviewEscHandler = null;
  }
  document.body.style.overflow = '';
};

const openBannerPreview = (src, fileName) => {
  if (typeof document === 'undefined') return;

  ensureBannerPreviewStyles();
  closeBannerPreview();

  const overlay = document.createElement('div');
  overlay.className = 'ch-banner-preview-overlay';

  const card = document.createElement('div');
  card.className = 'ch-banner-preview-card';

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'ch-banner-preview-media-wrap';

  const img = document.createElement('img');
  img.className = 'ch-banner-preview-media';
  img.src = src;
  img.alt = 'Banner preview';

  const actions = document.createElement('div');
  actions.className = 'ch-banner-preview-actions';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ch-banner-preview-btn';
  closeBtn.textContent = 'Close';

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'ch-banner-preview-btn ch-banner-preview-btn-primary';
  dlBtn.textContent = 'Download';

  closeBtn.addEventListener('click', closeBannerPreview);
  dlBtn.addEventListener('click', () => downloadFromUrl(src, fileName));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBannerPreview();
  });

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      closeBannerPreview();
    }
  };
  bannerPreviewEscHandler = onEsc;
  window.addEventListener('keydown', onEsc);

  mediaWrap.appendChild(img);
  actions.appendChild(closeBtn);
  actions.appendChild(dlBtn);
  card.appendChild(mediaWrap);
  card.appendChild(actions);
  overlay.appendChild(card);

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  bannerPreviewEl = overlay;
};

export function toAbsoluteMediaUrl(src) {
  if (!src || typeof src !== 'string') return '';
  if (/^https?:\/\//i.test(src)) return src;
  const normalized = src.startsWith('/') ? src : `/${src}`;
  if (normalized.startsWith('/media/') || normalized.startsWith('/uploads/')) {
    return `${MEDIA_BASE}${normalized}`;
  }
  return normalized;
}

export function downloadFromUrl(src, fileName = 'banner.png') {
  const resolved = toAbsoluteMediaUrl(src)
  if (!resolved) return
  const link = document.createElement('a')
  link.href = resolved
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function downloadDataUrl(dataUrl, fileName = 'download.png') {
  if (!dataUrl) return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function handleBannerTap(src, fileName = 'banner.png') {
  const resolved = toAbsoluteMediaUrl(src);
  if (!resolved) return;

  openBannerPreview(resolved, fileName);
}
