export type ColorTheme = 'light' | 'dark'
export function useColorTheme() {
  const theme = useState<ColorTheme>('color-theme', () => 'light')
  const preference = useState<ColorTheme | null>('color-preference', () => null)
  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    preference.value = theme.value
    try { localStorage.setItem('zhuifen:theme', theme.value) } catch { /* The current session still keeps its choice. */ }
  }
  return { theme, preference, toggleTheme }
}
