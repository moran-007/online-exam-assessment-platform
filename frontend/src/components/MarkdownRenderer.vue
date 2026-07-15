<template>
  <!-- MarkdownIt runs with raw HTML disabled; URLs and generated tags are sanitized below. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div ref="root" class="markdown-body" v-html="html"></div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';
import { getPublicQuestionAssetContent, getQuestionAssetContent } from '../features/questions/api';

const props = defineProps({
  source: {
    type: String,
    default: '',
  },
  publicQuestionId: { type: String, default: '' },
  assetAccessToken: { type: String, default: '' },
});

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    if (['math', 'latex', 'tex'].includes(String(language || '').toLowerCase())) {
      return `<div class="math-block">${renderMathText(code, true)}</div>`;
    }
    if (['chem', 'chemical', 'chemistry'].includes(String(language || '').toLowerCase())) {
      return `<div class="chem-block">${renderChemistryText(code)}</div>`;
    }
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

installMathAndChemRules(md);

md.validateLink = (url) => isSafeLink(url);
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (!isSafeLink(href)) return '';
  if (isLocalAsset(href)) {
    token.attrSet('href', '#');
    token.attrSet('data-asset-url', href);
    token.attrSet('data-asset-download', 'true');
    return defaultLinkOpen(tokens, idx, options, env, self);
  }
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
  const image = normalizeImageLayout(src);
  if (!image) {
    return defaultImage(tokens, idx, options, env, self);
  }
  const alt = md.utils.escapeHtml(token.content || token.attrGet('alt') || '图片');
  const title = token.attrGet('title');
  const caption = title ? `<figcaption>${md.utils.escapeHtml(title)}</figcaption>` : '';
  return [
    `<figure class="markdown-image markdown-image-${image.align}" style="--markdown-image-width:${image.width}%">`,
    `<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-asset-url="${md.utils.escapeHtml(image.src)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`,
    caption,
    '</figure>',
  ].join('');
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

function isLocalAsset(value) {
  const url = parseUrl(value);
  return Boolean(url && url.origin === baseOrigin() && url.pathname.startsWith('/uploads/question-assets/'));
}

