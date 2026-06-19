import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://d612.space',
  integrations: [sitemap()],
  image: {
    responsiveStyles: true,
  },
});
