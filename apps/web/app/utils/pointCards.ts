import type { ScoreKind } from '@zhuifen/shared'

export const CARD_SUITS: Record<ScoreKind, string> = { foul: '♠', normal: '♠', xiaojin: '♥', dajin: '♣', golden9: '♦' }
// Visual denominations only: no hand inventory or change-making yet.
export function pointCards(points: number): { rank: string; value: number }[] {
  const cards: { rank: string; value: number }[] = []
  if (!Number.isInteger(points) || points < 1 || points > 100) return cards
  while (points > 0) {
    const value = points >= 15 ? 15 : Math.min(points, 10)
    cards.push({ rank: value === 15 ? ['J', 'Q', 'K'][cards.length % 3]! : value === 1 ? 'A' : String(value), value })
    points -= value
  }
  return cards
}
