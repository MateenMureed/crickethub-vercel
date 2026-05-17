import { useEffect, useRef, useState } from 'react'

/**
 * LazyImage — IntersectionObserver-based lazy loading image component.
 * Shows a shimmer placeholder until the image enters the viewport,
 * then loads and fades in the actual image. Memory-efficient: disconnects
 * observer after load.
 */
export default function LazyImage({
  src,
  alt = '',
  style = {},
  className = '',
  onError,
  onClick,
  rootMargin = '200px',
  placeholderHeight = 108,
  ...rest
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const containerRef = useRef(null)
  const observerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback: load immediately if IntersectionObserver not available
      setIsVisible(true)
      return
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observerRef.current?.disconnect()
        }
      },
      { rootMargin, threshold: 0 }
    )

    observerRef.current.observe(containerRef.current)

    return () => {
      observerRef.current?.disconnect()
    }
  }, [rootMargin])

  const handleLoad = () => {
    setIsLoaded(true)
  }

  const handleError = (e) => {
    setHasError(true)
    onError?.(e)
  }

  if (hasError) return null

  const containerStyle = {
    position: 'relative',
    overflow: 'hidden',
    ...style,
  }

  const shimmerStyle = {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%)',
    backgroundSize: '200% 100%',
    animation: isLoaded ? 'none' : 'lazyImageShimmer 1.5s ease-in-out infinite',
    borderRadius: 'inherit',
  }

  return (
    <>
      {!isLoaded && (
        <style>{`
          @keyframes lazyImageShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      )}
      <div ref={containerRef} style={containerStyle} className={className}>
        {!isLoaded && (
          <div style={{
            ...shimmerStyle,
            height: style.height || placeholderHeight,
            background: 'var(--bg-2, #141a34)',
          }}>
            <div style={shimmerStyle} />
          </div>
        )}
        {isVisible && (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            onClick={onClick}
            style={{
              ...style,
              opacity: isLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
            {...rest}
          />
        )}
      </div>
    </>
  )
}
