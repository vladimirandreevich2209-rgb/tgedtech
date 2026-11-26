import { Activity, ArrowRight, Bell, CheckCircle2, Mic, SlidersHorizontal } from 'lucide-react';
import coachAvatarImg from '@/coach-avatar.png';
import { haptic } from '../utils/haptic';

interface Step1OnboardingProps {
  remindLaterClicked: boolean;
  onStart: () => void;
  onRemindLater: () => void;
}

export function Step1Onboarding({
  remindLaterClicked,
  onStart,
  onRemindLater,
}: Step1OnboardingProps) {
  return (
    <div className="flex flex-col justify-between flex-1 px-4 py-4 gap-4">
      <div className="space-y-4">
        {/* Compact Coach / Protocol Author Header */}
        <div className="flex items-center gap-3 bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl p-3 shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]">
          <img
            src={coachAvatarImg}
            alt="Речевой тренер протокола SMC"
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full object-cover border border-[#E7E5DE] shrink-0"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#141619] leading-snug">
              Клинический протокол SMC
            </p>
            <p className="text-xs text-[#63666A] leading-snug mt-0.5">
              Биомеханическая диагностика · Блок <span className="font-mono tabular-nums">0</span>
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-[25px] leading-[1.18] font-semibold tracking-tight text-[#141619] text-balance">
            Диагностика звука [Р] за <span className="font-mono tabular-nums">3</span> минуты
          </h1>

          <p className="text-[14px] leading-relaxed text-[#63666A]">
            Проверим анатомию, запишем &quot;Точку А&quot; и покажем на графике, где именно теряется вибрация
          </p>
        </div>

        <section
          aria-label="Этапы диагностики"
          className="bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl divide-y divide-[#E7E5DE] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)]"
        >
          <div className="px-3.5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#E6F2F2] border border-[#0F5C5C]/15 flex items-center justify-center shrink-0 text-[#0F5C5C]">
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#141619]">
                <span className="font-mono tabular-nums">1.</span> Биомеханика уздечки
              </p>
              <p className="text-xs text-[#63666A] mt-0.5 leading-snug">
                Исключим анатомические ограничения тестом «Грибок» за <span className="font-mono tabular-nums">15</span> секунд
              </p>
            </div>
          </div>

          <div className="px-3.5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#E6F2F2] border border-[#0F5C5C]/15 flex items-center justify-center shrink-0 text-[#0F5C5C]">
              <Mic className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#141619]">
                <span className="font-mono tabular-nums">2.</span> Тактильный тест и Точка А
              </p>
              <p className="text-xs text-[#63666A] mt-0.5 leading-snug">
                Зафиксируем зону вибрации и сравним ваш звук с эталоном на осциллограмме
              </p>
            </div>
          </div>

          <div className="px-3.5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#E6F2F2] border border-[#0F5C5C]/15 flex items-center justify-center shrink-0 text-[#0F5C5C]">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#141619]">
                <span className="font-mono tabular-nums">3.</span> Калибровка слухового контроля
              </p>
              <p className="text-xs text-[#63666A] mt-0.5 leading-snug">
                Оценим точность различения альвеолярного и горлового вибрантов
              </p>
            </div>
          </div>
        </section>

        {remindLaterClicked && (
          <div
            role="status"
            className="bg-[#E6F2F2] border border-[#0F5C5C]/25 rounded-2xl p-3 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-[#0F5C5C] shrink-0 mt-0.5" />
            <div className="text-xs text-[#141619] leading-relaxed">
              <p className="font-semibold">Напоминание запланировано</p>
              <p className="text-[#63666A] mt-0.5">
                Бот пришлет напоминание через 4 часа, когда вы будете в тихом месте.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5 pt-2">
        <button
          type="button"
          onClick={() => {
            haptic('medium');
            onStart();
          }}
          className="w-full h-12 rounded-2xl bg-[#141619] hover:bg-[#1E2126] active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_-6px_rgba(20,22,25,0.35)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C] focus-visible:ring-offset-2"
        >
          <span>Начать проверку</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptic('light');
            onRemindLater();
          }}
          className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium text-[#63666A] hover:text-[#141619] hover:bg-[#EAE8E1]/60 inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C5C]"
        >
          <Bell className="w-3.5 h-3.5 shrink-0" />
          <span>Я сейчас в людном месте, напомнить вечером</span>
        </button>
      </div>
    </div>
  );
}
