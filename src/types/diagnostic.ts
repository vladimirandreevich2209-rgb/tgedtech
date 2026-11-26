export type DiagnosticStep = 1 | 2 | 3 | 4 | 5 | 6;

export type FrenulumStatus = 'normal' | 'restricted' | null;

export type NeckVibration = 'throat' | 'front' | 'unsure' | null;

export interface DiagnosticState {
  step: DiagnosticStep;
  frenulumStatus: FrenulumStatus;
  neckVibration: NeckVibration;
  recordedAudioUrl: string | null;
  recordedBuffer: AudioBuffer | null;
  customReferenceBuffer: AudioBuffer | null;
  customReferenceName: string | null;
  earScore: number;
  remindLaterClicked: boolean;
}

export const INITIAL_DIAGNOSTIC_STATE: DiagnosticState = {
  step: 1,
  frenulumStatus: null,
  neckVibration: null,
  recordedAudioUrl: null,
  recordedBuffer: null,
  customReferenceBuffer: null,
  customReferenceName: null,
  earScore: 0,
  remindLaterClicked: false,
};
