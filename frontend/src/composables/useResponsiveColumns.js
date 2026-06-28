import { computed, onMounted, onUnmounted, ref } from 'vue';

const viewportWidth = ref(typeof window === 'undefined' ? 1920 : window.innerWidth);
let listenerCount = 0;

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth;
}

export function useResponsiveColumns() {
  onMounted(() => {
    updateViewportWidth();
    if (listenerCount === 0) {
      window.addEventListener('resize', updateViewportWidth);
    }
    listenerCount += 1;
  });

  onUnmounted(() => {
    listenerCount = Math.max(0, listenerCount - 1);
    if (listenerCount === 0) {
      window.removeEventListener('resize', updateViewportWidth);
    }
  });

  return {
    viewportWidth,
    showMediumColumns: computed(() => viewportWidth.value >= 1380),
    showLowColumns: computed(() => viewportWidth.value >= 1900),
  };
}
