// Mock of @tauri-apps/api/core for Jest (the real module needs a Tauri webview).
class Channel {
  constructor() {
    this.onmessage = null
  }
}

module.exports = {
  invoke: jest.fn(),
  Channel,
}
