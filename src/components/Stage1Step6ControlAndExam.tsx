import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  Check,
  CheckCircle2,
  Download,
  Lock,
  Mic,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  AttemptAnalysis,
  SavedAttemptRecord,
  Stage1Progress,
  WorkingKey,
} from '../types/stage1';
import {
  analyzeAttempt,
  audioBufferToWavBlob,
  decodeAudioBlob,
  ensureAudioContextRunning,
  hasAudibleSpeech,
  trimSilence,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';
import { deleteAttemptFromDb, saveAttemptToDb } from '../utils/stage1Db';
import { OscillogramCanvas } from './OscillogramCanvas';

interface AttemptSlotState {
  record: SavedAttemptRecord;
  buffer: AudioBuffer;
  wavUrl: string;
}

interface Stage1Step6ControlAndExamProps {
  showAttemptRecorder: boolean;
  renderMode?: 'attempts' | 'exam' | 'both';
  progress: Stage1Progress;
  attempts: Array<AttemptSlotState | null>;
  examStreak: number;
  stage2Unlocked: boolean;
  isExamUnlocked: boolean;
  onAttemptSaved: (slotIndex: 0 | 1 | 2, item: AttemptSlotState) => void;
  onAttemptDeleted: (slotIndex: 0 | 1 | 2) => void;
  onSelectWorkingKey: (key: WorkingKey) => void;
  onToggleChinSoft: (soft: boolean) => void;
  onSaveDayTraining: () => void;
  sessionJustSaved: boolean;
  onExamMarkClean: () => void;
  onExamMarkReset: () => void;
  onExamResetVictory: () => void;
}

const MAX_ATTEMPT_MS = 3000;

const KEY_CHIPS: Array<{ key: WorkingKey; label: string }> = [
  { key: 1, label: 'Ключ 1: Flap' },
  { key: 2, label: 'Ключ 2: Хватцев' },
  { key: 3, label: 'Ключ 3: Срыв Грибка' },
  { key: 4, label: 'Ключ 4: Кучер' },
];

export function Stage1Step6ControlAndExam({
  showAttemptRecorder,
  renderMode = 'both',
  progress,
  attempts,
  examStreak,
  stage2Unlocked,
  isExamUnlocked,
  onAttemptSaved,
  onAttemptDeleted,
  onSelectWorkingKey,
  onToggleChinSoft,
  onSaveDayTraining,
  sessionJustSaved,
  onExamMarkClean,
  onExamMarkReset,
  onExamResetVictory,
}: Stage1Step6ControlAndExamProps) {
  const [recordingSlot, setRecordingSlot] = useState<0 | 1 | 2 | null>(null);
  const [processingSlot, setProcessingSlot] = useState<0 | 1 | 2 | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorInfo, setErrorInfo] = useState<{ name: string | null; message: string } | null>(
    null
  );

  // Playback state for attempts (slot 0..2 or 'best')
  const [playingTarget, setPlayingTarget] = useState<{
    id: string;
    rate: 1 | 0.5;
  } | null>(null);
  const [playheadProgress, setPlayheadProgress] = useState<number | null>(null);

  // Exam reset notice & optional quick mic check inside exam
  const [examResetNotice, setExamResetNotice] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSlotRef = useRef<0 | 1 | 2>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playRafRef = useRef<number | null>(null);

  const cleanupRecording = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    if (playRafRef.current !== null) {
      window.cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      activeSourceRef.current = null;
    }
    setPlayingTarget(null);
    setPlayheadProgress(null);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.onstop = null;
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      cleanupRecording();
      stopAudioPlayback();
    };
  }, [cleanupRecording, stopAudioPlayback]);

  const processAndPersistBuffer = useCallback(
    async (slotIndex: 0 | 1 | 2, rawBuffer: AudioBuffer) => {
      if (!hasAudibleSpeech(rawBuffer, 0.02)) {
        setErrorInfo({
          name: 'LowAmplitude',
          message: 'Запись слишком тихая или пустая. Попробуйте произнести звук громче.',
        });
        return;
      }

      const trimmed = trimSilence(rawBuffer, 0.025);
      const finalBuffer = trimmed.duration >= 0.06 ? trimmed : trimSilence(rawBuffer, 0.01);

      const analysis: AttemptAnalysis = analyzeAttempt(finalBuffer);
      const wavBlob = audioBufferToWavBlob(finalBuffer);
      const wavUrl = URL.createObjectURL(wavBlob);

      const record: SavedAttemptRecord = {
        id: `attempt_${slotIndex}`,
        slotIndex,
        wavBlob,
        durationSec: finalBuffer.duration,
        createdAt: Date.now(),
        analysis,
      };

      await saveAttemptToDb(record);
      haptic('success');
      onAttemptSaved(slotIndex, { record, buffer: finalBuffer, wavUrl });
    },
    [onAttemptSaved]
  );

  const acquireMicWithFallback = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        cleanupRecording();
        setRecordingSlot(null);
      }
    }
  }, [cleanupRecording]);

  const startRecordingSlot = async (slotIndex: 0 | 1 | 2) => {
    setErrorInfo(null);
    stopAudioPlayback();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setErrorInfo({
        name: 'MediaDevicesUnavailable',
        message: 'Микрофон недоступен в браузере. Загрузите запись с диктофона (.wav/.m4a/.mp3).',
      });
      return;
    }

    try {
      await ensureAudioContextRunning();
      const stream = await acquireMicWithFallback();
      streamRef.current = stream;

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mimeType = candidates.find(
        (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)
      );

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        cleanupRecording();
        setRecordingSlot(null);
        setProcessingSlot(slotIndex);

        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });
          if (blob.size < 256) {
            setErrorInfo({
              name: 'EmptyAudioBlob',
              message: 'Запись пустая. Повторите попытку или загрузите файл.',
            });
            return;
          }
          const rawBuffer = await decodeAudioBlob(blob);
          await processAndPersistBuffer(slotIndex, rawBuffer);
        } catch (err) {
          const name = err instanceof Error ? err.name : 'DecodeError';
          setErrorInfo({
            name,
            message: 'Не удалось декодировать запись микрофона. Попробуйте загрузить аудиофайл.',
          });
        } finally {
          setProcessingSlot(null);
        }
      };

      const startPerf = performance.now();
      setElapsedMs(0);
      setRecordingSlot(slotIndex);
      haptic('medium');
      recorder.start(100);

      timerIntervalRef.current = window.setInterval(() => {
        setElapsedMs(Math.min(MAX_ATTEMPT_MS, performance.now() - startPerf));
      }, 60);

      stopTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_ATTEMPT_MS);
    } catch (err) {
      cleanupRecording();
      setRecordingSlot(null);
      const errName = err instanceof Error && err.name ? err.name : 'UnknownMediaError';
      setErrorInfo({
        name: errName,
        message:
          'Доступ к микрофону ограничен. Используйте кнопку «Загрузить запись с диктофона (.wav/.m4a/.mp3)».',
      });
    }
  };

  const handleOpenFileForSlot = (slotIndex: 0 | 1 | 2) => {
    haptic('light');
    uploadSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const slotIndex = uploadSlotRef.current;

    setErrorInfo(null);
    stopAudioPlayback();
    setProcessingSlot(slotIndex);

    try {
      await ensureAudioContextRunning();
      const rawBuffer = await decodeAudioBlob(file);
      await processAndPersistBuffer(slotIndex, rawBuffer);
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'DecodeError';
      setErrorInfo({
        name: errName,
        message: 'Не удалось открыть аудиофайл (.wav / .m4a / .mp3).',
      });
    } finally {
      setProcessingSlot(null);
      event.target.value = '';
    }
  };

  const handleDeleteSlot = async (slotIndex: 0 | 1 | 2) => {
    haptic('light');
    if (playingTarget?.id === `slot_${slotIndex}`) {
      stopAudioPlayback();
    }
    await deleteAttemptFromDb(`attempt_${slotIndex}`);
    onAttemptDeleted(slotIndex);
  };

  const handlePlayBuffer = async (id: string, buffer: AudioBuffer, rate: 1 | 0.5) => {
    if (playingTarget?.id === id && playingTarget.rate === rate) {
      haptic('light');
      stopAudioPlayback();
      return;
    }

    stopAudioPlayback();
    haptic('light');

    try {
      const ctx = await ensureAudioContextRunning();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(ctx.destination);
      activeSourceRef.current = source;

      const startPerf = performance.now();
      const effectiveDurationMs = Math.max(60, (buffer.duration / rate) * 1000);

      setPlayingTarget({ id, rate });
      setPlayheadProgress(0);

      const tick = () => {
        if (activeSourceRef.current !== source) return;
        const p = Math.min(1, (performance.now() - startPerf) / effectiveDurationMs);
        setPlayheadProgress(p);
        if (p < 1) {
          playRafRef.current = window.requestAnimationFrame(tick);
        }
      };
      playRafRef.current = window.requestAnimationFrame(tick);

      source.onended = () => {
        if (activeSourceRef.current === source) {
          stopAudioPlayback();
        }
      };

      source.start();
    } catch {
      stopAudioPlayback();
    }
  };

  // Pick the best saved attempt (prefer 'flap' badge, otherwise latest saved)
  const bestAttempt = useMemo(() => {
    const valid = attempts.filter((a): a is AttemptSlotState => a !== null);
    if (valid.length === 0) return null;
    const flapOne = valid.find((a) => a.record.analysis.badge === 'flap');
    if (flapOne) return flapOne;
    return [...valid].sort((a, b) => b.record.createdAt - a.record.createdAt)[0];
  }, [attempts]);

  const handleExamCleanClick = () => {
    if (!isExamUnlocked) return;
    setExamResetNotice(false);
    haptic('success');
    onExamMarkClean();
  };

  const handleExamBreakClick = () => {
    if (!isExamUnlocked) return;
    setExamResetNotice(true);
    haptic('medium');
    onExamMarkReset();
  };

  const nextUploadSlot = useMemo<0 | 1 | 2>(() => {
    const emptyIdx = attempts.findIndex((a) => a === null);
    return (emptyIdx === -1 ? 0 : emptyIdx) as 0 | 1 | 2;
  }, [attempts]);

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.m4a,.mp3,audio/*"
        onChange={(e) => void handleFileChange(e)}
        className="hidden"
        aria-label="Загрузить запись с диктофона (.wav/.m4a/.mp3)"
      />

      {/* Section A: Record 3 Best Attempts with Oscillogram, 0.5x Slowdown & DSP Analysis */}
      {showAttemptRecorder && renderMode !== 'exam' && (
      <section
        aria-label="Запись и акустический разбор 3 лучших попыток"
        className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] p-3.5 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-[#141619]">
              Запиши 3 лучшие попытки сессии
            </h3>
            <p className="text-[11px] text-[#63666A] mt-0.5 leading-snug">
              До <span className="font-mono tabular-nums">3</span> сек · Хранится локально в IndexedDB · Замедление <span className="font-mono tabular-nums">0.5x</span> и DSP-разбор
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleOpenFileForSlot(nextUploadSlot)}
            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1 rounded-xl border border-[#E7E5DE] bg-[#F5F4F0] hover:border-[#0F5C5C] text-[11px] font-medium text-[#141619] shrink-0 transition-colors"
            title="Загрузить запись с диктофона (.wav/.m4a/.mp3)"
          >
            <Upload className="w-3.5 h-3.5 text-[#0F5C5C] shrink-0" />
            <span className="hidden sm:inline">С диктофона</span>
            <span className="sm:hidden">Файл</span>
          </button>
        </div>

        {errorInfo && (
          <div
            role="alert"
            className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                {errorInfo.name && (
                  <p className="font-mono text-[11px] font-semibold text-[#E11D48]">
                    Ошибка: {errorInfo.name}
                  </p>
                )}
                <p className="text-xs text-[#141619] leading-snug">{errorInfo.message}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleOpenFileForSlot(nextUploadSlot)}
              className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-[#FFFFFF] border border-[#E7E5DE] hover:border-[#0F5C5C] text-xs font-semibold text-[#141619] flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-[#0F5C5C]" />
              <span>Загрузить запись с диктофона (.wav/.m4a/.mp3)</span>
            </button>
          </div>
        )}

        <div className="space-y-3">
          {([0, 1, 2] as const).map((slotIdx) => {
            const item = attempts[slotIdx];
            const isRecThis = recordingSlot === slotIdx;
            const isProcThis = processingSlot === slotIdx;
            const slotId = `slot_${slotIdx}`;
            const isPlaying1x = playingTarget?.id === slotId && playingTarget.rate === 1;
            const isPlayingHalf = playingTarget?.id === slotId && playingTarget.rate === 0.5;
            const activePlayhead = playingTarget?.id === slotId ? playheadProgress : null;

            return (
              <div
                key={slotIdx}
                className="border border-[#E7E5DE] rounded-2xl p-3 bg-[#F5F4F0] space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#141619]">
                    Попытка <span className="font-mono tabular-nums">{slotIdx + 1}</span>
                  </span>

                  {item ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-[#63666A] tabular-nums">
                        {item.record.durationSec.toFixed(2)} с
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenFileForSlot(slotIdx)}
                        className="min-h-[32px] px-2 rounded-lg text-[11px] font-medium text-[#63666A] hover:text-[#0F5C5C] hover:bg-[#FFFFFF] transition-colors"
                        title="Заменить файлом"
                      >
                        Файл
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSlot(slotIdx)}
                        className="min-h-[32px] min-w-[32px] rounded-lg flex items-center justify-center text-[#63666A] hover:text-[#E11D48] hover:bg-[#FFFFFF] transition-colors"
                        aria-label={`Удалить попытку ${slotIdx + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-[#63666A] tabular-nums">до 3.0 с</span>
                  )}
                </div>

                {!item ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isProcThis || (recordingSlot !== null && !isRecThis)}
                      onClick={() => {
                        if (isRecThis) stopRecording();
                        else void startRecordingSlot(slotIdx);
                      }}
                      className={`flex-1 min-h-[44px] px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
                        isRecThis
                          ? 'bg-[#E11D48] text-white'
                          : 'bg-[#141619] text-white hover:bg-[#1E2126] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_16px_-6px_rgba(20,22,25,0.3)] active:scale-[0.98]'
                      }`}
                    >
                      {isProcThis ? (
                        <span>Анализ RMS и ZCR...</span>
                      ) : isRecThis ? (
                        <>
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>Стоп</span>
                          <span className="font-mono tabular-nums">
                            {(elapsedMs / 1000).toFixed(1)} / 3.0 с
                          </span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-3.5 h-3.5 text-[#2DD4BF]" />
                          <span>Записать попытку {slotIdx + 1}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isProcThis || recordingSlot !== null}
                      onClick={() => handleOpenFileForSlot(slotIdx)}
                      className="min-h-[44px] px-2.5 rounded-xl border border-[#E7E5DE] bg-[#FFFFFF] hover:border-[#0F5C5C] text-xs font-medium text-[#141619] shrink-0 transition-colors disabled:opacity-50"
                      aria-label={`Загрузить файл в попытку ${slotIdx + 1}`}
                    >
                      <Upload className="w-3.5 h-3.5 text-[#0F5C5C]" />
                    </button>
                  </div>
                ) : (
                  <>
                    <OscillogramCanvas
                      buffer={item.buffer}
                      color="#2DD4BF"
                      playheadProgress={activePlayhead}
                      ariaLabel={`Осциллограмма попытки ${slotIdx + 1}`}
                    />

                    {/* Objective DSP Badge & Metrics */}
                    <div
                      className={`rounded-xl px-2.5 py-2 border text-xs space-y-1 ${
                        item.record.analysis.badge === 'flap'
                          ? 'bg-[#E6F2F2] border-[#0F5C5C]/25 text-[#141619]'
                          : item.record.analysis.badge === 'noise'
                            ? 'bg-[#FFF1F2] border-[#FFE4E6] text-[#141619]'
                            : 'bg-[#FFFFFF] border-[#E7E5DE] text-[#141619]'
                      }`}
                    >
                      <p className="font-semibold leading-snug">
                        {item.record.analysis.label}
                      </p>
                      <p className="font-mono text-[10px] text-[#63666A] tabular-nums">
                        ZCR: {(item.record.analysis.meanZcr * 100).toFixed(1)}% · Шум:{' '}
                        {item.record.analysis.maxNoiseStreakMs} мс
                        {item.record.analysis.detectedClosureMs !== null
                          ? ` · Смычка: ~${item.record.analysis.detectedClosureMs} мс`
                          : ''}
                      </p>
                    </div>

                    {/* 1x & 0.5x Playback Controls + Re-record */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handlePlayBuffer(slotId, item.buffer, 1)}
                        className={`min-h-[40px] px-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          isPlaying1x
                            ? 'bg-[#0F5C5C] border-[#0F5C5C] text-white'
                            : 'bg-[#FFFFFF] border-[#E7E5DE] text-[#141619] hover:border-[#0F5C5C]'
                        }`}
                      >
                        {isPlaying1x ? (
                          <Square className="w-3 h-3 fill-current shrink-0" />
                        ) : (
                          <Play className="w-3 h-3 fill-current shrink-0" />
                        )}
                        <span className="font-mono tabular-nums">1x</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handlePlayBuffer(slotId, item.buffer, 0.5)}
                        className={`min-h-[40px] px-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                          isPlayingHalf
                            ? 'bg-[#141619] border-[#141619] text-[#2DD4BF]'
                            : 'bg-[#FFFFFF] border-[#E7E5DE] text-[#141619] hover:border-[#0F5C5C]'
                        }`}
                      >
                        {isPlayingHalf ? (
                          <Square className="w-3 h-3 fill-current shrink-0" />
                        ) : (
                          <Play className="w-3 h-3 fill-current shrink-0" />
                        )}
                        <span className="whitespace-nowrap">
                          Замедлить <span className="font-mono tabular-nums">0.5x</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={recordingSlot !== null}
                        onClick={() => void startRecordingSlot(slotIdx)}
                        className="min-h-[40px] px-2 rounded-xl border border-[#E7E5DE] bg-[#FFFFFF] hover:border-[#0F5C5C] text-xs font-medium text-[#63666A] hover:text-[#141619] flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3 shrink-0" />
                        <span>Заново</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Session Key Choice Chips + Soft Chin Checkbox + Save Day Training */}
        <div className="pt-2 border-t border-[#E7E5DE] space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#141619]">
              Какой ключ сегодня сработал лучше всего?
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {KEY_CHIPS.map((chip) => {
                const selected = progress.workingKey === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => {
                      haptic('light');
                      onSelectWorkingKey(chip.key);
                    }}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl border text-left text-xs font-semibold transition-colors ${
                      selected
                        ? 'bg-[#0F5C5C] border-[#0F5C5C] text-white'
                        : 'bg-[#F5F4F0] border-[#E7E5DE] text-[#141619] hover:border-[#0F5C5C]/40'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2.5 min-h-[44px] px-3 py-2 rounded-xl border border-[#E7E5DE] bg-[#F5F4F0] cursor-pointer">
            <input
              type="checkbox"
              checked={progress.chinWasSoft}
              onChange={(e) => {
                haptic('light');
                onToggleChinSoft(e.target.checked);
              }}
              className="w-4 h-4 accent-[#0F5C5C] rounded shrink-0"
            />
            <span className="text-xs font-medium text-[#141619]">
              Под подбородком было мягко и тихо
            </span>
          </label>

          <button
            type="button"
            onClick={() => {
              haptic('success');
              onSaveDayTraining();
            }}
            className="w-full h-11 rounded-2xl bg-[#141619] hover:bg-[#1E2126] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] active:scale-[0.98] transition-all"
          >
            <CheckCircle2 className="w-4 h-4 text-[#2DD4BF] shrink-0" />
            <span>
              Сохранить сессию (День <span className="font-mono tabular-nums">{progress.day}</span> ·{' '}
              {progress.sessionTime === 'morning' ? 'Утро' : 'Вечер'})
            </span>
          </button>

          {sessionJustSaved && (
            <p className="text-[11px] font-medium text-[#0F5C5C] text-center">
              Тренировка сохранена в IndexedDB. Всего завершено сессий:{' '}
              <span className="font-mono tabular-nums">{progress.completedSessions}</span>.
            </p>
          )}
        </div>
      </section>
      )}

      {/* Section B: Stage 2 Readiness Exam ("6 out of 6 in a row") */}
      {renderMode !== 'attempts' && (
      <section
        aria-label="Тест готовности к Этапу 2"
        className={`border rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] p-3.5 space-y-3 transition-opacity ${
          stage2Unlocked
            ? 'bg-[#E6F2F2] border-[#0F5C5C]/25'
            : isExamUnlocked
              ? 'bg-[#FFFFFF] border-[#E7E5DE]'
              : 'bg-[#FFFFFF] border-[#E7E5DE] opacity-60'
        }`}
      >
        {stage2Unlocked ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-[#0F5C5C] text-white flex items-center justify-center shrink-0">
                  <Award className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-[#0F5C5C] truncate">
                  Этап 1 сдан (<span className="font-mono tabular-nums">6/6</span>)
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  haptic('light');
                  setExamResetNotice(false);
                  onExamResetVictory();
                }}
                className="min-h-[34px] px-2.5 py-1 rounded-xl border border-[#0F5C5C]/25 bg-[#FFFFFF] hover:border-[#0F5C5C] text-[11px] font-semibold text-[#141619] shrink-0 transition-colors"
              >
                Пересдать экзамен
              </button>
            </div>

            {bestAttempt && (
              <div className="flex items-center gap-2 pt-2 border-t border-[#0F5C5C]/20">
                <button
                  type="button"
                  onClick={() => void handlePlayBuffer('best_victory', bestAttempt.buffer, 1)}
                  className="min-h-[36px] px-2.5 rounded-xl bg-[#141619] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  {playingTarget?.id === 'best_victory' ? (
                    <Square className="w-3 h-3 fill-current" />
                  ) : (
                    <Play className="w-3 h-3 fill-current text-[#2DD4BF]" />
                  )}
                  <span>Слушать лучшую</span>
                </button>

                <a
                  href={bestAttempt.wavUrl}
                  download={`etap-1-best-day-${progress.day}.wav`}
                  onClick={() => haptic('light')}
                  className="flex-1 min-h-[36px] px-2.5 rounded-xl border border-[#0F5C5C]/25 bg-[#FFFFFF] hover:border-[#0F5C5C] text-[11px] font-semibold text-[#141619] inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#0F5C5C] shrink-0" />
                  <span className="truncate">Скачать лучшую (.wav)</span>
                </a>
              </div>
            )}
          </div>
        ) : (
          <>
            {!isExamUnlocked && (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#EAE8E1] border border-[#E7E5DE] text-[#63666A]">
                <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold leading-snug">
                  Откроется после прохождения шагов тренировки (на Шаге 6)
                </span>
              </div>
            )}

            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[11px] font-semibold text-[#0F5C5C]">
                  Экзамен перехода · Критерий SMC
                </p>
                <h3 className="text-sm font-semibold tracking-tight text-[#141619]">
                  Тест готовности к Этапу 2 (Серия <span className="font-mono tabular-nums">6 из 6</span>)
                </h3>
              </div>

              <span className="font-mono text-sm font-bold text-[#141619] tabular-nums shrink-0">
                {examStreak}/6
              </span>
            </div>

            <p className="text-xs leading-relaxed text-[#63666A]">
              Произнесите короткий слог ТРА или ДРА <span className="font-mono tabular-nums">6</span> раз подряд с паузой в секунду при абсолютно мягком подбородке.
            </p>

            {/* 6 Attempt Circles */}
            <div className="grid grid-cols-6 gap-2 py-1" aria-label="Слоты серии 6 из 6">
              {[1, 2, 3, 4, 5, 6].map((num) => {
                const filled = num <= examStreak;
                const isNext = isExamUnlocked && num === examStreak + 1;
                return (
                  <div
                    key={num}
                    className={`aspect-square rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold tabular-nums transition-colors ${
                      filled
                        ? 'bg-[#0F5C5C] border-[#0F5C5C] text-white'
                        : isNext
                          ? 'bg-[#E6F2F2] border-[#0F5C5C] text-[#0F5C5C]'
                          : 'bg-[#F5F4F0] border-[#E7E5DE] text-[#63666A]'
                    }`}
                  >
                    {filled ? <Check className="w-4 h-4" /> : num}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!isExamUnlocked}
                onClick={handleExamCleanClick}
                className="min-h-[48px] px-2.5 py-2 rounded-2xl bg-[#0F5C5C] hover:bg-[#0C4A4A] disabled:bg-[#EAE8E1] disabled:text-[#63666A] disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="leading-tight text-center">Чистый передний щелчок</span>
              </button>

              <button
                type="button"
                disabled={!isExamUnlocked}
                onClick={handleExamBreakClick}
                className="min-h-[48px] px-2.5 py-2 rounded-2xl border border-[#FFE4E6] bg-[#FFF1F2] hover:bg-[#FFE4E6]/70 disabled:border-[#E7E5DE] disabled:bg-[#F5F4F0] disabled:text-[#63666A] disabled:cursor-not-allowed text-[#E11D48] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <XCircle className="w-4 h-4 shrink-0" />
                <span className="leading-tight text-center">Срыв в горло / мимо</span>
              </button>
            </div>

            {examResetNotice && (
              <p className="text-[11px] font-medium text-[#E11D48] leading-snug">
                Срыв зафиксирован — счетчик серии сброшен на <span className="font-mono tabular-nums">0</span> по протоколу SMC, чтобы не закреплять горловой навык.
              </p>
            )}
          </>
        )}
      </section>
      )}
    </div>
  );
}
