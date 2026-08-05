// Accent palette for monthly entries — one color per month, cycling every 7.
// Applied to: the brand box border (reflects the month being viewed, or the
// latest month elsewhere) and the monthly sub-nav dots (one per entry).
export const MONTH_COLORS = [
  '#BBC5AB', // sage
  '#F09E7D', // peach
  '#00784F', // basil
  '#00859C', // proud
  '#f3701e', // orange
  '#F9B95C', // pêche
  '#6398A9', // lagune
];

export function monthColor(index: number): string {
  const n = MONTH_COLORS.length;
  return MONTH_COLORS[((index % n) + n) % n];
}
