<template>
  <div ref="root" class="markdown-body" v-html="html"></div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

const props = defineProps({
  source: {
    type: String,
    default: '',
  },
});

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    const highlighted =
      language && hljs.getLanguage(language)
        ? hljs.highlight(code, { language }).value
        : md.utils.escapeHtml(code);
    if (language && hljs.getLanguage(language)) {
      return `<div class="code-block"><button class="code-copy" type="button">复制</button><pre class="hljs"><code>${highlighted}</code></pre></div>`;
    }
    return `<div class="code-block"><button class="code-copy" type="button">复制</button><pre class="hljs"><code>${highlighted}</code></pre></div>`;
  },
});

const root = ref(null);
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
const defaultImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.validateLink = (url) => isSafeLink(url);
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (!isSafeLink(href)) return '';
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  if (!isSafeImage(src)) {
    const alt = token.content || token.attrGet('alt') || '图片';
    return `<span class="markdown-blocked-image">已拦截图片：${md.utils.escapeHtml(alt)}</span>`;
  }
  token.attrSet('loading', 'lazy');
  token.attrSet('referrerpolicy', 'no-referrer');
  return defaultImage(tokens, idx, options, env, self);
};

const html = computed(() => md.render(props.source || ''));

function baseOrigin() {
  return globalThis.location?.origin || 'http://localhost';
}

function parseUrl(value) {
  try {
    return new URL(String(value || '').trim(), baseOrigin());
  } catch {
    return null;
  }
}

function isSafeLink(value) {
  const url = parseUrl(value);
  if (!url) return false;
  if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return true;
  return url.origin === baseOrigin() && url.pathname.startsWith('/uploads/');
}

function isSafeImage(value) {
  const url = parseUrl(value);
  if (!url) return false;
  return url.origin === baseOrigin() && url.pathname.startsWith('/uploads/');
}

function handleCopy(event) {
  const button = event.target?.closest?.('.code-copy');
  if (!button || !root.value?.contains(button)) return;
  const code = button.parentElement?.querySelector('code')?.innerText ?? '';
  if (!code) return;
  navigator.clipboard?.writeText(code);
  const original = button.textContent;
  button.textContent = '已复制';
  window.setTimeout(() => {
    button.textContent = original || '复制';
  }, 1200);
}

onMounted(() => {
  root.value?.addEventListener('click', handleCopy);
});

onBeforeUnmount(() => {
  root.value?.removeEventListener('click', handleCopy);
});
</script>
