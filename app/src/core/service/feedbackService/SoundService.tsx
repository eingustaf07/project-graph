import { readFile } from "@tauri-apps/plugin-fs";
import { Settings } from "../Settings";

/**
 * 播放音效的服务
 * 这个音效播放服务是用户自定义的
 */
export namespace SoundService {
  /**
   * 音调变化范围配置（音分）
   * 100音分 = 1个半音
   * 可根据需要调整此值以获得更明显或更微妙的音调变化
   */
  export function getPitchVariationRange() {
    return Settings.soundPitchVariationRange ?? 150; // 默认±150音分（1.5个半音）
  }
  export namespace play {
    // 开始切断
    export function cuttingLineStart() {
      playConfigured("cuttingLineStartSoundFile");
    }

    // 开始连接
    export function connectLineStart() {
      playConfigured("connectLineStartSoundFile");
    }

    // 连接吸附到目标点
    export function connectFindTarget() {
      playConfigured("connectFindTargetSoundFile");
    }

    // 自动保存执行特效
    // 自动备份执行特效

    // 框选增加物体音效

    // 切断特效声音
    export function cuttingLineRelease() {
      playConfigured("cuttingLineReleaseSoundFile");
    }
    // 连接成功

    // 对齐吸附音效
    export function alignAndAttach() {
      playConfigured("alignAndAttachSoundFile");
    }
    // 鼠标进入按钮区域的声音
    export function mouseEnterButton() {
      playConfigured("uiButtonEnterSoundFile");
    }
    export function mouseClickButton() {
      playConfigured("uiButtonClickSoundFile");
    }
    export function mouseClickSwitchButtonOn() {
      playConfigured("uiSwitchButtonOnSoundFile");
    }
    export function mouseClickSwitchButtonOff() {
      playConfigured("uiSwitchButtonOffSoundFile");
    }

    /** ctrl + G 打包 */
    export function packEntityToSectionSoundFile() {
      playConfigured("packEntityToSectionSoundFile");
    }

    /**
     * tab 生成树结构
     */
    export function treeGenerateDeepSoundFile() {
      playConfigured("treeGenerateDeepSoundFile");
    }

    /**
     * enter 广度生长
     */
    export function treeGenerateBroadSoundFile() {
      playConfigured("treeGenerateBroadSoundFile");
    }

    /**
     * 格式化树形结构
     */
    export function treeAdjustSoundFile() {
      playConfigured("treeAdjustSoundFile");
    }

    /**
     * 视图调整
     */
    export function viewAdjustSoundFile() {
      playConfigured("viewAdjustSoundFile");
    }

    /**
     * 物体跳跃
     */
    export function entityJumpSoundFile() {
      playConfigured("entityJumpSoundFile");
    }

    /**
     * 连线、无向边等东西的调整
     */
    export function associationAdjustSoundFile() {
      playConfigured("associationAdjustSoundFile");
    }
  }

  const audioContext = new window.AudioContext({ latencyHint: "interactive" });
  const masterGain = audioContext.createGain();
  masterGain.gain.value = Settings.soundVolume / 100;
  masterGain.connect(audioContext.destination);
  Settings.watch("soundVolume", (volume: number) => {
    // 平滑调整共享增益，同时影响正在播放的音效，避免突然改变振幅产生杂音。
    masterGain.gain.setTargetAtTime(volume / 100, audioContext.currentTime, 0.01);
  });

  export function playSoundByFilePath(filePath: string) {
    loadAndPlaySound(filePath);
  }

  const creationBuffers = new Map<string, AudioBuffer>();

  export function playNodeCreated() {
    return playCreationTone("nodeCreated", 440);
  }

  export function playDoodleCreated() {
    return playCreationTone("doodleCreated", 330);
  }

  export function playObjectsDeleted() {
    return playCreationTone("objectsDeleted", 220);
  }

  function effectEnabled(key: string) {
    return Settings.soundEffectEnabled[key] !== false;
  }

  function playConfigured(key: keyof typeof Settings) {
    void loadAndPlaySound(Settings[key] as string, key);
  }

