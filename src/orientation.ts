export function isWatchMode(): boolean {
  return new URLSearchParams(window.location.search).get('kell') === '1'
}

export function watchUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set('kell', '1')
  url.hash = ''
  return url.toString()
}

export async function lockPortrait(): Promise<void> {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (type: 'portrait' | 'portrait-primary') => Promise<void>
    }
    await orientation.lock?.('portrait')
  } catch {
    /* Lukustus töötab tavaliselt ainult paigaldatud PWA / Android Chrome korral. */
  }
}
