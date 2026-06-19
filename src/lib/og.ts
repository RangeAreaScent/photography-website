import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

export async function ogImageUrl(
  image: ImageMetadata,
  site: URL | undefined,
): Promise<string | undefined> {
  if (!site) return undefined;
  const og = await getImage({
    src: image,
    width: 1200,
    height: 630,
    format: 'jpeg',
    quality: 82,
    fit: 'cover',
  });
  return new URL(og.src, site).toString();
}
