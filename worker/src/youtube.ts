const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

export function getYoutubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !youtubeHosts.has(url.hostname.toLowerCase())) return null
    let videoId = ''
    if (url.hostname.toLowerCase() === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] ?? ''
    else if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? ''
    else {
      const [kind, id] = url.pathname.split('/').filter(Boolean)
      if (kind === 'shorts' || kind === 'embed' || kind === 'live') videoId = id ?? ''
    }
    return youtubeIdPattern.test(videoId) ? videoId : null
  } catch {
    return null
  }
}

export function canonicalYoutubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`
}
