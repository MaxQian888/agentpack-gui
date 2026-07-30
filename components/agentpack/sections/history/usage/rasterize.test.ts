import { svgDataUrl, svgToPng } from "./rasterize"

describe("svgDataUrl", () => {
  it("percent-encodes the markup so it survives as a URL", () => {
    const url = svgDataUrl("<svg><text>a b&c</text></svg>")
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true)
    expect(url).toContain("%3Csvg%3E")
    // A raw '#' would truncate the URL at the fragment.
    expect(svgDataUrl("<svg fill='#fff'/>")).toContain("%23fff")
  })
})

/**
 * jsdom has no canvas backend, so the DOM seams are stubbed. What's under test
 * is the failure handling: every step that can hand back nothing must produce
 * `null` rather than a corrupt file.
 */
describe("svgToPng", () => {
  const originalImage = global.Image

  /** Stub `Image` so setting `src` fires load or error synchronously. */
  function stubImage(succeeds: boolean) {
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => (succeeds ? this.onload?.() : this.onerror?.()))
      }
    }
    global.Image = FakeImage as unknown as typeof Image
  }

  function stubCanvas(ctx: unknown, blob: Blob | null) {
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as CanvasRenderingContext2D)
    jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(blob))
  }

  afterEach(() => {
    global.Image = originalImage
    jest.restoreAllMocks()
  })

  it("returns null when the SVG fails to decode", async () => {
    stubImage(false)
    expect(await svgToPng("<svg/>", 10, 10)).toBeNull()
  })

  it("returns null when there is no 2D context", async () => {
    stubImage(true)
    stubCanvas(null, null)
    expect(await svgToPng("<svg/>", 10, 10)).toBeNull()
  })

  it("returns null when the canvas yields no blob", async () => {
    stubImage(true)
    stubCanvas({ drawImage: jest.fn() }, null)
    expect(await svgToPng("<svg/>", 10, 10)).toBeNull()
  })

  it("rasterises at 2x so the card stays sharp when scaled up", async () => {
    stubImage(true)
    const drawImage = jest.fn()
    // jsdom's Blob has no `arrayBuffer()`; both WebViews Tauri ships on do.
    const blob = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Blob
    stubCanvas({ drawImage }, blob)
    const bytes = await svgToPng("<svg/>", 100, 50)
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 200, 100)
  })
})
