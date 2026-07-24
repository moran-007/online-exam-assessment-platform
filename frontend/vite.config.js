import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';
const previewPort = Number(process.env.E2E_FRONTEND_PORT || 4173);
const apiProxy = {
  '/api': {
    target: apiProxyTarget,
    changeOrigin: true,
  },
};

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: command === 'serve' ? 'src/components.d.ts' : false,
    }),
  ],
  build: {
    manifest: true,
    // Heavy third-party chunks are budgeted separately; application chunks stay below 500 KB.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // CSS is extracted independently by Vite. Assigning it to a JavaScript
          // vendor chunk makes service styles pull the whole library into entry.
          if (/\.css(?:$|\?)/.test(id)) return undefined;
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/echarts/') || id.includes('\\echarts\\')) return 'vendor-echarts';
          if (id.includes('/exceljs/') || id.includes('\\exceljs\\')) return 'vendor-exceljs';
          const codeMirrorLanguage = id.match(/@codemirror[/\\]lang-([^/\\]+)/);
          if (codeMirrorLanguage) return `codemirror-language-${codeMirrorLanguage[1]}`;
          if (id.includes('/@codemirror/') || id.includes('\\@codemirror\\') || /[/\\]codemirror[/\\]/.test(id)) {
            return 'vendor-codemirror';
          }
          if (id.includes('/katex/') || id.includes('\\katex\\')) return 'vendor-katex';
          if (id.includes('/element-plus/') || id.includes('\\element-plus\\') || id.includes('/@element-plus/')) {
            return 'vendor-element-plus';
          }
          if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/@vue/')) return 'vendor-vue';
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: previewPort,
    strictPort: true,
    proxy: apiProxy,
  },
}));
