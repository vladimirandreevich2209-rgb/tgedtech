import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import step3NeckSensorImg from '@/step3-neck-sensor.webp';
import { NeckVibration } from '../types/diagnostic';
import {
  audioBufferToWavBlob,
  decodeAudioBlob,
  ensureAudioContextRunning,
  generateSimulatedThroatRecordingBuffer,
  hasAudibleSpeech,
  trimSilence,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';

interface Step3TactileRecordProps {
  debugMode?: boolean;
  recordedAudioUrl: string | null;
  recordedBuffer: AudioBuffer | null;
  neckVibration: NeckVibration;
  onRecordComplete: (audioUrl: string, trimmedBuffer: AudioBuffer) => void;
  onResetRecording: () => void;
  onSelectVibration: (value: 'throat' | 'front' | 'unsure') => void;
  onNext: () => void;
}

const MAX_RECORDING_MS = 4000;
const VIBRATION_OPTIONS: Array<{
  value: 'throat' | 'front' | 'unsure';
  label: string;
}> = [
  { value: 'throat', label: 'Да, вибрирует в горле' },
  { value: 'front', label: 'Нет, только у зубов' },
  { value: 'unsure', label: 'Сложно понять' },
];

export function Step3TactileRecord({
  debugMode = false,
  recordedAudioUrl,
  recordedBuffer,
  neckVibration,
  onRecordComplete,
  onResetRecording,
  onSelectVibration,
  onNext,
}: Step3TactileRecordProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveLevel, setLiveLevel] = useState(0);
  const [errorInfo, setErrorInfo] = useState<{ name: string | null; message: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const cleanupRecordingResources = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (analyserSourceRef.current) {
      try {
        analyserSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserSourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setLiveLevel(0);
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
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        cleanupRecordingResources();
        setIsRecording(false);
      }
    }
  }, [cleanupRecordingResources]);

  const acquireMicStreamWithFallback = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      // Fallback: request standard audio constraints if raw DSP constraints fail
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  };

  const startRecording = async () => {
    setErrorInfo(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setErrorInfo({
        name: 'MediaDevicesUnavailable',
        message: debugMode
          ? 'API микрофона недоступно в текущем контексте браузера или iframe. Используйте загрузку файла или симуляцию ниже.'
          : 'API микрофона недоступно в текущем контексте браузера. Вы можете загрузить готовый аудиофайл с устройства.',
      });
      return;
    }

    try {
      const ctx = await ensureAudioContextRunning();
      const stream = await acquireMicStreamWithFallback();
      streamRef.current = stream;

      // Live volume meter via Web Audio AnalyserNode
      const source = ctx.createMediaStreamSource(stream);
      analyserSourceRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const timeDomainData = new Float32Array(analyser.fftSize);
      const updateMeter = () => {
        analyser.getFloatTimeDomainData(timeDomainData);
        let sumSquares = 0;
        let peak = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          const v = timeDomainData[i];
          sumSquares += v * v;
          const abs = Math.abs(v);
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sumSquares / timeDomainData.length);
        const normalized = Math.min(1, Math.max(rms * 5.5, peak * 1.4));
        setLiveLevel(normalized);
        rafIdRef.current = window.requestAnimationFrame(updateMeter);
      };
      rafIdRef.current = window.requestAnimationFrame(updateMeter);

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mimeType = candidates.find(
        (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)
      );

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        cleanupRecordingResources();
        setIsRecording(false);
        setIsProcessing(true);

        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });

          if (blob.size < 256) {
            setErrorInfo({
              name: 'EmptyAudioBlob',
              message:
                'Запись оказалась пустой. Нажмите «Записать» и произнесите слова громче, или используйте обходной путь ниже.',
            });
            setIsProcessing(false);
            return;
          }

          const rawBuffer = await decodeAudioBlob(blob);

          if (!hasAudibleSpeech(rawBuffer, 0.025)) {
            setErrorInfo({
              name: 'LowAmplitude',
              message:
                'Запись слишком тихая или пустая. Поднесите телефон ближе ко рту и произнесите «ТРАКТОР — РАК» громче.',
            });
            setIsProcessing(false);
            return;
          }

          const trimmed = trimSilence(rawBuffer, 0.025);
          if (!hasAudibleSpeech(trimmed, 0.025) || trimmed.duration < 0.08) {
            setErrorInfo({
              name: 'TrimmedTooShort',
              message:
                'Не удалось выделить четкий речевой сигнал. Запишите фразу чуть громче или загрузите готовое аудио.',
            });
            setIsProcessing(false);
            return;
          }

          const objectUrl = URL.createObjectURL(blob);
          haptic('success');
          onRecordComplete(objectUrl, trimmed);
        } catch (decodeErr) {
          const errName = decodeErr instanceof Error ? decodeErr.name : 'DecodeError';
          setErrorInfo({
            name: errName,
            message: 'Не удалось обработать аудиосигнал. Попробуйте еще раз или загрузите файл.',
          });
        } finally {
          setIsProcessing(false);
        }
      };

      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setIsRecording(true);
      haptic('medium');
      recorder.start(100);

      timerIntervalRef.current = window.setInterval(() => {
        const diff = performance.now() - startedAtRef.current;
        setElapsedMs(Math.min(MAX_RECORDING_MS, diff));
      }, 60);

      stopTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (err) {
      cleanupRecordingResources();
      setIsRecording(false);
      const errName =
        err instanceof Error && err.name ? err.name : 'UnknownMediaError';
      const isDenied = errName === 'NotAllowedError' || errName === 'PermissionDeniedError';
      setErrorInfo({
        name: errName,
        message: isDenied
          ? debugMode
            ? 'Доступ к микрофону заблокирован браузером или iframe-песочницей. Вы можете загрузить готовый файл с устройства или симулировать запись для теста.'
            : 'Доступ к микрофону заблокирован браузером. Разрешите микрофон в настройках или загрузите готовый аудиофайл с устройства.'
          : debugMode
            ? 'Не удалось запустить запись с микрофона. Вы можете загрузить готовый файл или симулировать запись ниже.'
            : 'Не удалось запустить запись с микрофона. Вы можете загрузить готовый аудиофайл с устройства.',
      });
    }
  };

  const handleToggleRecord = () => {
    if (isProcessing) return;
    if (isRecording) {
      haptic('light');
      stopRecording();
    } else {
      void startRecording();
    }
  };

  const handleReRecord = () => {
    haptic('light');
    setElapsedMs(0);
    setErrorInfo(null);
    onResetRecording();
  };

  const handleUploadAudioFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorInfo(null);
    setIsProcessing(true);

    try {
      await ensureAudioContextRunning();
      const rawBuffer = await decodeAudioBlob(file);

      if (!hasAudibleSpeech(rawBuffer, 0.015)) {
        setErrorInfo({
          name: 'LowAmplitude',
          message:
            'Выбранный аудиофайл слишком тихий или не содержит речи. Попробуйте другой файл.',
        });
        setIsProcessing(false);
        return;
      }

      const trimmed = trimSilence(rawBuffer, 0.025);
      const finalBuffer = trimmed.duration >= 0.08 ? trimmed : trimSilence(rawBuffer, 0.01);
      const wavBlob = audioBufferToWavBlob(finalBuffer);
      const objectUrl = URL.createObjectURL(wavBlob);

      haptic('success');
      onRecordComplete(objectUrl, finalBuffer);
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'DecodeError';
      setErrorInfo({
        name: errName,
        message: 'Не удалось декодировать аудиофайл (.wav / .mp3 / .m4a). Попробуйте другой формат.',
      });
    } finally {
      setIsProcessing(false);
      event.target.value = '';
    }
  };

  const handleSimulateThroatRecording = async () => {
    setErrorInfo(null);
    setIsProcessing(true);

    try {
      const ctx = await ensureAudioContextRunning();
      const rawSimulated = generateSimulatedThroatRecordingBuffer(ctx.sampleRate);
      const trimmed = trimSilence(rawSimulated, 0.025);
      const wavBlob = audioBufferToWavBlob(trimmed);
      const objectUrl = URL.createObjectURL(wavBlob);

      haptic('success');
      onRecordComplete(objectUrl, trimmed);
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'AudioSimulationError';
      setErrorInfo({
        name: errName,
        message: 'Не удалось сгенерировать тестовый аудиосигнал.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const secondsValue = (Math.min(MAX_RECORDING_MS, elapsedMs) / 1000).toFixed(1);
  const isRecorded = Boolean(recordedAudioUrl && recordedBuffer);
  const meterBarsCount = 16;

  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-4 gap-3.5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.m4a,audio/*"
        onChange={(e) => void handleUploadAudioFile(e)}
        className="hidden"
        aria-label="Загрузить готовое аудио (.wav / .mp3 / .m4a)"
      />

      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#63666A]">
            Тактильный маркер · Запись «Точки А»
          </p>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[#141619] text-balance leading-snug">
            Где возникает дрожь при произнесении
          </h2>
        </div>

        <img
          src={step3NeckSensorImg}
          alt="Два пальца на верхней части шеи под челюстью"
          referrerPolicy="no-referrer"
          className="object-cover w-full aspect-[4/3] rounded-2xl border border-[#E7E5DE] bg-[#FFFFFF] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]"
        />

        <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-3.5 space-y-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
          <p className="text-[13px] sm:text-sm leading-snug text-[#141619]">
            Положите пальцы на шею под челюстью. Нажмите запись и четко скажите:{' '}
            <span className="font-semibold tracking-wide text-[#141619]">ТРАКТОР — РАК</span>
          </p>

          {!isRecorded ? (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleToggleRecord}
                className={`w-full h-12 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] disabled:opacity-60 ${
                  isRecording
                    ? 'bg-[#E11D48] text-white hover:bg-[#BE123C] shadow-[0_8px_20px_-6px_rgba(225,29,72,0.4)]'
                    : 'bg-[#141619] text-white hover:bg-[#1E2126] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)]'
                }`}
              >
                {isProcessing ? (
                  <span>Анализ и обрезка тишины...</span>
                ) : isRecording ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Остановить запись</span>
                    <span className="font-mono text-xs tabular-nums opacity-95">
                      {secondsValue} / 4.0 с
                    </span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-[#2DD4BF]" />
                    <span>Записать «ТРАКТОР — РАК»</span>
                  </>
                )}
              </button>

              {isRecording && (
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <div
                      className="flex items-center gap-1 h-6 flex-1"
                      aria-label="Уровень громкости микрофона"
                    >
                      {Array.from({ length: meterBarsCount }).map((_, idx) => {
                        const threshold = (idx + 1) / meterBarsCount;
                        const active = liveLevel >= threshold * 0.85;
                        return (
                          <span
                            key={idx}
                            className={`flex-1 h-4 rounded-sm transition-colors duration-75 ${
                              active
                                ? idx > 11
                                  ? 'bg-[#E11D48]'
                                  : 'bg-[#0F5C5C]'
                                : 'bg-[#EAE8E1]'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <span className="font-mono text-[11px] text-[#63666A] tabular-nums shrink-0">
                      до 4 сек
                    </span>
                  </div>
                </div>
              )}

              {/* Subtle sandbox links directly under main record button */}
              {!isRecording && (
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-0.5">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      haptic('light');
                      fileInputRef.current?.click();
                    }}
                    className="text-[11px] font-medium text-[#63666A] hover:text-[#0F5C5C] underline underline-offset-2 py-1 transition-colors"
                  >
                    Загрузить готовое аудио (.wav / .mp3 / .m4a)
                  </button>
                  {debugMode && (
                    <>
                      <span className="text-[11px] text-[#D5D2CA]" aria-hidden="true">
                        ·
                      </span>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => void handleSimulateThroatRecording()}
                        className="text-[11px] font-medium text-[#63666A] hover:text-[#0F5C5C] underline underline-offset-2 py-1 transition-colors"
                      >
                        Симулировать запись (горловой срыв)
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Error Card with exact err.name + fallback actions */}
              {errorInfo && (
                <div
                  role="alert"
                  className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3.5 space-y-3"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      {errorInfo.name && (
                        <p className="font-mono text-[11px] font-semibold text-[#E11D48]">
                          Ошибка: {errorInfo.name}
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-[#141619]">
                        {errorInfo.message}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-1 border-t border-[#FFE4E6]">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => {
                        haptic('light');
                        fileInputRef.current?.click();
                      }}
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#FFFFFF] border border-[#E7E5DE] hover:border-[#0F5C5C] text-xs font-semibold text-[#141619] flex items-center justify-center gap-2 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#0F5C5C] shrink-0" />
                      <span className="truncate">Загрузить готовое аудио (.wav / .mp3 / .m4a)</span>
                    </button>

                    {debugMode && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => void handleSimulateThroatRecording()}
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#FFFFFF] border border-[#E7E5DE] hover:border-[#0F5C5C] text-xs font-semibold text-[#141619] flex items-center justify-center gap-2 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#0F5C5C] shrink-0" />
                        <span className="truncate">Симулировать запись (горловой срыв)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 bg-[#E6F2F2] border border-[#0F5C5C]/25 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-[#0F5C5C] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#141619] truncate">
                    Точка А записана и обрезана
                  </p>
                  <p className="font-mono text-[11px] text-[#0F5C5C] tabular-nums">
                    Активная речь: {recordedBuffer?.duration.toFixed(2)} сек
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReRecord}
                className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#0F5C5C] hover:bg-[#0F5C5C]/10 transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Перезаписать</span>
              </button>
            </div>
          )}
        </div>

        {isRecorded && (
          <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-4 space-y-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
            <p className="text-sm font-semibold text-[#141619]">
              Чувствовали дрожь под пальцами на звуке [Р]?
            </p>

            <div className="space-y-2">
              {VIBRATION_OPTIONS.map((opt) => {
                const isSelected = neckVibration === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      haptic('light');
                      onSelectVibration(opt.value);
                    }}
                    className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left text-sm font-medium flex items-center justify-between transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                      isSelected
                        ? 'border-[#0F5C5C] bg-[#E6F2F2]/70 text-[#141619]'
                        : 'border-[#E7E5DE] bg-[#FFFFFF] text-[#141619] hover:border-[#B5B2A8]'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-[#0F5C5C]' : 'border-[#C7C4BA]'
                      }`}
                    >
                      {isSelected && <span className="w-2 h-2 rounded-full bg-[#0F5C5C]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="pt-1">
        <button
          type="button"
          disabled={!isRecorded || !neckVibration}
          onClick={() => {
            haptic('light');
            onNext();
          }}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] disabled:bg-[#D5D2CA] disabled:text-[#63666A] disabled:shadow-none disabled:cursor-not-allowed active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] focus-visible:ring-offset-2"
        >
          <span>Дальше</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
