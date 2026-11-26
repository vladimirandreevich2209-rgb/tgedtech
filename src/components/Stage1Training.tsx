import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  Info,
  LifeBuoy,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Star,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import coachAvatarImg from '@/coach-avatar.png';
import { STAGE1_STEPS } from '../data/stage1Steps';
import {
  DayHistoryEntry,
  KucherPhaseId,
  SavedAttemptRecord,
  Stage1Progress,
  Stage1StepConfig,
  Stage1StepNumber,
  TrainingMode,
  WorkingKey,
} from '../types/stage1';
import {
  decodeAudioBlob,
  ensureAudioContextRunning,
  playMetronomeClick,
  playStepCompleteChime,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';
import {
  DEFAULT_STAGE1_PROGRESS,
  loadAllAttemptsFromDb,
  loadStage1ProgressFromDb,
  loadStage2Unlocked,
  saveStage1ProgressToDb,
  saveStage2Unlocked,
} from '../utils/stage1Db';
import { Stage1Illustration } from './Stage1Illustrations';
import { Stage1Step6ControlAndExam } from './Stage1Step6ControlAndExam';

interface AttemptSlotState {
  record: SavedAttemptRecord;
  buffer: AudioBuffer;
  wavUrl: string;
}

type Stage1View = 'lobby' | 'workout' | 'exam';

interface Stage1TrainingProps {
  onActiveSessionChange?: (active: boolean) => void;
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface ActiveSequenceItem {
  config: Stage1StepConfig;
  durationSec: number;
  timeRangeLabel: string;
}

export function Stage1Training({ onActiveSessionChange }: Stage1TrainingProps) {
  const [progress, setProgress] = useState<Stage1Progress>(DEFAULT_STAGE1_PROGRESS);
  const [isHydrated, setIsHydrated] = useState(false);
  const [attempts, setAttempts] = useState<Array<AttemptSlotState | null>>([
    null,
    null,
    null,
  ]);
  const [sessionJustSaved, setSessionJustSaved] = useState(false);
  const [view, setView] = useState<Stage1View>('lobby');
  const [isTechniqueOpen, setIsTechniqueOpen] = useState(false);
  const [isTroubleshooterOpen, setIsTroubleshooterOpen] = useState(false);

  const attemptsRef = useRef<Array<AttemptSlotState | null>>([null, null, null]);
  attemptsRef.current = attempts;

  // Notify App.tsx when active workout/exam screen is open so top tabs hide
  useEffect(() => {
    onActiveSessionChange?.(view !== 'lobby');
  }, [view, onActiveSessionChange]);

  useEffect(() => {
    return () => {
      onActiveSessionChange?.(false);
    };
  }, [onActiveSessionChange]);

  // Hydrate progress and saved IndexedDB voice attempts on mount
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const [loadedProgress, savedRecords] = await Promise.all([
        loadStage1ProgressFromDb(),
        loadAllAttemptsFromDb(),
      ]);

      if (cancelled) return;
      setProgress(loadedProgress);

      const slots: Array<AttemptSlotState | null> = [null, null, null];
      for (const record of savedRecords) {
        if (record.slotIndex >= 0 && record.slotIndex <= 2 && record.wavBlob) {
          try {
            const buffer = await decodeAudioBlob(record.wavBlob);
            const wavUrl = URL.createObjectURL(record.wavBlob);
            slots[record.slotIndex] = { record, buffer, wavUrl };
          } catch {
            // Skip corrupted entry if any
          }
        }
      }

      if (cancelled) {
        slots.forEach((s) => {
          if (s?.wavUrl) URL.revokeObjectURL(s.wavUrl);
        });
        return;
      }

      setAttempts(slots);
      setIsHydrated(true);
    };

    void hydrate();

    return () => {
      cancelled = true;
      attemptsRef.current.forEach((s) => {
        if (s?.wavUrl) URL.revokeObjectURL(s.wavUrl);
      });
    };
  }, []);

  // Persist progress changes to IndexedDB + localStorage mirror
  useEffect(() => {
    if (!isHydrated) return;
    void saveStage1ProgressToDb(progress);
  }, [progress, isHydrated]);

  // Build active sequence based on trainingMode (6:30 full vs 4:00 focus)
  const sequence: ActiveSequenceItem[] = useMemo(() => {
    if (progress.trainingMode === 'full') {
      return STAGE1_STEPS.map((config) => ({
        config,
        durationSec: config.durationSec,
        timeRangeLabel: config.timeRangeLabel,
      }));
    }

    const activeKey: WorkingKey = progress.workingKey ?? 1;
    const keyStepNumber = (activeKey + 1) as Stage1StepNumber;
    const step1 = STAGE1_STEPS[0];
    const focusStep = STAGE1_STEPS.find((s) => s.step === keyStepNumber) ?? STAGE1_STEPS[1];
    const step6 = STAGE1_STEPS[5];

    return [
      { config: step1, durationSec: 40, timeRangeLabel: '0:00–0:40' },
      { config: focusStep, durationSec: 110, timeRangeLabel: '0:40–2:30' },
      { config: step6, durationSec: 90, timeRangeLabel: '2:30–4:00' },
    ];
  }, [progress.trainingMode, progress.workingKey]);

  const [seqIndex, setSeqIndex] = useState(0);
  const safeSeqIndex = Math.min(seqIndex, sequence.length - 1);
  const currentItem = sequence[safeSeqIndex];
  const currentStep = currentItem.config;

  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [remainingSec, setRemainingSec] = useState<number>(currentItem.durationSec);
  const [activeElapsedSec, setActiveElapsedSec] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [lockedHint, setLockedHint] = useState<string | null>(null);

  // Exam streak lives only in React state (resets to 0/6 on page reload);
  // only final stage2Unlocked boolean persists in localStorage.
  const [examStreak, setExamStreak] = useState(0);
  const [stage2Unlocked, setStage2Unlocked] = useState<boolean>(() => loadStage2Unlocked());

  // Metronome state
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [bpm, setBpm] = useState<60 | 90 | 120>(60);
  const [beatFlash, setBeatFlash] = useState(false);
  const beatCountRef = useRef(0);

  // Animated breathing pacer cycle (0..6000ms: 2s inhale + 4s exhale) for Steps 3-5
  const [breathCycleMs, setBreathCycleMs] = useState(0);

  // Auto-hide locked step hint after 2.5s
  useEffect(() => {
    if (!lockedHint) return;
    const timeoutId = window.setTimeout(() => setLockedHint(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [lockedHint]);

  const isIndexUnlocked = useCallback(
    (index: number) => {
      if (index <= 0) return true;
      const prevStep = sequence[index - 1]?.config.step;
      const targetStep = sequence[index]?.config.step;
      return (
        (prevStep !== undefined && completedSteps.includes(prevStep)) ||
        (targetStep !== undefined && completedSteps.includes(targetStep))
      );
    },
    [sequence, completedSteps]
  );

  const isStep6Unlocked = isIndexUnlocked(sequence.length - 1);

  const resetSessionGating = useCallback((firstDurationSec = 40) => {
    setIsRunning(false);
    setMetronomeOn(false);
    setSessionCompleted(false);
    setCompletedSteps([]);
    setSeqIndex(0);
    setRemainingSec(firstDurationSec);
    setActiveElapsedSec(0);
    setBreathCycleMs(0);
    setLockedHint(null);
    setExamStreak(0);
    setIsTechniqueOpen(false);
    setIsTroubleshooterOpen(false);
  }, []);

  const handleTrainingModeChange = (mode: TrainingMode) => {
    haptic('light');
    resetSessionGating(40);
    setProgress((prev) => ({
      ...prev,
      trainingMode: mode,
      workingKey: mode === 'focus' && !prev.workingKey ? 1 : prev.workingKey,
    }));
  };

  const goToSequenceIndex = useCallback(
    (index: number, keepRunning = false) => {
      const clamped = Math.max(0, Math.min(sequence.length - 1, index));
      const target = sequence[clamped];
      setSeqIndex(clamped);
      setRemainingSec(target.durationSec);
      setActiveElapsedSec(0);
      setBreathCycleMs(0);
      setSessionCompleted(false);
      setLockedHint(null);
      setIsTechniqueOpen(false);
      setIsTroubleshooterOpen(false);
      if (!keepRunning) {
        setIsRunning(false);
      }
      if (target.config.recommendedBpm) {
        setBpm(target.config.recommendedBpm);
      }
    },
    [sequence]
  );

  const handleStartWorkout = () => {
    haptic('medium');
    const firstItem = sequence[0];
    resetSessionGating(firstItem?.durationSec ?? 40);
    if (firstItem?.config.recommendedBpm) {
      setBpm(firstItem.config.recommendedBpm);
    }
    setView('workout');
  };

  const handleBackToLobby = () => {
    haptic('light');
    setIsRunning(false);
    setMetronomeOn(false);
    setBreathCycleMs(0);
    setIsTechniqueOpen(false);
    setIsTroubleshooterOpen(false);
    setView('lobby');
  };

  // Second-by-second countdown timer + active timer tracker
  useEffect(() => {
    if (!isRunning || view !== 'workout') return;

    const timer = window.setInterval(() => {
      setRemainingSec((prev) => Math.max(0, prev - 1));
      setActiveElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning, view]);

  // Automatic step completion and advance when countdown reaches 00:00
  useEffect(() => {
    if (!isRunning || remainingSec > 0 || view !== 'workout') return;

    playStepCompleteChime();
    haptic('success');

    const finishedStep = currentStep.step;
    setCompletedSteps((prev) => (prev.includes(finishedStep) ? prev : [...prev, finishedStep]));

    if (safeSeqIndex < sequence.length - 1) {
      const nextIdx = safeSeqIndex + 1;
      const nextItem = sequence[nextIdx];
      setSeqIndex(nextIdx);
      setRemainingSec(nextItem.durationSec);
      setActiveElapsedSec(0);
      setBreathCycleMs(0);
      setLockedHint(null);
      if (nextItem.config.recommendedBpm) {
        setBpm(nextItem.config.recommendedBpm);
      }
    } else {
      setIsRunning(false);
      setSessionCompleted(true);
    }
  }, [isRunning, remainingSec, view, safeSeqIndex, sequence, currentStep.step]);

  const hasMetronome = currentStep.step === 1 || currentStep.step === 2;

  // Auto-stop metronome whenever entering steps 3, 4, 5, or 6
  useEffect(() => {
    if (!hasMetronome && metronomeOn) {
      setMetronomeOn(false);
    }
  }, [hasMetronome, metronomeOn]);

  // Web Audio Metronome loop (active only on Steps 1 and 2)
  useEffect(() => {
    if (!metronomeOn || !hasMetronome || view !== 'workout') {
      setBeatFlash(false);
      beatCountRef.current = 0;
      return;
    }

    const intervalMs = Math.round(60000 / bpm);
    const fireTick = () => {
      const isAccent = beatCountRef.current % 4 === 0;
      beatCountRef.current += 1;
      playMetronomeClick(isAccent);
      setBeatFlash(true);
      window.setTimeout(() => setBeatFlash(false), 90);
    };

    fireTick();
    const metroTimer = window.setInterval(fireTick, intervalMs);

    return () => {
      window.clearInterval(metroTimer);
      setBeatFlash(false);
    };
  }, [metronomeOn, hasMetronome, bpm, view]);

  // Smooth Breathing Pacer RAF loop (active on Steps 3-5 while timer is running)
  useEffect(() => {
    if (!isRunning || hasMetronome || currentStep.step === 6 || view !== 'workout') {
      setBreathCycleMs(0);
      return;
    }

    let rafId = 0;
    const startPerf = performance.now();

    const tick = (now: number) => {
      setBreathCycleMs((now - startPerf) % 6000);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isRunning, hasMetronome, currentStep.step, view]);

  const subPhases = currentStep.subPhases ?? [];

  const activeSubPhaseIndex = useMemo(() => {
    if (subPhases.length === 0) return 0;
    const total = Math.max(1, currentItem.durationSec);
    const elapsed = Math.max(0, total - remainingSec);
    const ratio = elapsed / total;
    let idx = 0;
    for (let i = 0; i < subPhases.length; i++) {
      if (ratio >= subPhases[i].startRatio - 1e-6) {
        idx = i;
      }
    }
    return idx;
  }, [subPhases, currentItem.durationSec, remainingSec]);

  const activeSubPhase = subPhases[activeSubPhaseIndex] ?? null;

  const handleSelectSubPhase = (idx: number) => {
    const sub = subPhases[idx];
    if (!sub) return;
    haptic('light');
    const total = Math.max(1, currentItem.durationSec);
    setRemainingSec(Math.floor(total * (1 - sub.startRatio)));
  };

  const activeKucherPhase: KucherPhaseId = useMemo(() => {
    if (currentStep.step !== 5) return 'A';
    return activeSubPhase?.kucherPhaseId ?? 'A';
  }, [currentStep.step, activeSubPhase]);

  const activeBlocks = useMemo(() => {
    if (currentStep.step === 5 && currentStep.kucherPhases) {
      const phaseObj =
        currentStep.kucherPhases.find((p) => p.id === activeKucherPhase) ??
        currentStep.kucherPhases[0];
      return phaseObj.blocks;
    }
    return currentStep.blocks;
  }, [currentStep, activeKucherPhase]);

  const handleAttemptSaved = useCallback(
    (slotIndex: 0 | 1 | 2, item: AttemptSlotState) => {
      setAttempts((prev) => {
        const next = [...prev];
        if (next[slotIndex]?.wavUrl) {
          URL.revokeObjectURL(next[slotIndex]!.wavUrl);
        }
        next[slotIndex] = item;
        return next;
      });
    },
    []
  );

  const handleAttemptDeleted = useCallback((slotIndex: 0 | 1 | 2) => {
    setAttempts((prev) => {
      const next = [...prev];
      if (next[slotIndex]?.wavUrl) {
        URL.revokeObjectURL(next[slotIndex]!.wavUrl);
      }
      next[slotIndex] = null;
      return next;
    });
  }, []);

  const handleSaveDayTraining = () => {
    setIsRunning(false);
    setMetronomeOn(false);
    setSessionCompleted(true);
    setSessionJustSaved(true);

    setProgress((prev) => {
      const entry: DayHistoryEntry = {
        day: prev.day,
        sessionTime: prev.sessionTime,
        workingKey: prev.workingKey,
        chinWasSoft: prev.chinWasSoft,
        completedAt: Date.now(),
      };
      return {
        ...prev,
        completedSessions: prev.completedSessions + 1,
        history: [...prev.history, entry],
        sessionTime: prev.sessionTime === 'morning' ? 'evening' : 'morning',
        day:
          prev.sessionTime === 'evening' && prev.day < 5
            ? ((prev.day + 1) as 1 | 2 | 3 | 4 | 5)
            : prev.day,
      };
    });
  };

  // =========================================================================
  // VIEW 1: STAGE 1 LOBBY
  // =========================================================================
  if (view === 'lobby') {
    return (
      <div className="flex flex-col flex-1 justify-between px-4 py-4 gap-4">
        <div className="space-y-3.5">
          {/* Header summary */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono font-semibold text-[#0F5C5C] tabular-nums">
                Этап 1 · Дни 1–5
              </p>
              {progress.completedSessions > 0 && (
                <span className="font-mono text-[11px] text-[#63666A] tabular-nums">
                  Сессий: {progress.completedSessions}
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-[#141619] leading-snug">
              Поиск триггера и отключение горла
            </h1>
          </div>

          {/* Day 1..5 + Morning/Evening + Full/Focus Mode */}
          <section
            aria-label="Настройка тренировки Этапа 1"
            className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold text-[#141619] whitespace-nowrap">
                  День:
                </span>
                <div className="inline-flex items-center gap-0.5 bg-[#EAE8E1] rounded-xl p-0.5">
                  {([1, 2, 3, 4, 5] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        haptic('light');
                        setSessionJustSaved(false);
                        resetSessionGating(40);
                        setProgress((prev) => ({ ...prev, day: d }));
                      }}
                      className={`w-7 h-7 rounded-lg font-mono text-xs font-semibold tabular-nums transition-all ${
                        progress.day === d
                          ? 'bg-[#0F5C5C] text-white shadow-xs'
                          : 'text-[#63666A] hover:text-[#141619]'
                      }`}
                      aria-label={`День ${d}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="inline-flex items-center bg-[#EAE8E1] rounded-xl p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    haptic('light');
                    setSessionJustSaved(false);
                    resetSessionGating(40);
                    setProgress((prev) => ({ ...prev, sessionTime: 'morning' }));
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    progress.sessionTime === 'morning'
                      ? 'bg-white text-[#141619] shadow-sm'
                      : 'text-[#63666A] hover:text-[#141619]'
                  }`}
                >
                  Утро
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptic('light');
                    setSessionJustSaved(false);
                    resetSessionGating(40);
                    setProgress((prev) => ({ ...prev, sessionTime: 'evening' }));
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    progress.sessionTime === 'evening'
                      ? 'bg-white text-[#141619] shadow-sm'
                      : 'text-[#63666A] hover:text-[#141619]'
                  }`}
                >
                  Вечер
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 bg-[#EAE8E1] p-1 rounded-xl">
              <button
                type="button"
                onClick={() => handleTrainingModeChange('full')}
                className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold leading-tight transition-all ${
                  progress.trainingMode === 'full'
                    ? 'bg-white text-[#141619] shadow-sm'
                    : 'text-[#63666A] hover:text-[#141619]'
                }`}
              >
                Полный цикл 6:30
              </button>
              <button
                type="button"
                onClick={() => handleTrainingModeChange('focus')}
                className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold leading-tight transition-all ${
                  progress.trainingMode === 'focus'
                    ? 'bg-white text-[#0F5C5C] shadow-sm'
                    : 'text-[#63666A] hover:text-[#141619]'
                }`}
              >
                Фокус 4:00
              </button>
            </div>

            {progress.trainingMode === 'focus' && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] text-[#63666A] shrink-0">Мой ключ:</span>
                <div className="grid grid-cols-4 gap-1 flex-1">
                  {([1, 2, 3, 4] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        haptic('light');
                        resetSessionGating(40);
                        setProgress((prev) => ({ ...prev, workingKey: k }));
                      }}
                      className={`min-h-[34px] rounded-xl border text-[11px] font-semibold transition-colors ${
                        (progress.workingKey ?? 1) === k
                          ? 'bg-[#0F5C5C] border-[#0F5C5C] text-white'
                          : 'bg-[#F5F4F0] border-[#E7E5DE] text-[#141619]'
                      }`}
                    >
                      Ключ {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Compact Rule of Stage 1 Card with coach-avatar.png */}
          <section
            aria-label="Правило Этапа 1"
            className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3.5 space-y-2"
          >
            <div className="flex items-center gap-2.5">
              <img
                src={coachAvatarImg}
                alt="Речевой тренер SMC"
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full object-cover border border-[#E11D48]/25 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <AlertOctagon className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                  <p className="text-xs font-semibold text-[#E11D48]">Правило Этапа 1</p>
                </div>
                <p className="text-[11px] text-[#63666A] leading-tight">
                  Клинический протокол безопасности SMC
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-[#141619]">
              Запрещено рычать специально и думать о букве [Р]. Два пальца контролируют мягкую зону под подбородком — корень языка не толкается вниз.
            </p>
          </section>

          {stage2Unlocked && (
            <div className="bg-[#E6F2F2] border border-[#0F5C5C]/25 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Award className="w-4 h-4 text-[#0F5C5C] shrink-0" />
                <span className="text-xs font-semibold text-[#0F5C5C] truncate">
                  Этап 1 сдан (<span className="font-mono tabular-nums">6/6</span>)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  haptic('light');
                  setExamStreak(0);
                  setStage2Unlocked(false);
                  saveStage2Unlocked(false);
                }}
                className="text-[11px] font-semibold text-[#141619] underline underline-offset-2 shrink-0"
              >
                Пересдать
              </button>
            </div>
          )}

          {/* Session Plan Card */}
          <section
            aria-label="План сессии"
            className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#141619]">План сессии</p>
              <span className="font-mono text-xs font-semibold text-[#0F5C5C] tabular-nums">
                {progress.trainingMode === 'focus' ? '4:00' : '6:30'}
              </span>
            </div>

            <ol className="divide-y divide-[#E7E5DE]/60">
              {sequence.map((item) => (
                <li
                  key={item.config.step}
                  className="py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] font-semibold text-[#63666A] tabular-nums w-3.5 shrink-0">
                      {item.config.step}.
                    </span>
                    <span className="text-[#141619] font-medium truncate">
                      {item.config.shortTitle}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[#63666A] tabular-nums shrink-0">
                    {formatClock(item.durationSec)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-2">
          <p className="text-center text-[11px] text-[#63666A]">
            Цель этапа: серия <span className="font-mono font-semibold text-[#141619] tabular-nums">6/6</span> подряд
          </p>

          <button
            type="button"
            onClick={handleStartWorkout}
            className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] active:scale-[0.98] transition-all"
          >
            <span>Начать тренировку</span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: DEDICATED FINAL EXAM SCREEN ("Тест готовности к Этапу 2")
  // =========================================================================
  if (view === 'exam') {
    return (
      <div className="min-h-[100dvh] flex flex-col px-4 py-3 pb-6 gap-3">
        <div className="flex items-center justify-between gap-2 min-h-[40px] shrink-0">
          <button
            type="button"
            onClick={() => {
              haptic('light');
              setView('workout');
            }}
            className="inline-flex items-center gap-1 min-h-[36px] px-1.5 text-xs font-medium text-[#63666A] hover:text-[#141619] transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>К попыткам</span>
          </button>

          <p className="text-xs font-semibold tracking-tight text-[#141619] truncate text-center">
            Экзамен · Серия <span className="font-mono tabular-nums">6 из 6</span>
          </p>

          <button
            type="button"
            onClick={handleBackToLobby}
            className="min-h-[36px] px-2 text-xs font-medium text-[#63666A] hover:text-[#141619] transition-colors shrink-0"
          >
            В меню
          </button>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <Stage1Step6ControlAndExam
            showAttemptRecorder={false}
            renderMode="exam"
            progress={progress}
            attempts={attempts}
            examStreak={examStreak}
            stage2Unlocked={stage2Unlocked}
            isExamUnlocked={isStep6Unlocked}
            onAttemptSaved={handleAttemptSaved}
            onAttemptDeleted={(slotIdx) => void handleAttemptDeleted(slotIdx)}
            onSelectWorkingKey={(workingKey) => {
              setSessionJustSaved(false);
              setProgress((prev) => ({ ...prev, workingKey }));
            }}
            onToggleChinSoft={(chinWasSoft) => {
              setSessionJustSaved(false);
              setProgress((prev) => ({ ...prev, chinWasSoft }));
            }}
            onSaveDayTraining={handleSaveDayTraining}
            sessionJustSaved={sessionJustSaved}
            onExamMarkClean={() => {
              if (!isStep6Unlocked) return;
              setExamStreak((prev) => {
                const nextStreak = Math.min(6, prev + 1);
                if (nextStreak >= 6) {
                  setStage2Unlocked(true);
                  saveStage2Unlocked(true);
                }
                return nextStreak;
              });
            }}
            onExamMarkReset={() => {
              setExamStreak(0);
            }}
            onExamResetVictory={() => {
              setExamStreak(0);
              setStage2Unlocked(false);
              saveStage2Unlocked(false);
            }}
          />
        </div>

        <button
          type="button"
          onClick={handleBackToLobby}
          className="w-full min-h-[44px] rounded-2xl border border-[#E7E5DE] bg-[#FFFFFF] hover:border-[#141619]/30 text-xs font-semibold text-[#141619] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] transition-all shrink-0"
        >
          Вернуться в меню Этапа 1
        </button>
      </div>
    );
  }

  // Shared Technique Bottom Sheet Modal (available on all workout steps)
  const techniqueModal = isTechniqueOpen && (
    <div
      className="fixed inset-0 z-50 bg-[#141619]/50 flex items-end justify-center"
      onClick={() => setIsTechniqueOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={`Техника шага ${currentStep.step}`}
    >
      <div
        className="w-full max-w-md bg-[#FFFFFF] rounded-t-3xl border-t border-[#E7E5DE] max-h-[82dvh] overflow-y-auto p-4 space-y-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#E7E5DE]">
          <div className="min-w-0">
            <p className="text-[11px] font-mono font-semibold text-[#0F5C5C]">
              Техника выполнения · Шаг {currentStep.step}
            </p>
            <h3 className="text-sm font-semibold tracking-tight text-[#141619] leading-snug">
              {currentStep.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsTechniqueOpen(false)}
            className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-[#63666A] hover:text-[#141619] hover:bg-[#F5F4F0] shrink-0"
            aria-label="Закрыть технику"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#F5F4F0] border border-[#E7E5DE] rounded-2xl divide-y divide-[#E7E5DE]">
          <div className="p-3 space-y-1">
            <p className="text-[11px] font-semibold text-[#0F5C5C]">Язык</p>
            <p className="text-xs leading-relaxed text-[#141619]">{activeBlocks.tongue}</p>
          </div>
          <div className="p-3 space-y-1">
            <p className="text-[11px] font-semibold text-[#0F5C5C]">Зубы и челюсть</p>
            <p className="text-xs leading-relaxed text-[#141619]">{activeBlocks.teethAndJaw}</p>
          </div>
          <div className="p-3 space-y-1">
            <p className="text-[11px] font-semibold text-[#0F5C5C]">Дыхание и звук</p>
            <p className="text-xs leading-relaxed text-[#141619]">{activeBlocks.breathAndSound}</p>
          </div>
          <div className="p-3 space-y-1">
            <p className="text-[11px] font-semibold text-[#0F5C5C]">Контроль подбородка</p>
            <p className="text-xs leading-relaxed text-[#141619]">{activeBlocks.chinControl}</p>
          </div>
        </div>

        {currentStep.keyNumber && (
          <button
            type="button"
            onClick={() => {
              haptic('success');
              setProgress((prev) => ({
                ...prev,
                workingKey:
                  prev.workingKey === currentStep.keyNumber ? null : currentStep.keyNumber!,
              }));
            }}
            className={`w-full min-h-[44px] px-3.5 py-2 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
              progress.workingKey === currentStep.keyNumber
                ? 'bg-[#E6F2F2] border-[#0F5C5C]/30 text-[#141619]'
                : 'bg-[#FFFFFF] border-[#E7E5DE] text-[#141619] hover:border-[#0F5C5C]'
            }`}
          >
            <Star
              className={`w-4 h-4 shrink-0 ${
                progress.workingKey === currentStep.keyNumber
                  ? 'text-[#0F5C5C] fill-[#0F5C5C]'
                  : 'text-[#63666A]'
              }`}
            />
            <span>
              {progress.workingKey === currentStep.keyNumber
                ? `Ключ ${currentStep.keyNumber} отмечен как мой рабочий`
                : `Отметить Ключ ${currentStep.keyNumber} как мой рабочий`}
            </span>
          </button>
        )}

        <div className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3 text-[11px] leading-relaxed text-[#141619]">
          <span className="font-semibold text-[#E11D48]">ТАБУ: </span>
          Не рычи специально и держи мягкой зону под подбородком.
        </div>
      </div>
    </div>
  );

  // Clinical Troubleshooter Bottom Sheet Modal ("Срыв / Не выходит?")
  const troubleshootTips = currentStep.troubleshootTips ?? [];
  const troubleshooterModal = isTroubleshooterOpen && (
    <div
      className="fixed inset-0 z-50 bg-[#141619]/50 flex items-end justify-center"
      onClick={() => setIsTroubleshooterOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={`Решатель проблем · Шаг ${currentStep.step}`}
    >
      <div
        className="w-full max-w-md bg-[#FFFFFF] rounded-t-3xl border-t border-[#E7E5DE] max-h-[82dvh] overflow-y-auto p-4 space-y-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#E7E5DE]">
          <div className="min-w-0">
            <p className="text-[11px] font-mono font-semibold text-[#E11D48]">
              Клинический решатель · Шаг {currentStep.step}
            </p>
            <h3 className="text-sm font-semibold tracking-tight text-[#141619] leading-snug">
              Если не получается прямо сейчас
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsTroubleshooterOpen(false)}
            className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-[#63666A] hover:text-[#141619] hover:bg-[#F5F4F0] shrink-0"
            aria-label="Закрыть подсказки"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {troubleshootTips.map((tip, idx) => (
            <div
              key={idx}
              className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3 space-y-1"
            >
              <p className="text-xs font-semibold text-[#E11D48]">{tip.symptom}</p>
              <p className="text-xs leading-relaxed text-[#141619]">→ {tip.fix}</p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsTroubleshooterOpen(false)}
          className="w-full h-11 rounded-2xl bg-[#141619] text-white text-xs font-semibold transition-all active:scale-[0.98]"
        >
          Понятно, пробую снова
        </button>
      </div>
    </div>
  );

  // Shared Slim Smart Gating Step Strip
  const smartGatingStrip = (
    <div className="space-y-1">
      <div className="flex items-center gap-1" role="tablist" aria-label="Шаги тренировки">
        {sequence.map((item, idx) => {
          const stepNum = item.config.step;
          const active = idx === safeSeqIndex;
          const completed = completedSteps.includes(stepNum);
          const unlocked = isIndexUnlocked(idx);

          return (
            <button
              key={stepNum}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={!unlocked}
              onClick={() => {
                haptic('light');
                if (!unlocked) {
                  setLockedHint('Сначала завершите текущий шаг');
                  return;
                }
                setLockedHint(null);
                goToSequenceIndex(idx, false);
              }}
              className={`flex-1 min-w-0 h-6 px-1 rounded-lg border font-mono text-[11px] font-semibold tabular-nums flex items-center justify-center gap-0.5 transition-colors ${
                active
                  ? completed
                    ? 'bg-[#E6F2F2] border-2 border-[#0F5C5C] text-[#141619]'
                    : 'bg-[#FFFFFF] border-2 border-[#0F5C5C] text-[#0F5C5C]'
                  : completed
                    ? 'bg-[#E6F2F2] border-[#0F5C5C]/25 text-[#141619]'
                    : unlocked
                      ? 'bg-[#FFFFFF] border-[#E7E5DE] text-[#141619]'
                      : 'bg-[#EAE8E1] border-[#E7E5DE] text-[#63666A] cursor-not-allowed'
              }`}
            >
              {completed ? (
                <Check className="w-3 h-3 text-[#0F5C5C] shrink-0" aria-hidden="true" />
              ) : !unlocked ? (
                <Lock className="w-2.5 h-2.5 text-[#63666A] shrink-0" aria-hidden="true" />
              ) : null}
              <span>{stepNum}</span>
            </button>
          );
        })}
      </div>

      {lockedHint && (
        <div
          role="status"
          className="bg-[#141619] text-white text-[11px] font-medium px-2.5 py-1 rounded-lg text-center"
        >
          {lockedHint}
        </div>
      )}
    </div>
  );

  // Breathing pacer computations for Steps 3-5
  const isInhalePhase = breathCycleMs < 2000;
  const pacerPercent = !isRunning
    ? 0
    : isInhalePhase
      ? Math.round((breathCycleMs / 2000) * 100)
      : Math.round(((breathCycleMs - 2000) / 4000) * 100);
  const pacerPhaseSec = isInhalePhase
    ? Math.max(1, Math.ceil((2000 - breathCycleMs) / 1000))
    : Math.max(1, Math.ceil((6000 - breathCycleMs) / 1000));

  // Shared Single-Row Compact Dark Hardware Console (Timer + Metronome OR Breathing Pacer)
  const compactControlRow = (
    <div className="bg-[#141619] text-white rounded-2xl px-3.5 py-2.5 shadow-lg flex items-center justify-between gap-2.5">
      {/* Left: Timer + Play/Pause + Reset */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-lg font-bold text-[#FFFFFF] tabular-nums min-w-[46px]">
          {formatClock(remainingSec)}
        </span>

        <button
          type="button"
          onClick={() => {
            haptic('medium');
            void ensureAudioContextRunning();
            if (sessionCompleted) {
              goToSequenceIndex(0, true);
            } else {
              setIsRunning((prev) => !prev);
            }
          }}
          className="w-10 h-10 rounded-full bg-[#2DD4BF] hover:bg-[#26BEA9] text-[#141619] flex items-center justify-center transition-all active:scale-95 shrink-0"
          aria-label={isRunning ? 'Пауза' : 'Старт таймера'}
        >
          {isRunning ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            haptic('light');
            setIsRunning(false);
            setSessionCompleted(false);
            setBreathCycleMs(0);
            setRemainingSec(currentItem.durationSec);
            setActiveElapsedSec(0);
          }}
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 text-white/80 hover:text-white flex items-center justify-center transition-colors shrink-0"
          aria-label="Сбросить таймер шага"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-px h-6 bg-white/15 shrink-0" aria-hidden="true" />

      {/* Right: Metronome (Steps 1-2 only) OR Live Breathing Pacer (Steps 3-5) */}
      {hasMetronome ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              haptic('light');
              void ensureAudioContextRunning();
              setMetronomeOn((prev) => !prev);
            }}
            className={`h-8 px-2 rounded-xl text-[11px] font-semibold inline-flex items-center justify-center transition-colors shrink-0 ${
              metronomeOn
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-white/60 hover:text-white'
            }`}
            aria-label="Переключить метроном"
          >
            {metronomeOn ? (
              <Volume2 className={`w-3.5 h-3.5 ${beatFlash ? 'text-[#2DD4BF]' : 'text-white'}`} />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="inline-flex items-center bg-white/10 rounded-xl p-0.5">
            {([60, 90, 120] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => {
                  haptic('light');
                  setBpm(rate);
                }}
                className={`h-7 px-1.5 rounded-lg font-mono text-[10px] font-semibold tabular-nums transition-colors ${
                  bpm === rate
                    ? 'bg-[#2DD4BF] text-[#141619]'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {rate}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 space-y-1.5" aria-label="Дыхательный пейсер">
          <div className="flex items-center justify-between gap-1.5">
            <span
              className={`text-[11px] font-medium truncate ${
                !isRunning
                  ? 'text-white/60'
                  : isInhalePhase
                    ? 'text-white/75'
                    : 'text-[#2DD4BF]'
              }`}
            >
              {!isRunning
                ? 'Вдох 2 с → Выдох 4 с'
                : isInhalePhase
                  ? 'Вдох носом (2 с)'
                  : 'Плотный выдох (4 с)'}
            </span>
            {isRunning && (
              <span
                className={`font-mono text-[10px] font-semibold tabular-nums shrink-0 ${
                  isInhalePhase ? 'text-white/70' : 'text-[#2DD4BF]'
                }`}
              >
                {pacerPhaseSec} с
              </span>
            )}
          </div>

          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-none ${
                isInhalePhase ? 'bg-white/40' : 'bg-[#2DD4BF]'
              }`}
              style={{ width: `${pacerPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  // =========================================================================
  // VIEW 2B: WORKOUT — STEP 6 (3 Best Attempts + DSP + 0.5x -> Button to Exam)
  // =========================================================================
  if (currentStep.step === 6) {
    return (
      <div className="min-h-[100dvh] flex flex-col px-4 py-3 pb-8 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 min-h-[36px]">
            <button
              type="button"
              onClick={handleBackToLobby}
              className="inline-flex items-center gap-1 min-h-[36px] px-1 text-xs font-medium text-[#63666A] hover:text-[#141619] shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>В меню</span>
            </button>

            <p className="text-xs font-semibold tracking-tight text-[#141619] truncate text-center">
              <span className="font-mono tabular-nums">{safeSeqIndex + 1} из {sequence.length}</span> · {currentStep.shortTitle}
            </p>

            <button
              type="button"
              onClick={() => {
                haptic('light');
                setIsTechniqueOpen(true);
              }}
              className="min-h-[32px] px-2.5 rounded-xl border border-[#E7E5DE] bg-[#FFFFFF] text-[11px] font-semibold text-[#0F5C5C] inline-flex items-center gap-1 shrink-0"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Техника</span>
            </button>
          </div>

          {smartGatingStrip}
        </div>

        <Stage1Step6ControlAndExam
          showAttemptRecorder={true}
          renderMode="attempts"
          progress={progress}
          attempts={attempts}
          examStreak={examStreak}
          stage2Unlocked={stage2Unlocked}
          isExamUnlocked={isStep6Unlocked}
          onAttemptSaved={handleAttemptSaved}
          onAttemptDeleted={(slotIdx) => void handleAttemptDeleted(slotIdx)}
          onSelectWorkingKey={(workingKey) => {
            setSessionJustSaved(false);
            setProgress((prev) => ({ ...prev, workingKey }));
          }}
          onToggleChinSoft={(chinWasSoft) => {
            setSessionJustSaved(false);
            setProgress((prev) => ({ ...prev, chinWasSoft }));
          }}
          onSaveDayTraining={handleSaveDayTraining}
          sessionJustSaved={sessionJustSaved}
          onExamMarkClean={() => {}}
          onExamMarkReset={() => {}}
          onExamResetVictory={() => {}}
        />

        <button
          type="button"
          onClick={() => {
            haptic('medium');
            setIsRunning(false);
            setMetronomeOn(false);
            setCompletedSteps((prev) => (prev.includes(6) ? prev : [...prev, 6]));
            setView('exam');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] active:scale-[0.98] transition-all"
        >
          <span>Перейти к экзамену <span className="font-mono tabular-nums">6/6</span></span>
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>

        {techniqueModal}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2A: WORKOUT — STEPS 1–5 (STRICT Zero-Scroll h-[100dvh])
  // =========================================================================
  const alreadyCompleted = completedSteps.includes(currentStep.step);
  const secondsRemainingForEarly = Math.max(0, 10 - activeElapsedSec);
  const canCompleteStep = alreadyCompleted || activeElapsedSec >= 10;

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden px-4 py-3 gap-3">
      {/* Top: Back to menu + Step title + Technique button + Slim Smart Gating strip */}
      <div className="space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2 min-h-[34px]">
          <button
            type="button"
            onClick={handleBackToLobby}
            className="inline-flex items-center gap-1 min-h-[34px] px-1 text-xs font-medium text-[#63666A] hover:text-[#141619] shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>В меню</span>
          </button>

          <p className="text-xs font-semibold tracking-tight text-[#141619] truncate text-center">
            <span className="font-mono tabular-nums">{safeSeqIndex + 1} из {sequence.length}</span> · {currentStep.shortTitle}
          </p>

          <button
            type="button"
            onClick={() => {
              haptic('light');
              setIsTechniqueOpen(true);
            }}
            className="min-h-[32px] px-2.5 rounded-xl border border-[#E7E5DE] bg-[#FFFFFF] text-[11px] font-semibold text-[#0F5C5C] inline-flex items-center gap-1 shrink-0"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Техника</span>
          </button>
        </div>

        {smartGatingStrip}
      </div>

      {/* Middle Zone: Bounded Media + Interactive Coaching Teleprompter Card */}
      <div className="flex-1 min-h-0 flex flex-col gap-2.5">
        <Stage1Illustration step={currentStep.step} variant="compact" />

        <div className="flex-1 min-h-0 flex flex-col justify-between bg-white rounded-2xl border border-[#E7E5DE] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] p-3.5 overflow-hidden">
          {/* Top: Sub-phase Pill Switcher */}
          {subPhases.length > 0 && (
            <div
              className={`grid gap-1 bg-[#EAE8E1] p-1 rounded-xl shrink-0 ${
                subPhases.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
              }`}
              role="tablist"
              aria-label="Микро-фазы упражнения"
            >
              {subPhases.map((phase, idx) => {
                const active = idx === activeSubPhaseIndex;
                return (
                  <button
                    key={phase.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSelectSubPhase(idx)}
                    className={`min-h-[28px] px-1.5 py-1 rounded-lg text-[11px] font-semibold transition-all truncate ${
                      active
                        ? 'bg-white text-[#141619] shadow-sm'
                        : 'text-[#63666A] hover:text-[#141619]'
                    }`}
                  >
                    {phase.tabLabel}
                  </button>
                );
              })}
            </div>
          )}

          {/* Center: Large Target Syllable / Cue + 2 Concise Rules */}
          {activeSubPhase && (
            <div className="my-auto py-1 space-y-2">
              <div className="text-center space-y-0.5">
                <p className="font-mono text-[10px] font-medium text-[#63666A] tabular-nums">
                  Фаза · {activeSubPhase.timeWindowLabel}
                </p>
                <p className="font-mono text-lg sm:text-xl font-bold text-[#0F5C5C] tracking-tight leading-snug">
                  {activeSubPhase.targetCue}
                </p>
              </div>

              <div className="space-y-1.5">
                {activeSubPhase.rules.map((rule, rIdx) => (
                  <div
                    key={rIdx}
                    className="flex items-start gap-2 text-xs leading-snug text-[#141619]"
                  >
                    <span className="w-4 h-4 rounded-full bg-[#E6F2F2] text-[#0F5C5C] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                      {rIdx + 1}
                    </span>
                    <p className="min-w-0">{rule}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom: Clinical Troubleshooter Trigger */}
          <div className="pt-1 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                haptic('light');
                setIsTroubleshooterOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FFF1F2] border border-[#FFE4E6] hover:bg-[#FFE4E6]/80 text-[#E11D48] text-[11px] font-semibold transition-colors"
            >
              <LifeBuoy className="w-3.5 h-3.5 shrink-0" />
              <span>Срыв / Не выходит?</span>
            </button>

            <span className="font-mono text-[10px] text-[#63666A] tabular-nums">
              {activeSubPhaseIndex + 1}/{subPhases.length}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom: Compact Single-Row Control Bar + Main Step CTA */}
      <div className="space-y-2 shrink-0">
        {compactControlRow}

        <button
          type="button"
          disabled={!canCompleteStep}
          onClick={() => {
            haptic('success');
            setCompletedSteps((prev) =>
              prev.includes(currentStep.step) ? prev : [...prev, currentStep.step]
            );
            goToSequenceIndex(safeSeqIndex + 1, false);
          }}
          className={`w-full h-11 rounded-2xl border text-xs font-semibold tabular-nums flex items-center justify-center gap-1.5 transition-all ${
            canCompleteStep
              ? 'bg-[#141619] border-[#141619] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] active:scale-[0.98]'
              : 'bg-[#EAE8E1] border-[#E7E5DE] text-[#63666A] cursor-not-allowed'
          }`}
        >
          {canCompleteStep ? (
            <>
              <span>Завершить шаг</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </>
          ) : (
            <span>
              Попробуйте механику (осталось{' '}
              <span className="font-mono tabular-nums">{secondsRemainingForEarly}</span> с)
            </span>
          )}
        </button>
      </div>

      {techniqueModal}
      {troubleshooterModal}
    </div>
  );
}
