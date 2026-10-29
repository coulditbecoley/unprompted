export function BrandHighlight({ text, brand }: { text: string; brand?: string }) {
  if (!brand) return text;
  const literal = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(?<![\\p{L}\\p{N}_])(${literal})(?![\\p{L}\\p{N}_])`, "giu"));
  return parts.map((part, i) => i % 2 ? <mark className="q-brand-highlight" key={i}>{part}</mark> : part);
}
