import { describe, expect, it } from 'vitest'
import { canonicalYoutubeUrl, getYoutubeVideoId } from '../src/youtube'

describe('YouTube URL validation', () => {
  it.each([
    'https://youtu.be/I96Mwbm7Tp0',
    'https://www.youtube.com/watch?v=I96Mwbm7Tp0&si=test',
    'https://youtube.com/shorts/I96Mwbm7Tp0',
    'https://www.youtube.com/embed/I96Mwbm7Tp0',
  ])('extracts the same video ID from %s', (url) => {
    expect(getYoutubeVideoId(url)).toBe('I96Mwbm7Tp0')
  })

  it('rejects non-YouTube hosts and malformed IDs', () => {
    expect(getYoutubeVideoId('https://example.com/watch?v=I96Mwbm7Tp0')).toBeNull()
    expect(getYoutubeVideoId('https://youtu.be/too-short')).toBeNull()
  })

  it('builds one canonical URL', () => {
    expect(canonicalYoutubeUrl('I96Mwbm7Tp0')).toBe('https://www.youtube.com/watch?v=I96Mwbm7Tp0')
  })
})
