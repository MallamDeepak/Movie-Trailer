import { useState } from 'react';

export default function SafeImage({ src, alt, className, fallback }) {
  const [failed, setFailed] = useState(false);

  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  const shouldProxy =
    typeof src === 'string' && src.startsWith('http') && !src.includes('/api/image-proxy?url=');
  const resolvedSrc = shouldProxy ? `${apiBase}/image-proxy?url=${encodeURIComponent(src)}` : src;

  if (!resolvedSrc || failed) {
    return fallback || null;
  }

  return <img src={resolvedSrc} alt={alt} className={className} onError={() => setFailed(true)} />;
}
