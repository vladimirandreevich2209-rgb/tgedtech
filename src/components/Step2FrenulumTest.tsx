import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import step2FrenulumImg from '@/step2-frenulum.webp';
import { FrenulumStatus } from '../types/diagnostic';
import { haptic } from '../utils/haptic';

interface Step2FrenulumTestProps {
  frenulumStatus: FrenulumStatus;
  onSelect: (status: 'normal' | 'restricted') => void;
  onNext: () => void;
}

export function Step2FrenulumTest({
  frenulumStatus,
  onSelect,
  onNext,
}: Step2FrenulumTestProps) {
  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-4 gap-4">
      <div className="space-y-3.5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#63666A]">
            Анатомический скрининг · Тест «Грибок»
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-[#141619] text-balance">
            Проверка подъязычной связки
          </h2>
        </div>

        <img
          src={step2FrenulumImg}
          alt="Тест уздечки языка в позе Грибок"
          referrerPolicy="no-referrer"
          className="object-cover w-full aspect-[4/3] rounded-2xl border border-[#E7E5DE] bg-[#FFFFFF] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]"
        />

        <div className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-4 space-y-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
          <p className="text-sm leading-relaxed text-[#141619]">
            Присосите широкий язык к нёбу и откройте рот. Получается удержать <span className="font-mono tabular-nums font-medium">3</span> секунды, не теряя присоску?
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                haptic('success');
                onSelect('normal');
              }}
              className={`min-h-[48px] px-2.5 py-2.5 rounded-xl border text-[13px] sm:text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                frenulumStatus === 'normal'
                  ? 'border-[#0F5C5C] bg-[#E6F2F2] text-[#0F5C5C]'
                  : 'border-[#E7E5DE] bg-[#FFFFFF] text-[#141619] hover:border-[#B5B2A8]'
              }`}
            >
              Да, легко
            </button>

            <button
              type="button"
              onClick={() => {
                haptic('medium');
                onSelect('restricted');
              }}
              className={`min-h-[48px] px-2.5 py-2.5 rounded-xl border text-[13px] sm:text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] ${
                frenulumStatus === 'restricted'
                  ? 'border-[#E11D48]/50 bg-[#FFF1F2] text-[#E11D48]'
                  : 'border-[#E7E5DE] bg-[#FFFFFF] text-[#141619] hover:border-[#B5B2A8]'
              }`}
            >
              Тянет / не достает
            </button>
          </div>
        </div>

        {frenulumStatus === 'normal' && (
          <div
            role="status"
            className="bg-[#E6F2F2] border border-[#0F5C5C]/25 rounded-2xl p-3.5 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-[#0F5C5C] shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-[#141619]">
              Анатомия в норме. Подрезать ничего не нужно — дело в моторной привычке
            </p>
          </div>
        )}

        {frenulumStatus === 'restricted' && (
          <div
            role="status"
            className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-3.5 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-[#141619]">
              Возможна укороченная подъязычная связка. Рекомендуем очный осмотр перед стартом, чтобы не тратить время впустую
            </p>
          </div>
        )}
      </div>

      <div className="pt-1">
        <button
          type="button"
          disabled={!frenulumStatus}
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
