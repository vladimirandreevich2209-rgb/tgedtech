import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import coachAvatarImg from '@/coach-avatar.webp';
import { DiagnosticState } from '../types/diagnostic';
import {
  audioBufferToWavBlob,
  ensureAudioContextRunning,
} from '../utils/audioEngine';
import { haptic } from '../utils/haptic';

interface Step6SummaryPaywallProps {
  state: DiagnosticState;
  onRestart: () => void;
  onStartStage1: () => void;
}

type PlanId = 'sprint' | 'hybrid';

export function Step6SummaryPaywall({
  state,
  onRestart,
  onStartStage1,
}: Step6SummaryPaywallProps) {
  const isRestrictedFrenulum = state.frenulumStatus === 'restricted';

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('hybrid');
  const [checkoutSubmitted, setCheckoutSubmitted] = useState(false);

  // Patient #0 Point A mini-player state
  const [isPlayingPointA, setIsPlayingPointA] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const wavBlob = useMemo(() => {
    if (!state.recordedBuffer) return null;
    return audioBufferToWavBlob(state.recordedBuffer);
  }, [state.recordedBuffer]);

  const wavDownloadUrl = useMemo(() => {
    if (!wavBlob) return null;
    return URL.createObjectURL(wavBlob);
  }, [wavBlob]);

  useEffect(() => {
    return () => {
      if (wavDownloadUrl) {
        URL.revokeObjectURL(wavDownloadUrl);
      }
    };
  }, [wavDownloadUrl]);

  const stopPointAPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
        sourceRef.current.disconnect();
      } catch {
        // Ignore if already stopped
      }
      sourceRef.current = null;
    }
    setIsPlayingPointA(false);
    setPlayProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      stopPointAPlayback();
    };
  }, [stopPointAPlayback]);

  const handleTogglePlayPointA = async () => {
    if (!state.recordedBuffer) return;

    if (isPlayingPointA) {
      haptic('light');
      stopPointAPlayback();
      return;
    }

    haptic('light');
    try {
      const ctx = await ensureAudioContextRunning();
      const buffer = state.recordedBuffer;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      sourceRef.current = source;

      const startPerf = performance.now();
      const durationMs = Math.max(50, buffer.duration * 1000);

      setIsPlayingPointA(true);
      setPlayProgress(0);

      const updateProgress = () => {
        const elapsed = performance.now() - startPerf;
        const p = Math.min(1, elapsed / durationMs);
        setPlayProgress(p);
        if (p < 1 && sourceRef.current === source) {
          rafRef.current = window.requestAnimationFrame(updateProgress);
        }
      };
      rafRef.current = window.requestAnimationFrame(updateProgress);

      source.onended = () => {
        if (sourceRef.current === source) {
          stopPointAPlayback();
        }
      };

      source.start();
    } catch {
      stopPointAPlayback();
    }
  };

  const anatomyText =
    state.frenulumStatus === 'normal'
      ? 'Норма (тест «Грибок» пройден)'
      : state.frenulumStatus === 'restricted'
        ? 'Ограничение подъязычной связки'
        : 'Не указано';

  const articulationText =
    state.neckVibration === 'throat'
      ? 'Горловой [Р] (вибрация под челюстью)'
      : state.neckVibration === 'front'
        ? 'Передний уклад (без устойчивой дрожи)'
        : 'Смешанный / требует калибровки';

  const handleSelectPlan = (plan: PlanId) => {
    haptic('light');
    setSelectedPlan(plan);
    setCheckoutSubmitted(false);
  };

  const handleCheckout = () => {
    haptic('success');
    setCheckoutSubmitted(true);
    onStartStage1();
  };

  const recordedDuration = state.recordedBuffer?.duration ?? 0;

  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-5 gap-5">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <img
            src={coachAvatarImg}
            alt="Речевой тренер протокола SMC"
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-full object-cover border border-[#E7E5DE] shrink-0"
          />
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-medium text-[#63666A] truncate">
              Результаты Блока <span className="font-mono tabular-nums">0</span> · Персональное заключение
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-[#141619] text-balance leading-tight">
              Ваш профиль старта
            </h2>
          </div>
        </div>

        {/* Dynamic Diagnostic Summary */}
        <section
          aria-label="Сводка диагностики"
          className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl divide-y divide-[#E7E5DE] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]"
        >
          <div className="px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[#63666A] shrink-0">Анатомия</span>
            <span
              className={`text-xs font-semibold text-right min-w-0 break-words ${
                isRestrictedFrenulum ? 'text-[#E11D48]' : 'text-[#141619]'
              }`}
            >
              {anatomyText}
            </span>
          </div>

          <div className="px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[#63666A] shrink-0">Тип артикуляции</span>
            <span className="text-xs font-semibold text-[#141619] text-right min-w-0 break-words">
              {articulationText}
            </span>
          </div>

          <div className="px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[#63666A] shrink-0">Слуховой контроль</span>
            <span className="font-mono text-xs font-semibold text-[#141619] tabular-nums text-right">
              {state.earScore}/3
            </span>
          </div>

          <div className="px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[#63666A] shrink-0">Прогноз по протоколу SMC</span>
            <span className="font-mono text-xs font-semibold text-[#0F5C5C] tabular-nums text-right">
              14–21 день по 10 мин
            </span>
          </div>
        </section>

        {/* Patient #0 Card: Point A Mini-Player & .wav Download */}
        <section
          aria-label="Запись вашей Точки А"
          className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-3.5 space-y-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#141619] truncate">
                Запись вашей Точки А
              </p>
              <p className="text-[11px] text-[#63666A] truncate">
                Режим «Пациент №<span className="font-mono tabular-nums">0</span>» · Эталон День <span className="font-mono tabular-nums">0</span> (PCM 16-bit)
              </p>
            </div>
            {state.recordedBuffer && (
              <span className="font-mono text-[11px] font-medium text-[#63666A] tabular-nums shrink-0">
                {recordedDuration.toFixed(2)} с
              </span>
            )}
          </div>

          {state.recordedBuffer && wavDownloadUrl ? (
            <div className="space-y-2.5">
              {/* Mini-player */}
              <div className="bg-[#F5F4F0] border border-[#E7E5DE] rounded-xl p-2 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleTogglePlayPointA()}
                  className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                    isPlayingPointA
                      ? 'bg-[#141619] text-[#2DD4BF]'
                      : 'bg-[#0F5C5C] text-white hover:bg-[#0D4F4F]'
                  }`}
                  aria-label={isPlayingPointA ? 'Остановить Точку А' : 'Прослушать Точку А'}
                >
                  {isPlayingPointA ? (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="h-1.5 w-full bg-[#EAE8E1] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0F5C5C] rounded-full transition-none"
                      style={{ width: `${Math.round(playProgress * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#63666A] tabular-nums">
                    <span>
                      {(playProgress * recordedDuration).toFixed(2)} с
                    </span>
                    <span>{recordedDuration.toFixed(2)} с</span>
                  </div>
                </div>
              </div>

              {/* Download .wav button */}
              <a
                href={wavDownloadUrl}
                download="tochka-a-day-0.wav"
                onClick={() => haptic('light')}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E7E5DE] bg-[#FFFFFF] hover:border-[#0F5C5C] hover:text-[#0F5C5C] text-xs font-semibold text-[#141619] flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C]"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Скачать Точку А (.wav)</span>
              </a>
            </div>
          ) : (
            <p className="text-xs text-[#63666A] leading-relaxed">
              Запись еще не создана. Вернитесь на Шаг 3, чтобы записать «Точку А» для сохранения.
            </p>
          )}
        </section>

        {/* Highlighted Specialist Recommendation if Frenulum is Restricted */}
        {isRestrictedFrenulum && (
          <div
            role="alert"
            className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3.5 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-[#141619]">
              <p className="font-semibold">
                Начните с очной или видео-проверки у специалиста
              </p>
              <p className="text-[#63666A] mt-0.5">
                При укороченной уздечке важно сначала оценить запас растяжения связки с логопедом, чтобы не перегружать мышцы дна рта.
              </p>
            </div>
          </div>
        )}

        {/* Two Tariff Cards */}
        <div className="space-y-3" role="radiogroup" aria-label="Выбор тарифа">
          {/* Plan 1: Sprint SMC */}
          <button
            type="button"
            role="radio"
            aria-checked={selectedPlan === 'sprint'}
            onClick={() => handleSelectPlan('sprint')}
            className={`w-full text-left bg-[#FFFFFF] rounded-2xl p-3.5 border shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
              selectedPlan === 'sprint'
                ? 'border-[#0F5C5C] ring-1 ring-[#0F5C5C]'
                : 'border-[#E7E5DE] hover:border-[#B5B2A8]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-semibold text-[#141619]">
                  Спринт SMC (<span className="font-mono tabular-nums">30</span> дней) —{' '}
                  <span className="font-mono tabular-nums whitespace-nowrap font-bold">2 490 ₽</span>
                </p>
                <p className="text-xs text-[#63666A]">
                  Цена <span className="font-mono tabular-nums">1</span> визита к логопеду в Москве
                </p>
              </div>
              <span
                className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                  selectedPlan === 'sprint'
                    ? 'border-[#0F5C5C] bg-[#0F5C5C] text-white'
                    : 'border-[#C7C4BA]'
                }`}
              >
                {selectedPlan === 'sprint' && <Check className="w-3 h-3" />}
              </span>
            </div>
          </button>

          {/* Plan 2: Hybrid + 4 checks (Dark Premium Club Card) */}
          <button
            type="button"
            role="radio"
            aria-checked={selectedPlan === 'hybrid'}
            onClick={() => handleSelectPlan('hybrid')}
            className={`w-full text-left bg-[#141619] text-white rounded-2xl p-4 border shadow-[0_14px_32px_-12px_rgba(20,22,25,0.45)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2DD4BF] ${
              selectedPlan === 'hybrid'
                ? 'border-[#2DD4BF] ring-1 ring-[#2DD4BF]/50'
                : 'border-white/15 hover:border-white/30'
            }`}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                <span className="bg-[#2DD4BF]/15 text-[#2DD4BF] text-[11px] font-semibold px-2.5 py-1 rounded-lg leading-snug">
                  Рекомендуем при горловом [Р], чтобы не закрепить брак
                </span>
                <span
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                    selectedPlan === 'hybrid'
                      ? 'border-[#2DD4BF] bg-[#2DD4BF] text-[#141619]'
                      : 'border-white/30'
                  }`}
                >
                  {selectedPlan === 'hybrid' && <Check className="w-3 h-3 stroke-[2.5]" />}
                </span>
              </div>

              <div className="flex items-start gap-3">
                <img
                  src={coachAvatarImg}
                  alt="Куратор-логопед SMC"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0 mt-0.5"
                />
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold text-white">
                    Гибрид + <span className="font-mono tabular-nums">4</span> проверки логопеда —{' '}
                    <span className="font-mono tabular-nums whitespace-nowrap font-bold text-[#2DD4BF]">
                      6 900 ₽
                    </span>
                  </p>
                  <p className="text-xs text-white/70 leading-relaxed">
                    Тренажер на <span className="font-mono tabular-nums">30</span> дней и{' '}
                    <span className="font-mono tabular-nums">4</span> точечных видео-разбора вашей артикуляции со специалистом
                  </p>
                </div>
              </div>
            </div>
          </button>
        </div>

        {checkoutSubmitted && (
          <div
            role="status"
            className="bg-[#E6F2F2] border border-[#0F5C5C]/25 rounded-2xl p-3.5 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-[#0F5C5C] shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-[#141619]">
              <p className="font-semibold">
                {selectedPlan === 'hybrid'
                  ? 'Выбран тариф «Гибрид + 4 проверки логопеда»'
                  : 'Выбран тариф «Спринт SMC (30 дней)»'}
              </p>
              <p className="text-[#63666A] mt-0.5">
                Профиль Блока 0 сохранен. Ссылка на оплату и старт первой тренировки отправлены в чат с ботом.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5 pt-1">
        <button
          type="button"
          onClick={handleCheckout}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] focus-visible:ring-offset-2"
        >
          <ShieldCheck className="w-4 h-4 text-[#2DD4BF] shrink-0" />
          <span className="truncate font-mono tabular-nums">
            {selectedPlan === 'hybrid'
              ? 'Подключить Гибрид — 6 900 ₽'
              : 'Подключить Спринт SMC — 2 490 ₽'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            stopPointAPlayback();
            haptic('light');
            onRestart();
          }}
          className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium text-[#63666A] hover:text-[#141619] hover:bg-[#EAE8E1]/60 inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C]"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span>Пройти диагностику заново</span>
        </button>
      </div>
    </div>
  );
}
