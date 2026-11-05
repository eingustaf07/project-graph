const noOp = () => undefined;

export const SoundService = {
  getPitchVariationRange: () => 0,
  play: {
    cuttingLineStart: noOp,
    connectLineStart: noOp,
    connectFindTarget: noOp,
    cuttingLineRelease: noOp,
    alignAndAttach: noOp,
    mouseEnterButton: noOp,
    mouseClickButton: noOp,
    mouseClickSwitchButtonOn: noOp,
    mouseClickSwitchButtonOff: noOp,
    packEntityToSectionSoundFile: noOp,
    treeGenerateDeepSoundFile: noOp,
    treeGenerateBroadSoundFile: noOp,
    treeAdjustSoundFile: noOp,
    viewAdjustSoundFile: noOp,
    entityJumpSoundFile: noOp,
    associationAdjustSoundFile: noOp,
  },
  playSoundByFilePath: noOp,
  playNodeCreated: () => Promise.resolve(),
  playDoodleCreated: () => Promise.resolve(),
  playObjectsDeleted: () => Promise.resolve(),
} satisfies typeof import("@/core/service/feedbackService/SoundService").SoundService;
