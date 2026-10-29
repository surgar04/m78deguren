/** 统一滚动入口，尊重系统减少动态效果偏好；各组件不再各自硬编码平滑滚动。 */
export function scrollToSection(id: string, block: ScrollLogicalPosition = 'start') {
  document.getElementById(id)?.scrollIntoView({
    block,
    behavior:
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.querySelector('.home-layout[data-motion="reduce"]')
        ? 'instant'
        : 'smooth',
  });
}
