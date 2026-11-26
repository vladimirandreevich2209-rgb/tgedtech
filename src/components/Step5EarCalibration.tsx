import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Upload,
  Volume2,
  XCircle,
} from 'lucide-react';
import {
  decodeAudioBlob,
  ensureAudioContextRunning,
  generateCleanAlveolarSampleBuffer,
  generateThroatFricativeSampleBuffer,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';

interface Step5EarCalibrationProps {
  debugMode?: boolean;
  earScore: number;
  onUpdateScore: (score: number) => void;
  onNext: () => void;
}

interface CalibrationRoundConfig {
  id: number;
  label: string;
  correctSlot: 1 | 2;
}

const ROUND_LABELS = ['Раунд 1', 'Раунд 2', 'Раунд 3'];

function createRandomizedRounds(): CalibrationRoundConfig[] {
  return ROUND_LABELS.map((label, idx) => ({
    id: idx + 1,
    label,
    correctSlot: Math.random() < 0.5 ? 1 : 2,
  }));
}

export function Step5EarCalibration({
  debugMode = false,
  earScore,
  onUpdateScore,
  onNext,
}: Step5EarCalibrationProps) {
  const [rounds] = useState<CalibrationRoundConfig[]>(() => createRandomizedRounds());
  const [roundIndex, setRoundIndex] = useState(0);
  const [playingSlot, setPlayingSlot] = useState<1 | 2 | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<1 | 2 | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);

  // Optional custom audio test files (clean vs throat)
  const [showCustomLoader, setShowCustomLoader] = useState(false);
  const [customClean, setCustomClean] = useState<{ buffer: AudioBuffer; name: string } | null>(
    null
  );
  const [customThroat, setCustomThroat] = useState<{ buffer: AudioBuffer; name: string } | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cleanInputRef = useRef<HTMLInputElement | null>(null);
  const throatInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-synthesize 3 contrasting pairs (0.6s each) with slight pitch/noise variation per round
  const syntheticPairs = useMemo(() => {
    return [
      {
        clean: generateCleanAlveolarSampleBuffer(44100, 0),
        throat: generateThroatFricativeSampleBuffer(44100, 1),
      },
      {
        clean: generateCleanAlveolarSampleBuffer(44100, 8),
        throat: generateThroatFricativeSampleBuffer(44100, 2),
      },
      {
        clean: generateCleanAlveolarSampleBuffer(44100, -6),
        throat: generateThroatFricativeSampleBuffer(44100, 3),
      },
    ];
  }, []);

  const stopActiveSound = useCallback(() => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped source
      }
      activeSourceRef.current = null;
    }
    setPlayingSlot(null);
  }, []);

  useEffect(() => {
    return () => {
      stopActiveSound();
    };
  }, [stopActiveSound]);

  const currentRound = rounds[roundIndex];
  const isRoundAnswered = selectedSlot !== null;
  const isLastRound = roundIndex === rounds.length - 1;
  const isAllDone = answers.length === rounds.length;

  const getSlotBuffer = (slot: 1 | 2): AudioBuffer => {
    const isCleanSlot = currentRound.correctSlot === slot;
    if (isCleanSlot) {
      return customClean?.buffer ?? syntheticPairs[roundIndex].clean;
    }
    return customThroat?.buffer ?? syntheticPairs[roundIndex].throat;
  };

  const handlePlaySlot = async (slot: 1 | 2) => {
    if (playingSlot === slot) {
      haptic('light');
      stopActiveSound();
      return;
    }

    stopActiveSound();
    haptic('light');

    try {
      const ctx = await ensureAudioContextRunning();
      const buffer = getSlotBuffer(slot);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourceRef.current = source;
      setPlayingSlot(slot);

      source.onended = () => {
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null;
        }
        setPlayingSlot(null);
      };

      source.start();
    } catch {
      setPlayingSlot(null);
    }
  };

  const handleChoose = (slot: 1 | 2) => {
    if (isRoundAnswered) return;
    stopActiveSound();
    setSelectedSlot(slot);

    const isCorrect = slot === currentRound.correctSlot;
    const updatedAnswers = [...answers, isCorrect];
    setAnswers(updatedAnswers);

    const newScore = updatedAnswers.filter(Boolean).length;
    onUpdateScore(newScore);
    haptic(isCorrect ? 'success' : 'medium');
  };

  const handleContinue = () => {
    stopActiveSound();
    haptic('light');
    if (isLastRound) {
      onNext();
    } else {
      setRoundIndex((prev) => prev + 1);
      setSelectedSlot(null);
    }
  };

  const handleFileUpload = async (
    kind: 'clean' | 'throat',
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    stopActiveSound();

    try {
      await ensureAudioContextRunning();
      const decoded = await decodeAudioBlob(file);
      haptic('success');
      if (kind === 'clean') {
        setCustomClean({ buffer: decoded, name: file.name });
      } else {
        setCustomThroat({ buffer: decoded, name: file.name });
      }
    } catch {
      setUploadError('Не удалось декодировать аудиофайл. Выберите .wav или .mp3.');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-5 gap-5">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2.5">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-[#63666A]">
              Калибровка слуха · Раунд{' '}
              <span className="font-mono tabular-nums">
                {roundIndex + 1} из {rounds.length}
              </span>
            </p>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[#141619] text-balance leading-snug">
              Где звучит чистый передний вибрант без горлового шума?
            </h2>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-xl px-2.5 py-1.5 text-right shrink-0 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
            <p className="text-[10px] text-[#63666A] leading-none">Угадано</p>
            <p className="font-mono text-sm font-bold text-[#141619] tabular-nums mt-1 leading-none">
              {earScore}/3
            </p>
          </div>
        </div>

        {/* Round Progress Bars */}
        <div className="grid grid-cols-3 gap-2" aria-label="Прогресс раундов">
          {rounds.map((r, idx) => {
            const answered = answers[idx];
            let barColor = 'bg-[#EAE8E1]';
            if (answered === true) barColor = 'bg-[#0F5C5C]';
            else if (answered === false) barColor = 'bg-[#E11D48]';
            else if (idx === roundIndex) barColor = 'bg-[#141619]';

            return <div key={r.id} className={`h-1.5 rounded-full transition-colors ${barColor}`} />;
          })}
        </div>

        {/* Contrast Pair Card */}
        <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-3.5 space-y-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
          <div className="flex items-center justify-between gap-2 border-b border-[#E7E5DE] pb-2.5">
            <span className="text-xs font-medium text-[#63666A] truncate">
              Прослушайте оба образца
            </span>
            <span className="font-mono text-[11px] text-[#63666A] tabular-nums shrink-0">
              {customClean || customThroat ? 'Пользовательские файлы' : 'Синтез · 0.6 с'}
            </span>
          </div>

          <div className="space-y-2.5">
            {([1, 2] as const).map((slot) => {
              const isPlaying = playingSlot === slot;
              const isSelected = selectedSlot === slot;
              const isCorrectOption = currentRound.correctSlot === slot;

              let rowClasses = 'border-[#E7E5DE] bg-[#FFFFFF]';
              if (isRoundAnswered) {
                if (isCorrectOption) {
                  rowClasses = 'border-[#0F5C5C] bg-[#E6F2F2]/60';
                } else if (isSelected && !isCorrectOption) {
                  rowClasses = 'border-[#E11D48]/50 bg-[#FFF1F2]';
                }
              }

              return (
                <div
                  key={slot}
                  className={`border rounded-xl p-2.5 flex items-center justify-between gap-2 transition-colors ${rowClasses}`}
                >
                  <button
                    type="button"
                    onClick={() => void handlePlaySlot(slot)}
                    className={`min-h-[44px] px-3 rounded-xl border inline-flex items-center gap-2 text-xs font-semibold transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                      isPlaying
                        ? 'bg-[#0F5C5C] border-[#0F5C5C] text-white'
                        : 'bg-[#F5F4F0] border-[#E7E5DE] text-[#141619] hover:border-[#0F5C5C]'
                    }`}
                  >
                    {isPlaying ? (
                      <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                    ) : (
                      <Volume2 className="w-4 h-4 shrink-0" />
                    )}
                    <span className="whitespace-nowrap">Звук {slot}</span>
                  </button>

                  <div className="flex-1 min-w-0 px-1">
                    <p className="text-[11px] text-[#63666A] truncate">
                      {isRoundAnswered
                        ? isCorrectOption
                          ? 'Чистый вибрант (~26 Гц)'
                          : 'Горловой / щелевой шум'
                        : isPlaying
                          ? 'Воспроизведение...'
                          : 'Нажмите, чтобы сравнить'}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isRoundAnswered}
                    onClick={() => handleChoose(slot)}
                    className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                      isRoundAnswered
                        ? isCorrectOption
                          ? 'bg-[#0F5C5C] text-white'
                          : isSelected
                            ? 'bg-[#E11D48] text-white'
                            : 'bg-[#EAE8E1] text-[#63666A]'
                        : 'bg-[#141619] text-white hover:bg-[#1E2126]'
                    }`}
                  >
                    {isRoundAnswered
                      ? isCorrectOption
                        ? 'Эталон'
                        : isSelected
                          ? 'Шум'
                          : `Звук ${slot}`
                      : `Выбрать ${slot}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Immediate Feedback after selection */}
        {isRoundAnswered && (
          <div
            role="status"
            className={`rounded-2xl border p-3.5 flex items-start gap-2.5 ${
              selectedSlot === currentRound.correctSlot
                ? 'bg-[#E6F2F2] border-[#0F5C5C]/25'
                : 'bg-[#FFF1F2] border-[#FFE4E6]'
            }`}
          >
            {selectedSlot === currentRound.correctSlot ? (
              <CheckCircle2 className="w-4 h-4 text-[#0F5C5C] shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
            )}
            <p className="text-xs leading-relaxed text-[#141619]">
              {selectedSlot === currentRound.correctSlot
                ? `Верно. В «Звук ${currentRound.correctSlot}» слышны 3 четких передних прерывания (~26 Гц) без высокочастотного шипения.`
                : `Чистый передний вибрант был в «Звук ${currentRound.correctSlot}». Во втором образце слышен полосовой шум в зоне 1200–2800 Гц без четких смычек.`}
            </p>
          </div>
        )}

        {/* Collapsible Custom Audio Files Loader (for testing with 2 real audio files) */}
        {debugMode && (
          <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl overflow-hidden shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
            <button
              type="button"
              onClick={() => {
                haptic('light');
                setShowCustomLoader((prev) => !prev);
              }}
              className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-medium text-[#63666A] hover:text-[#141619] transition-colors"
            >
              <span className="inline-flex items-center gap-2 min-w-0 truncate">
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Подгрузить 2 реальных аудиофайла для теста</span>
              </span>
              {showCustomLoader ? (
                <ChevronUp className="w-4 h-4 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 shrink-0" />
              )}
            </button>

            {showCustomLoader && (
              <div className="px-3.5 pb-3.5 pt-2 border-t border-[#E7E5DE] space-y-2.5">
                <input
                  ref={cleanInputRef}
                  type="file"
                  accept=".wav,.mp3,audio/*"
                  onChange={(e) => void handleFileUpload('clean', e)}
                  className="hidden"
                  aria-label="Загрузить файл чистого вибранта"
                />
                <input
                  ref={throatInputRef}
                  type="file"
                  accept=".wav,.mp3,audio/*"
                  onChange={(e) => void handleFileUpload('throat', e)}
                  className="hidden"
                  aria-label="Загрузить файл горлового срыва"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cleanInputRef.current?.click()}
                    className="min-h-[44px] px-2.5 py-2 rounded-xl border border-[#E7E5DE] bg-[#F5F4F0] hover:border-[#0F5C5C] text-left transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#141619]">
                      <Upload className="w-3 h-3 text-[#0F5C5C] shrink-0" />
                      <span className="truncate">Чистый [Р]</span>
                    </div>
                    <p className="text-[10px] text-[#63666A] truncate mt-0.5">
                      {customClean ? customClean.name : 'Синтетический'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => throatInputRef.current?.click()}
                    className="min-h-[44px] px-2.5 py-2 rounded-xl border border-[#E7E5DE] bg-[#F5F4F0] hover:border-[#E11D48] text-left transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#141619]">
                      <Upload className="w-3 h-3 text-[#E11D48] shrink-0" />
                      <span className="truncate">Горловой [Р]</span>
                    </div>
                    <p className="text-[10px] text-[#63666A] truncate mt-0.5">
                      {customThroat ? customThroat.name : 'Синтетический'}
                    </p>
                  </button>
                </div>

                {(customClean || customThroat) && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic('light');
                      stopActiveSound();
                      setCustomClean(null);
                      setCustomThroat(null);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#63666A] hover:text-[#141619]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Вернуть синтетические образцы</span>
                  </button>
                )}

                {uploadError && (
                  <div className="flex items-start gap-2 text-[11px] text-[#E11D48]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-1">
        <button
          type="button"
          disabled={!isRoundAnswered}
          onClick={handleContinue}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] disabled:bg-[#D5D2CA] disabled:text-[#63666A] disabled:shadow-none disabled:cursor-not-allowed active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] focus-visible:ring-offset-2"
        >
          <span>{isLastRound && isAllDone ? 'Открыть профиль старта' : 'Дальше'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