function normalizeImageLayout(value) {
  const url = parseUrl(value);
  if (!url) return null;
  const alignValue = String(url.searchParams.get('align') || url.searchParams.get('layout') || 'center').toLowerCase();
  const align = ['left', 'center', 'right'].includes(alignValue) ? alignValue : 'center';
  const width = clampNumber(Number(url.searchParams.get('w') || url.searchParams.get('width') || 100), 20, 100);
  return {
    align,
    width,
    src: `${url.pathname}${url.search}${url.hash}`,
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function installMathAndChemRules(parser) {
  parser.inline.ruler.before('escape', 'math_paren_inline', mathParenInlineRule);
  parser.inline.ruler.before('emphasis', 'math_dollar_inline', mathDollarInlineRule);
  parser.inline.ruler.before('text', 'chem_inline', chemInlineRule);
  parser.block.ruler.before('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  parser.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${renderMathText(tokens[idx].content, false)}</span>`;
  parser.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderMathText(tokens[idx].content, true)}</div>`;
  parser.renderer.rules.chem_inline = (tokens, idx) => `<span class="chem-formula">${renderChemistryText(tokens[idx].content)}</span>`;
}

function mathDollarInlineRule(state, silent) {
  const start = state.pos;
  const source = state.src;
  if (source.charCodeAt(start) !== 0x24 || source.charCodeAt(start + 1) === 0x24) return false;
  if (start > 0 && source.charCodeAt(start - 1) === 0x5c) return false;

  let end = start + 1;
  while ((end = source.indexOf('$', end)) !== -1) {
    if (source.charCodeAt(end - 1) === 0x5c) {
      end += 1;
      continue;
    }
    if (end === start + 1) return false;
    if (!silent) {
      const token = state.push('math_inline', 'span', 0);
      token.content = source.slice(start + 1, end).trim();
      token.markup = '$';
    }
    state.pos = end + 1;
    return true;
  }

  return false;
}

function mathParenInlineRule(state, silent) {
  const start = state.pos;
  const source = state.src;
  if (source.slice(start, start + 2) !== '\\(') return false;
  const end = source.indexOf('\\)', start + 2);
  if (end === -1 || end === start + 2) return false;
  if (!silent) {
    const token = state.push('math_inline', 'span', 0);
    token.content = source.slice(start + 2, end).trim();
    token.markup = '\\(';
  }
  state.pos = end + 2;
  return true;
}

function chemInlineRule(state, silent) {
  const start = state.pos;
  const source = state.src;
  if (source.slice(start, start + 6) !== '@chem{') return false;

  let depth = 1;
  let end = start + 6;
  while (end < source.length) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) break;
    end += 1;
  }
  if (depth !== 0 || end === start + 6) return false;

  if (!silent) {
    const token = state.push('chem_inline', 'span', 0);
    token.content = source.slice(start + 6, end).trim();
    token.markup = '@chem';
  }
  state.pos = end + 1;
  return true;
}

function mathBlockRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const marker = state.src.slice(start, max).trim();
  const openMarker = marker.startsWith('$$') ? '$$' : marker.startsWith('\\[') ? '\\[' : '';
  const closeMarker = openMarker === '$$' ? '$$' : openMarker === '\\[' ? '\\]' : '';
  if (!closeMarker) return false;

  if (silent) return true;

  let nextLine = startLine;
  const lines = [];
  const firstContent = marker.slice(openMarker.length);
  const sameLineCloseIndex = firstContent.indexOf(closeMarker);
  if (sameLineCloseIndex >= 0) {
    const inlineContent = firstContent.slice(0, sameLineCloseIndex).trim();
    if (inlineContent) lines.push(inlineContent);
    state.line = startLine + 1;
    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.content = lines.join('\n').trim();
    token.map = [startLine, state.line];
    token.markup = openMarker;
    return true;
  }
  if (firstContent.trim()) lines.push(firstContent.trim());
  while (nextLine + 1 < endLine) {
    nextLine += 1;
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    const closeIndex = line.indexOf(closeMarker);
    if (closeIndex >= 0) {
      if (line.slice(0, closeIndex).trim()) lines.push(line.slice(0, closeIndex).trim());
      break;
    }
    lines.push(line);
  }

  state.line = Math.min(nextLine + 1, endLine);
  const token = state.push('math_block', 'div', 0);
  token.block = true;
  token.content = lines.join('\n').trim();
  token.map = [startLine, state.line];
  token.markup = openMarker;
  return true;
}

function renderChemistryText(value) {
  const source = String(value || '')
    .replace(/<->/g, '⇌')
    .replace(/->/g, '→')
    .replace(/=>/g, '→');
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (/\d/.test(char)) {
      let digits = char;
      while (/\d/.test(source[index + 1] || '')) {
        index += 1;
        digits += source[index];
      }
      result += `<sub>${md.utils.escapeHtml(digits)}</sub>`;
      continue;
    }

    if (char === '^') {
      const parsed = readSuperscript(source, index + 1);
      result += `<sup>${md.utils.escapeHtml(parsed.text)}</sup>`;
      index = parsed.end;
      continue;
    }

    if ((char === '+' || char === '-') && isChargePosition(source, index)) {
      result += `<sup>${md.utils.escapeHtml(char)}</sup>`;
      continue;
    }

    result += md.utils.escapeHtml(char);
  }
  return result;
}

function renderMathText(value, displayMode) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return md.utils.escapeHtml(source);
  }
}

function readSuperscript(source, start) {
  if (source[start] === '{') {
    const end = source.indexOf('}', start + 1);
    if (end >= 0) return { text: source.slice(start + 1, end), end };
  }
  let end = start;
  while (end < source.length && /[0-9+-]/.test(source[end])) end += 1;
  return { text: source.slice(start, end) || '^', end: Math.max(start, end) - 1 };
}

function isChargePosition(source, index) {
  const prev = source[index - 1] || '';
  const next = source[index + 1] || '';
  return /[A-Za-z0-9)\]]/.test(prev) && (!next || /[\s,.;，。；、)]/.test(next));
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

const objectUrls = new Set();

function assetFilename(value) {
  const url = parseUrl(value);
  if (!url || !url.pathname.startsWith('/uploads/question-assets/')) return '';
  return decodeURIComponent(url.pathname.slice('/uploads/question-assets/'.length));
}

async function loadAsset(value) {
  const filename = assetFilename(value);
  if (!filename) return null;
  const blob = props.publicQuestionId && props.assetAccessToken
    ? await getPublicQuestionAssetContent(props.publicQuestionId, filename, props.assetAccessToken)
    : await getQuestionAssetContent(filename);
  return { blob };
}

function releaseObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

async function hydrateImages() {
  await nextTick();
  releaseObjectUrls();
  const images = [...(root.value?.querySelectorAll('img[data-asset-url]') ?? [])];
  await Promise.all(images.map(async (image) => {
    try {
      const result = await loadAsset(image.getAttribute('data-asset-url') || '');
      if (!result) return;
      const objectUrl = URL.createObjectURL(result.blob);
      objectUrls.add(objectUrl);
      image.setAttribute('src', objectUrl);
    } catch {
      image.setAttribute('alt', `${image.getAttribute('alt') || '图片'}（无权访问或已失效）`);
    }
  }));
}

async function handleAssetDownload(event) {
  const link = event.target?.closest?.('a[data-asset-url]');
  if (!link || !root.value?.contains(link)) return;
  event.preventDefault();
  try {
    const logicalUrl = link.getAttribute('data-asset-url') || '';
    const result = await loadAsset(logicalUrl);
    if (!result) return;
    const objectUrl = URL.createObjectURL(result.blob);
    const download = document.createElement('a');
    download.href = objectUrl;
    download.download = assetFilename(logicalUrl) || '附件';
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    link.setAttribute('title', '附件无权访问或链接已失效');
  }
}

onMounted(() => {
  root.value?.addEventListener('click', handleCopy);
  root.value?.addEventListener('click', handleAssetDownload);
  void hydrateImages();
});

watch(
  () => [props.source, props.publicQuestionId, props.assetAccessToken],
  () => void hydrateImages(),
  { flush: 'post' },
);

onBeforeUnmount(() => {
  root.value?.removeEventListener('click', handleCopy);
  root.value?.removeEventListener('click', handleAssetDownload);
  releaseObjectUrls();
});
</script>
