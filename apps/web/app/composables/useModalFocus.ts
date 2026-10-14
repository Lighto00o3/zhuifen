import type { Ref } from 'vue'

const FOCUSABLE = '[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled)'

// 弹窗打开期间锁住页面滚动，关闭或组件卸载时恢复原样。
export function useScrollLock(open: Ref<boolean>) {
  let previousOverflow = ''
  let locked = false
  function lock() { if (locked) return; previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; locked = true }
  function unlock() { if (!locked) return; document.body.style.overflow = previousOverflow; locked = false }
  watch(open, value => { if (import.meta.client) value ? lock() : unlock() })
  onUnmounted(unlock)
}

// 自绘弹窗的无障碍行为：打开时聚焦第一个控件，Tab 在弹窗内循环，Esc 关闭，关闭后焦点回到原处。
export function useModalFocus(open: Ref<boolean>, close: () => void) {
  useScrollLock(open)
  let previousFocus: HTMLElement | null = null
  watch(open, async value => {
    if (!import.meta.client) return
    if (value) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      document.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    } else {
      // 等页面去掉 inert 之后再还原焦点，否则 inert 区域内的元素无法获得焦点。
      await nextTick()
      if (!open.value) previousFocus?.focus()
    }
  })
  function keys(event: KeyboardEvent) {
    if (!open.value) return
    if (event.key === 'Escape') { close(); event.preventDefault() }
    if (event.key !== 'Tab') return
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = nodes[0], last = nodes.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  onMounted(() => window.addEventListener('keydown', keys))
  onUnmounted(() => window.removeEventListener('keydown', keys))
}
