import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Info,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import step4AnatomyCompareImg from '@/step4-anatomy-compare.png';
import { NeckVibration } from '../types/diagnostic';
import {
  decodeAudioBlob,
  detectReferencePeakTimesMs,
  ensureAudioContextRunning,
  generateSyntheticReferenceBuffer,
  SYNTHETIC_REFERENCE_PEAKS_MS,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';
import { OscillogramCanvas } from './OscillogramCanvas';

interface Step4ABMirrorProps {
  debugMode?: boolean;
  neckVibration: NeckVibration;
  recordedBuffer: AudioBuffer | null;
  customReferenceBuffer: AudioBuffer | null;
  customReferenceName: string | null;
  onUploadCustomReference: (buffer: AudioBuffer, fileName: string) => void;
  onResetCustomReference: () => void;
  onNext: () => void;
}

export function Step4ABMirror({
  debugMode = false,
  neckVibration,
  recordedBuffer,
  customReferenceBuffer,
  customReferenceName,
  onUploadCustomReference,
  onResetCustomReference,
  onNext,
}: Step4ABMirrorProps) {
  const [isLooping, setIsLooping] = useState(false);
  const [activePhase, setActivePhase] = useState<'A' | 'B' | 'pause' | null>(null);
  const [playheadA, setPlayheadA] = useState<number | null>(null);
  const [playheadB, setPlayheadB] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isBoneInfoOpen, setIsBoneInfoOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isLoopingRef = useRef(false);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  const syntheticReference = useMemo(() => generateSyntheticReferenceBuffer(), []);
  const referenceBuffer = customReferenceBuffer ?? syntheticReference;

  const referencePeakTimesMs = useMemo(() => {
    if (customReferenceBuffer) {
      return detectReferencePeakTimesMs(customReferenceBuffer);
    }
    return [...SYNTHETIC_REFERENCE_PEAKS_MS];
  }, [customReferenceBuffer]);

  const stopPlaybackResources = useCallback(() => {
    isLoopingRef.current = false;

    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // Ignore if source already stopped
      }
      activeSourceRef.current = null;
    }

    setActivePhase(null);
    setPlayheadA(null);
    setPlayheadB(null);
  }, []);

  useEffect(() => {
    return () => {
      stopPlaybackResources();
    };
  }, [stopPlaybackResources]);

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const playBufferWithPlayhead = useCallback(
    async (
      buffer: AudioBuffer,
      channel: 'A' | 'B',
      peakHapticMs: number[] | null,
      onComplete: () => void
    ) => {
      if (!isLoopingRef.current) return;

      const ctx = await ensureAudioContextRunning();
      if (!isLoopingRef.current) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourceRef.current = source;

      setActivePhase(channel);
      if (channel === 'A') {
        setPlayheadA(0);
        setPlayheadB(null);
      } else {
        setPlayheadB(0);
        setPlayheadA(null);
      }

      const startPerf = performance.now();
      const durationMs = Math.max(50, buffer.duration * 1000);

      // Schedule haptic('light') at the 3 alveolar peak moments of Reference
      if (peakHapticMs && peakHapticMs.length > 0) {
        peakHapticMs.forEach((delayMs) => {
          if (delayMs < durationMs) {
            scheduleTimeout(() => {
              if (isLoopingRef.current) {
                haptic('light');
              }
            }, delayMs);
          }
        });
      }

      const animatePlayhead = () => {
        if (!isLoopingRef.current) return;
        const elapsed = performance.now() - startPerf;
        const progress = Math.min(1, elapsed / durationMs);

        if (channel === 'A') {
          setPlayheadA(progress);
        } else {
          setPlayheadB(progress);
        }

        if (progress < 1) {
          rafRef.current = window.requestAnimationFrame(animatePlayhead);
        }
      };

      rafRef.current = window.requestAnimationFrame(animatePlayhead);

      source.onended = () => {
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null;
        }
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (channel === 'A') setPlayheadA(null);
        else setPlayheadB(null);

        if (isLoopingRef.current) {
          onComplete();
        }
      };

      source.start();
    },
    [scheduleTimeout]
  );

  const runLoopCycle = useCallback(() => {
    if (!isLoopingRef.current) return;

    void playBufferWithPlayhead(referenceBuffer, 'A', referencePeakTimesMs, () => {
      if (!isLoopingRef.current) return;
      setActivePhase('pause');

      // Pause 200ms after Reference
      scheduleTimeout(() => {
        if (!isLoopingRef.current) return;

        if (!recordedBuffer) {
          // If no user recording exists, pause 450ms and repeat Reference
          scheduleTimeout(() => {
            if (isLoopingRef.current) runLoopCycle();
          }, 450);
          return;
        }

        void playBufferWithPlayhead(recordedBuffer, 'B', null, () => {
          if (!isLoopingRef.current) return;
          setActivePhase('pause');

          // Pause 450ms after User Recording, then loop
          scheduleTimeout(() => {
            if (isLoopingRef.current) {
              runLoopCycle();
            }
          }, 450);
        });
      }, 200);
    });
  }, [playBufferWithPlayhead, referenceBuffer, referencePeakTimesMs, recordedBuffer, scheduleTimeout]);

  const handleToggleLoop = async () => {
    if (isLooping) {
      haptic('light');
      stopPlaybackResources();
      setIsLooping(false);
      return;
    }

    haptic('medium');
    await ensureAudioContextRunning();
    isLoopingRef.current = true;
    setIsLooping(true);
    runLoopCycle();
  };

  const handleOpenUpload = () => {
    haptic('light');
    fileInputRef.current?.click();
  };

  const handleCustomReferenceChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    stopPlaybackResources();
    setIsLooping(false);

    try {
      await ensureAudioContextRunning();
      const decoded = await decodeAudioBlob(file);
      haptic('success');
      onUploadCustomReference(decoded, file.name);
    } catch {
      setUploadError('Не удалось декодировать файл. Используйте формат .wav или .mp3.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const userColor = '#FB7185';

  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-3 gap-3">
      <div className="space-y-2.5">
        {/* 1-line compact header with 36x36px icon button */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[#63666A] leading-none mb-1">
              Акустическое A/B-зеркало
            </p>
            <h2 className="text-[19px] sm:text-xl font-semibold tracking-tight text-[#141619] truncate leading-tight">
              Где именно теряется вибрация
            </h2>
          </div>

          {debugMode && (
            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,audio/*"
                onChange={handleCustomReferenceChange}
                className="hidden"
                aria-label="Загрузить свой эталон (.wav/.mp3)"
              />
              <button
                type="button"
                onClick={handleOpenUpload}
                title="Загрузить свой эталон (.wav/.mp3)"
                aria-label="Загрузить свой эталон (.wav/.mp3)"
                className="w-9 h-9 rounded-xl bg-[#FFFFFF] border border-[#E7E5DE] hover:border-[#0F5C5C] text-[#63666A] hover:text-[#0F5C5C] shadow-[0_2px_10px_-4px_rgba(20,22,25,0.06)] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C]"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {uploadError && (
          <div
            role="alert"
            className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
            <p className="text-xs text-[#141619]">{uploadError}</p>
          </div>
        )}

        {/* Unified Dark Oscilloscope Hardware Card */}
        <section
          aria-label="Осциллограф A/B-сравнения"
          className="bg-[#141619] text-white rounded-2xl p-3.5 shadow-lg space-y-2.5"
        >
          {/* Reference wave header + canvas */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#2DD4BF] shrink-0" aria-hidden="true" />
                <p className="text-xs font-medium text-white/90 truncate">
                  {customReferenceName
                    ? `${customReferenceName} · ${referenceBuffer.duration.toFixed(2)} с`
                    : 'Эталон · 3 смычки'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {customReferenceBuffer && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic('light');
                      stopPlaybackResources();
                      setIsLooping(false);
                      onResetCustomReference();
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-white/60 hover:text-white"
                    title="Вернуть встроенный эталон"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Сброс</span>
                  </button>
                )}
                <span
                  className={`font-mono text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                    activePhase === 'A'
                      ? 'bg-[#2DD4BF]/20 text-[#2DD4BF]'
                      : 'text-white/55'
                  }`}
                >
                  {activePhase === 'A' ? 'Звучит А' : `${referenceBuffer.duration.toFixed(2)} с`}
                </span>
              </div>
            </div>

            <OscillogramCanvas
              buffer={referenceBuffer}
              color="#2DD4BF"
              playheadProgress={playheadA}
              className="h-[56px]"
              ariaLabel="Осциллограмма эталонного альвеолярного звука Р"
            />
          </div>

          <div className="border-t border-white/10" aria-hidden="true" />

          {/* User recording wave header + canvas */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#FB7185] shrink-0" aria-hidden="true" />
                <p className="text-xs font-medium text-white/90 truncate">
                  Ваша запись · Точка А
                  {neckVibration === 'throat' ? ' · горловой уклад' : ''}
                </p>
              </div>

              <span
                className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 px-1.5 py-0.5 rounded-md ${
                  activePhase === 'B'
                    ? 'bg-[#FB7185]/20 text-[#FB7185]'
                    : 'text-white/55'
                }`}
              >
                {activePhase === 'B'
                  ? 'Звучит Б'
                  : recordedBuffer
                    ? `${recordedBuffer.duration.toFixed(2)} с`
                    : 'нет'}
              </span>
            </div>

            <OscillogramCanvas
              buffer={recordedBuffer}
              color={userColor}
              playheadProgress={playheadB}
              className="h-[56px]"
              ariaLabel="Осциллограмма обрезанной записи пользователя Точка А"
            />
          </div>

          {/* Seamless A/B Loop Button inside Dark Hardware Card */}
          <button
            type="button"
            onClick={handleToggleLoop}
            className={`w-full h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2DD4BF] ${
              isLooping
                ? 'bg-[#2DD4BF] text-[#141619] ring-2 ring-[#2DD4BF]/40'
                : 'bg-[#2DD4BF] hover:bg-[#24BFA9] text-[#141619]'
            }`}
          >
            {isLooping ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Стоп A/B-сравнения</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Слушать встык (A/B Loop)</span>
              </>
            )}
          </button>
        </section>

        {/* Compact Anatomical Comparison Diagram */}
        <figure className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-2 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] space-y-1.5">
          <img
            src={step4AnatomyCompareImg}
            alt="Сравнение спазма корня языка и альвеолярного удара кончиком языка"
            referrerPolicy="no-referrer"
            className="w-full max-h-[135px] object-contain rounded-xl"
          />
          <figcaption className="text-[11px] leading-snug text-[#63666A] px-1">
            Слева — спазм корня (сплошной шум). Справа — чистый удар кончика (чёткие пики).
          </figcaption>
        </figure>

        {/* Collapsible Bone Conduction Explanation Accordion */}
        <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] overflow-hidden">
          <button
            type="button"
            aria-expanded={isBoneInfoOpen}
            onClick={() => {
              haptic('light');
              setIsBoneInfoOpen((prev) => !prev);
            }}
            className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-[#F5F4F0]/50 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Info className="w-4 h-4 text-[#0F5C5C] shrink-0" />
              <span className="text-xs font-semibold text-[#141619] truncate">
                Почему в голове ваш звук кажется другим
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#63666A] shrink-0 transition-transform duration-200 ${
                isBoneInfoOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isBoneInfoOpen && (
            <div className="px-3.5 pb-3 pt-0.5 text-xs leading-relaxed text-[#63666A] border-t border-[#E7E5DE]/60">
              Из-за костной проводимости черепа внутренние низкие частоты горлового [Р] усиливаются и маскируют отсутствие ударов кончика языка. Встык с эталоном эта разница слышна сразу.
            </div>
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => {
            stopPlaybackResources();
            setIsLooping(false);
            haptic('light');
            onNext();
          }}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] focus-visible:ring-offset-2"
        >
          <span>Дальше</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
