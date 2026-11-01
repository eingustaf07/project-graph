// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  volume: 100,
  enabled: true,
  filePath: "sound.mp3",
  listeners: [] as ((volume: number) => void)[],
  readFile: vi.fn(),
  gain: { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn() },
  sources: [] as {
    buffer: unknown;
    detune: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }[],
  destination: {},
  decode: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: fixture.readFile }));
vi.mock("../Settings", () => ({
  Settings: new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "soundEnabled") return fixture.enabled;
        if (key === "soundVolume") return fixture.volume;
        if (key === "soundPitchVariationRange") return 150;
        if (key === "watch")
          return (_key: string, callback: (volume: number) => void) => {
            fixture.listeners.push(callback);
            callback(fixture.volume);
            return () => {};
          };
        return fixture.filePath;
      },
    },
  ),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.volume = 100;
  fixture.enabled = true;
  fixture.filePath = "sound.mp3";
  fixture.listeners = [];
  fixture.sources = [];
  fixture.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  fixture.decode.mockResolvedValue({ duration: 1 });
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 12;
      destination = fixture.destination;
      createGain = () => fixture.gain;
      decodeAudioData = fixture.decode;
      createBufferSource() {
        const source = { buffer: null, detune: { value: 0 }, connect: vi.fn(), start: vi.fn() };
        fixture.sources.push(source);
        return source;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("PG sound effects volume", () => {
  it("preserves original loudness by default and sends every effect through the shared gain", async () => {
    const { SoundService } = await import("./SoundService");
    expect(fixture.gain.gain.value).toBe(1);
    expect(fixture.gain.connect).toHaveBeenCalledWith(fixture.destination);
    for (const play of Object.values(SoundService.play)) play();
    SoundService.playSoundByFilePath("custom.mp3");
    const expectedCount = Object.keys(SoundService.play).length + 1;
    await vi.waitFor(() => expect(fixture.sources).toHaveLength(expectedCount));
    for (const source of fixture.sources) {
      expect(source.connect).toHaveBeenCalledWith(fixture.gain);
      expect(source.start).toHaveBeenCalledWith(0);
    }
  });

  it("loads saved volume and updates playing effects without restarting or recreating sources", async () => {
    fixture.volume = 35;
    const { SoundService } = await import("./SoundService");
    expect(fixture.gain.gain.value).toBe(0.35);
    SoundService.play.mouseClickButton();
    await vi.waitFor(() => expect(fixture.sources).toHaveLength(1));
    for (const volume of [20, 0, 100]) {
      fixture.listeners.forEach((callback) => callback(volume));
      expect(fixture.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(volume / 100, 12, 0.01);
    }
    expect(fixture.sources).toHaveLength(1);
    expect(fixture.sources[0].start).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing sound switch and empty-file behavior", async () => {
    const { SoundService } = await import("./SoundService");
    fixture.enabled = false;
    SoundService.play.mouseClickButton();
    fixture.enabled = true;
    fixture.filePath = "   ";
    SoundService.play.mouseClickButton();
    await Promise.resolve();
    expect(fixture.readFile).not.toHaveBeenCalled();
    expect(fixture.sources).toHaveLength(0);
  });
});
