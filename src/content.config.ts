import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const works = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/works' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      year: z.number(),
      order: z.number(),
      intro: z.string().optional(),
      photos: z
        .array(
          z.object({
            src: image(),
            caption: z.string().optional(),
          }),
        )
        .default([]),
    }),
});

const monthly = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/monthly' }),
  schema: ({ image }) =>
    z.object({
      date: z.coerce.date(),
      photo: image(),
      caption: z.string().optional(),
    }),
});

export const collections = { works, monthly };