  async function playCreationTone(key: string, frequency: number) {
    if (!Settings.soundEnabled || Settings.soundVolume === 0 || !effectEnabled(key)) return;
    const requestedAt = performance.now();
    const resume = resumeAudio();
    if (resume) await resume;
    if (!Settings.soundEnabled || !effectEnabled(key) || performance.now() - requestedAt > 150) return;
    let nodeCreatedBuffer = creationBuffers.get(key);
    if (!nodeCreatedBuffer) {
      const duration = 0.16;
      nodeCreatedBuffer = audioContext.createBuffer(
        1,
        Math.ceil(audioContext.sampleRate * duration),
        audioContext.sampleRate,
      );
      const samples = nodeCreatedBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const t = i / audioContext.sampleRate;
        // Gentle attack and release avoid a click; a quiet sine tone needs no file loading/decoding.
        const envelope = Math.sin((Math.PI * i) / (samples.length - 1)) ** 2 * Math.exp(-12 * t);
        samples[i] =
          0.12 * envelope * (Math.sin(2 * Math.PI * frequency * t) + 0.2 * Math.sin(2 * Math.PI * frequency * 1.5 * t));
      }
      creationBuffers.set(key, nodeCreatedBuffer);
    }
    const source = audioContext.createBufferSource();
    source.buffer = nodeCreatedBuffer;
    source.connect(masterGain);
    source.onended = () => source.disconnect();
    source.start(0);
  }

  async function loadAndPlaySound(filePath: string, key = "custom") {
    if (!Settings.soundEnabled || !effectEnabled(key)) {
      return;
    }
    if (filePath.trim() === "") {
      return;
    }

    const requestedAt = performance.now();
    const resume = resumeAudio();
    // 缓存命中且设备正在运行时，不经过异步等待。
    const audioBuffer = pathAudioBufferMap.get(filePath) ?? (await getAudioBufferByFilePath(filePath));
    if (resume) await resume;
    // 读取慢文件或唤醒设备后，不补播已过时的操作反馈。
    if (!Settings.soundEnabled || !effectEnabled(key) || performance.now() - requestedAt > 150) return;
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    // 添加音调随机化 - 根据配置的范围随机调整音调
    // 使用getPitchVariationRange()函数获取配置的变化范围
    const randomDetune = (Math.random() - 0.5) * getPitchVariationRange() * 2; // 范围内随机
    source.detune.value = randomDetune;

    source.connect(masterGain);
    source.onended = () => source.disconnect();
    source.start(0);
  }

  const pathAudioBufferMap = new Map<string, AudioBuffer>();
  const pendingBuffers = new Map<string, Promise<AudioBuffer>>();
  let resuming: Promise<void> | undefined;

  function resumeAudio() {
    if (audioContext.state !== "suspended") return;
    if (!resuming) {
      resuming = audioContext.resume().finally(() => {
        resuming = undefined;
      });
    }
    return resuming;
  }

  function wakeAudio() {
    if (Settings.soundEnabled) void resumeAudio();
  }
  window.addEventListener("pointerdown", wakeAudio, { capture: true });
  window.addEventListener("keydown", wakeAudio, { capture: true });

  async function getAudioBufferByFilePath(filePath: string) {
    // 先从缓存中获取音频数据
    const result = pathAudioBufferMap.get(filePath);
    if (result) {
      return result;
    }

    const pending = pendingBuffers.get(filePath);
    if (pending) return pending;
    const loading = (async () => {
      const bytes = await readFile(filePath);
      const buffer = await audioContext.decodeAudioData(new Uint8Array(bytes).buffer);
      pathAudioBufferMap.set(filePath, buffer);
      return buffer;
    })();
    pendingBuffers.set(filePath, loading);
    try {
      return await loading;
    } finally {
      pendingBuffers.delete(filePath);
    }
  }

  const soundKeys = [
    "cuttingLineStartSoundFile",
    "connectLineStartSoundFile",
    "connectFindTargetSoundFile",
    "cuttingLineReleaseSoundFile",
    "alignAndAttachSoundFile",
    "packEntityToSectionSoundFile",
    "treeGenerateDeepSoundFile",
    "treeGenerateBroadSoundFile",
    "treeAdjustSoundFile",
    "viewAdjustSoundFile",
    "entityJumpSoundFile",
    "associationAdjustSoundFile",
    "uiButtonEnterSoundFile",
    "uiButtonClickSoundFile",
    "uiSwitchButtonOnSoundFile",
    "uiSwitchButtonOffSoundFile",
  ] as const;
  for (const key of soundKeys) {
    Settings.watch(key, (path: string) => {
      if (Settings.soundEnabled && path.trim()) void getAudioBufferByFilePath(path);
    });
  }
  Settings.watch("soundEnabled", (enabled: boolean) => {
    if (enabled) {
      for (const key of soundKeys) {
        const path = Settings[key];
        if (path.trim()) void getAudioBufferByFilePath(path);
      }
    }
  });
}
