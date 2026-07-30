/**
 * SVG → PNG, for the shareable usage card.
 *
 * Lives beside the dialog rather than in `lib/history/` because it is entirely
 * DOM-bound (Image, canvas) while everything under `lib/history/` is pure and
 * runs in a plain Node test. The card itself is built by `report.ts`; this only
 * rasterises it.
 *
 * PNG matters because the target is a chat or a social post: those accept a
 * pasted bitmap and not an SVG. The card references no external font or asset,
 * which is what makes drawing it onto a canvas legal — a canvas that has loaded
 * cross-origin content is tainted and `toBlob` on it throws.
 */

/** The only URL form both `<img>` and the app's CSP (`img-src data:`) accept. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Rasterise at `scale`× so the card stays sharp when a chat client scales it up.
 * Resolves to `null` on any failure (image decode, missing 2D context, a
 * `toBlob` that hands back nothing) — the caller offers the SVG instead rather
 * than pretending the save worked.
 */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 2
): Promise<Uint8Array | null> {
  const image = await loadImage(svgDataUrl(svg))
  if (!image) return null

  const canvas = document.createElement("canvas")
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png")
  })
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
