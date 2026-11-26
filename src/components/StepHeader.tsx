import { useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { DiagnosticStep } from '../types/diagnostic';
import { AppMode } from '../types/stage1';
import { haptic } from '../utils/haptic';

interface StepHeaderProps {
  appMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
  step: DiagnosticStep;
  onBack: () => void;
  debugMode?: boolean;
  onToggleDebugMode?: () => void;
}

const STEP_LABELS: Record<DiagnosticStep, string> = {
  1: 'Блок 0 · Введение',
  2: 'Тест уздечки',
  3: 'Тактильный датчик',
  4: 'A/B-зеркало',
  5: 'Калибровка слуха',
  6: 'Профиль старта',
};

export function StepHeader({
  appMode,
  onChangeMode,
  step,
  onBack,
  debugMode = false,
  onToggleDebugMode,
}: StepHeaderProps) {
  const progressPercent = (step / 6) * 100;
  const tapTrackerRef = useRef<{ count: number; lastTime: number }>({
    count: 0,
    lastTime: 0,
  });

  const handleBadgeTap = () => {
    const now = Date.now();
    if (now - tapTrackerRef.current.lastTime > 700) {
      tapTrackerRef.current.count = 1;
    } else {
      tapTrackerRef.current.count += 1;
    }
    tapTrackerRef.current.lastTime = now;

    if (tapTrackerRef.current.count >= 3) {
      tapTrackerRef.current.count = 0;
      tapTrackerRef.current.lastTime = 0;
      haptic('medium');
      onToggleDebugMode?.();
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-[#F5F4F0]/90 backdrop-blur-md border-b border-[#E7E5DE] px-4 pt-2.5 pb-2.5">
      {/* Top Segmented Mode Switcher (iOS/Linear track) */}
      <div
        role="tablist"
        aria-label="Режим работы"
        className="grid grid-cols-2 gap-1 p-1 bg-[#EAE8E1] rounded-xl"
      >
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'diagnostic'}
          onClick={() => {
            if (appMode !== 'diagnostic') {
              haptic('light');
              onChangeMode('diagnostic');
            }
          }}
          className={`min-h-[36px] px-2 py-1 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap truncate transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
            appMode === 'diagnostic'
              ? 'bg-white text-[#141619] shadow-sm'
              : 'text-[#63666A] hover:text-[#141619]'
          }`}
        >
          Блок 0 · Диагностика
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'stage1'}
          onClick={() => {
            if (appMode !== 'stage1') {
              haptic('light');
              onChangeMode('stage1');
            }
          }}
          className={`min-h-[36px] px-2 py-1 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap truncate transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
            appMode === 'stage1'
              ? 'bg-white text-[#141619] shadow-sm'
              : 'text-[#63666A] hover:text-[#141619]'
          }`}
        >
          Этап 1 · Тренировка (6 мин)
        </button>
      </div>

      {appMode === 'diagnostic' && (
        <>
          <div className="flex items-center justify-between gap-2 min-h-[36px] mt-1.5">
            <div className="w-28 flex items-center">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1 min-h-[36px] -ml-1.5 px-1.5 text-xs sm:text-sm font-medium text-[#141619] hover:text-[#0F5C5C] active:opacity-70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] rounded-lg whitespace-nowrap shrink-0"
                  aria-label="Вернуться на предыдущий шаг"
                >
                  <ChevronLeft className="w-4 h-4 shrink-0" />
                  <span>Назад</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBadgeTap}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap select-none focus-visible:outline-none rounded-md"
                  aria-label="SMC LAB 01"
                >
                  <span
                    className={`w-2 h-2 rounded-full ring-2 shrink-0 transition-colors ${
                      debugMode
                        ? 'bg-[#F59E0B] ring-[#F59E0B]/25'
                        : 'bg-[#2DD4BF] ring-[#0F5C5C]/20'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] font-semibold tracking-wider text-[#141619]">
                    SMC LAB · 01
                  </span>
                </button>
              )}
            </div>

            <div className="text-center min-w-0 flex-1">
              <p className="text-xs font-medium text-[#63666A] truncate">
                {STEP_LABELS[step]}
              </p>
            </div>

            <div className="w-16 flex justify-end">
              <span className="font-mono text-xs font-semibold text-[#141619] tabular-nums whitespace-nowrap">
                {step} из 6
              </span>
            </div>
          </div>

          <div
            className="mt-1.5 h-1.5 w-full bg-[#EAE8E1] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={6}
            aria-label={`Шаг ${step} из 6`}
          >
            <div
              className="h-full bg-[#0F5C5C] rounded-full transition-all duration-200 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </>
      )}
    </header>
  );
}
