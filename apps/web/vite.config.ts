import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { brand } from '@corodev/design-tokens/brand';

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'corodev-brand-metadata',
    transformIndexHtml(html) {
      const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
      return html.replace(/<title>.*?<\/title>/, `<title>${escape(`${brand.team} — ${brand.name}`)}</title>`)
        .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escape(brand.description)}" />`);
    },
  }],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    css: false,
  },
});
