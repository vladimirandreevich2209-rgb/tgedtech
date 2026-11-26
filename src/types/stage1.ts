export type AppMode = 'diagnostic' | 'stage1';

export type SessionTime = 'morning' | 'evening';

export type TrainingMode = 'full' | 'focus';

export type WorkingKey = 1 | 2 | 3 | 4;

export type Stage1StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type KucherPhaseId = 'A' | 'B' | 'C';

export type AttemptBadgeKind = 'flap' | 'noise' | 'neutral';

export interface AttemptAnalysis {
  badge: AttemptBadgeKind;
  label: string;
  meanZcr: number;
  maxNoiseStreakMs: number;
  detectedClosureMs: number | null;
}

export interface SavedAttemptRecord {
  id: string;
  slotIndex: 0 | 1 | 2;
  wavBlob: Blob;
  durationSec: number;
  createdAt: number;
  analysis: AttemptAnalysis;
}

export interface DayHistoryEntry {
  day: 1 | 2 | 3 | 4 | 5;
  sessionTime: SessionTime;
  workingKey: WorkingKey | null;
  chinWasSoft: boolean;
  completedAt: number;
}

export interface Stage1Progress {
  day: 1 | 2 | 3 | 4 | 5;
  sessionTime: SessionTime;
  trainingMode: TrainingMode;
  workingKey: WorkingKey | null;
  chinWasSoft: boolean;
  completedSessions: number;
  history: DayHistoryEntry[];
}

export interface FourMicroBlocks {
  tongue: string;
  teethAndJaw: string;
  breathAndSound: string;
  chinControl: string;
}

export interface FocusLines {
  tongue: string;
  jawAndChin: string;
  action: string;
}

export interface KucherPhaseConfig {
  id: KucherPhaseId;
  title: string;
  shortLabel: string;
  durationSec: number;
  timeWindowLabel: string;
  blocks: FourMicroBlocks;
  focusLines: FocusLines;
}

export interface StepSubPhase {
  id: string;
  tabLabel: string;
  timeWindowLabel: string;
  startRatio: number;
  targetCue: string;
  rules: [string, string];
  kucherPhaseId?: KucherPhaseId;
}

export interface StepTroubleshootTip {
  symptom: string;
  fix: string;
}

export interface Stage1StepConfig {
  step: Stage1StepNumber;
  title: string;
  shortTitle: string;
  timeRangeLabel: string;
  durationSec: number;
  keyNumber?: WorkingKey;
  recommendedBpm?: 60 | 90 | 120;
  blocks: FourMicroBlocks;
  focusLines: FocusLines;
  sprintAction?: string;
  kucherPhases?: KucherPhaseConfig[];
  subPhases?: StepSubPhase[];
  troubleshootTips?: StepTroubleshootTip[];
}
