// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  volume: 100,
  enabled: true,
  effectEnabled: {} as Record<string, boolean>,
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
  resume: vi.fn(),
  state: "running",
}));

vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: fixture.readFile }));
vi.mock("../Settings", () => ({
  Settings: new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "soundEnabled") return fixture.enabled;
        if (key === "soundVolume") return fixture.volume;
        if (key === "soundEffectEnabled") return fixture.effectEnabled;
        if (key === "soundPitchVariationRange") return 150;
        if (key === "watch")
          return (key: string, callback: (value: any) => void) => {
            if (key === "soundVolume") fixture.listeners.push(callback);
            callback(
              key === "soundVolume" ? fixture.volume : key === "soundEnabled" ? fixture.enabled : fixture.filePath,
            );
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
  fixture.effectEnabled = {};
  fixture.filePath = "sound.mp3";
  fixture.listeners = [];
  fixture.sources = [];
  fixture.state = "running";
  fixture.resume.mockResolvedValue(undefined);
  fixture.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  fixture.decode.mockResolvedValue({ duration: 1 });
  vi.stubGlobal(
    "AudioContext",
    class {
      get state() {
        return fixture.state;
      }
      resume = fixture.resume;
      currentTime = 12;
      sampleRate = 48000;
      createBuffer(_channels: number, length: number) {
        const samples = new Float32Array(length);
        return { getChannelData: () => samples, duration: length / this.sampleRate };
      }
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
  it("plays a cached quiet deletion tone and respects its own switch, master mute and volume", async () => {
    const { SoundService } = await import("./SoundService");
    await SoundService.playObjectsDeleted();
    const buffer = fixture.sources[0].buffer as AudioBuffer;
    expect(buffer.duration).toBeCloseTo(0.16);
    expect(Math.max(...buffer.getChannelData(0).map(Math.abs))).toBeLessThan(0.15);
    expect(fixture.sources[0].connect).toHaveBeenCalledWith(fixture.gain);
    await SoundService.playObjectsDeleted();
    expect(fixture.sources[1].buffer).toBe(buffer);
    fixture.effectEnabled.objectsDeleted = false;
    await SoundService.playObjectsDeleted();
    fixture.effectEnabled.objectsDeleted = true;
    fixture.enabled = false;
    await SoundService.playObjectsDeleted();
    fixture.enabled = true;
    fixture.volume = 0;
    await SoundService.playObjectsDeleted();
    expect(fixture.sources).toHaveLength(2);
  });
  it("independently mutes effects even when they share a file, and mutes built-in tones", async () => {
    const { SoundService } = await import("./SoundService");
    await vi.waitFor(() => expect(fixture.decode).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.effectEnabled.uiButtonClickSoundFile = false;
    SoundService.play.mouseClickButton();
    expect(fixture.sources).toHaveLength(0);
    SoundService.play.mouseEnterButton();
    expect(fixture.sources).toHaveLength(1);
    fixture.effectEnabled.nodeCreated = false;
    await SoundService.playNodeCreated();
    expect(fixture.sources).toHaveLength(1);
    await SoundService.playDoodleCreated();
    const buffer = fixture.sources[1].buffer as AudioBuffer;
    expect(buffer.duration).toBeCloseTo(0.16);
    await SoundService.playDoodleCreated();
    expect(fixture.sources[2].buffer).toBe(buffer);
    fixture.effectEnabled.doodleCreated = false;
    await SoundService.playDoodleCreated();
    expect(fixture.sources).toHaveLength(3);
    fixture.effectEnabled.nodeCreated = true;
    await SoundService.playNodeCreated();
    expect(fixture.sources).toHaveLength(4);
  });
  it("plays a short gentle cached creation tone through the volume gain and respects mute", async () => {
    const { SoundService } = await import("./SoundService");
    await SoundService.playNodeCreated();
    const buffer = fixture.sources[0].buffer as AudioBuffer;
    expect(buffer.duration).toBeCloseTo(0.16);
    const samples = buffer.getChannelData(0);
    expect(samples[0]).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.000001);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.15);
    expect(fixture.sources[0].connect).toHaveBeenCalledWith(fixture.gain);
    await SoundService.playNodeCreated();
    expect(fixture.sources[1].buffer).toBe(buffer);
    fixture.enabled = false;
    await SoundService.playNodeCreated();
    fixture.enabled = true;
    fixture.volume = 0;
    await SoundService.playNodeCreated();
    expect(fixture.sources).toHaveLength(2);
  });
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
    fixture.enabled = false;
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

  it("preloads shared files once and starts warm effects synchronously", async () => {
    const { SoundService } = await import("./SoundService");
    await vi.waitFor(() => expect(fixture.decode).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.readFile).toHaveBeenCalledTimes(1);
    expect(fixture.sources).toHaveLength(0);
    SoundService.play.mouseClickButton();
    expect(fixture.sources).toHaveLength(1);
    expect(fixture.sources[0].start).toHaveBeenCalledWith(0);
  });

  it("does not replay stale clicks after slow decoding, but caches the result", async () => {
    let complete!: (buffer: object) => void;
    fixture.decode.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const { SoundService } = await import("./SoundService");
    SoundService.play.mouseClickButton();
    SoundService.play.mouseClickButton();
    await vi.waitFor(() => expect(fixture.decode).toHaveBeenCalledTimes(1));
    clock.mockReturnValue(200);
    complete({ duration: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.sources).toHaveLength(0);
    SoundService.play.mouseClickButton();
    expect(fixture.sources).toHaveLength(1);
    clock.mockRestore();
  });

  it("resumes suspended audio before starting an effect", async () => {
    fixture.state = "suspended";
    let complete!: () => void;
    fixture.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const { SoundService } = await import("./SoundService");
    SoundService.play.mouseClickButton();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.resume).toHaveBeenCalledTimes(1);
    expect(fixture.sources).toHaveLength(0);
    complete();
    await vi.waitFor(() => expect(fixture.sources).toHaveLength(1));
  });
});
