import step1AnchorImg from '@/stage1-step1-anchor.webp';
import step2FlapPoster from '@/stage1-step2-flap.webp';
import flapLoopVideo from '@/stage1-flap-loop.mp4';
import step3KhvattsevImg from '@/stage1-step3-khvattsev.webp';
import step4MushroomDropImg from '@/stage1-step4-mushroom-drop.webp';
import step5CoachmanPoster from '@/stage1-step5-coachman.webp';
import coachmanLoopVideo from '@/stage1-coachman-loop.mp4';
import { Stage1StepNumber } from '../types/stage1';

interface Stage1IllustrationProps {
  step: Stage1StepNumber;
  variant?: 'default' | 'compact';
}

export function Stage1Illustration({
  step,
  variant = 'default',
}: Stage1IllustrationProps) {
  if (step === 6) {
    return (
      <div className="w-full aspect-[16/10] bg-[#FFFFFF] border border-[#E7E5DE] rounded-2xl shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] overflow-hidden flex items-center justify-center p-2.5">
        <Step6ControlSvg />
      </div>
    );
  }

  const containerClass =
    variant === 'compact'
      ? 'h-[30vh] sm:h-[32vh] shrink-0 w-full bg-white rounded-2xl border border-[#E7E5DE] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] flex items-center justify-center overflow-hidden p-2'
      : 'w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[#E7E5DE] bg-[#FFFFFF] shadow-[0_4px_20px_-6px_rgba(20,22,25,0.06)] flex items-center justify-center p-2';

  return (
    <div className={containerClass}>
      {step === 1 && (
        <img
          src={step1AnchorImg}
          className="w-full h-full max-h-full object-contain"
          alt="Боковой якорь"
          referrerPolicy="no-referrer"
        />
      )}

      {step === 2 && (
        <video
          key="step2-video"
          src={coachmanLoopVideo}
          poster={step2FlapPoster}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full max-h-full object-contain bg-white"
        />
      )}

      {step === 3 && (
        <img
          src={step3KhvattsevImg}
          className="w-full h-full max-h-full object-contain"
          alt="Метод Хватцева"
          referrerPolicy="no-referrer"
        />
      )}

      {step === 4 && (
        <img
          src={step4MushroomDropImg}
          className="w-full h-full max-h-full object-contain"
          alt="Срыв Грибка"
          referrerPolicy="no-referrer"
        />
      )}

      {step === 5 && (
        <video
          key="step5-video"
          src={flapLoopVideo}
          poster={step5CoachmanPoster}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full max-h-full object-contain bg-white"
        />
      )}
    </div>
  );
}

function Step6ControlSvg() {
  return (
    <svg
      viewBox="0 0 320 190"
      className="w-full h-full"
      fill="none"
      role="img"
      aria-label="Фиксация 3 лучших попыток и контроль подбородка"
    >
      {[18, 28, 72, 24, 78, 22, 74, 30, 62, 48, 42, 34, 24, 18].map((h, i) => (
        <rect
          key={i}
          x={52 + i * 16}
          y={82 - h / 2}
          width="8"
          height={h}
          rx="4"
          fill={i >= 2 && i <= 8 ? '#0F5C5C' : '#EAE8E1'}
        />
      ))}

      <g transform="translate(86, 134)">
        <circle cx="0" cy="0" r="11" fill="#E6F2F2" stroke="#0F5C5C" strokeWidth="1.8" />
        <path
          d="M-4 0 L-1 3 L5 -3"
          stroke="#0F5C5C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="0" y="22" textAnchor="middle" className="fill-[#63666A] text-[9px] font-mono">
          #1
        </text>
      </g>
      <g transform="translate(160, 134)">
        <circle cx="0" cy="0" r="11" fill="#E6F2F2" stroke="#0F5C5C" strokeWidth="1.8" />
        <path
          d="M-4 0 L-1 3 L5 -3"
          stroke="#0F5C5C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="0" y="22" textAnchor="middle" className="fill-[#63666A] text-[9px] font-mono">
          #2
        </text>
      </g>
      <g transform="translate(234, 134)">
        <circle cx="0" cy="0" r="11" fill="#E6F2F2" stroke="#0F5C5C" strokeWidth="1.8" />
        <path
          d="M-4 0 L-1 3 L5 -3"
          stroke="#0F5C5C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="0" y="22" textAnchor="middle" className="fill-[#63666A] text-[9px] font-mono">
          #3
        </text>
      </g>

      <text x="160" y="26" textAnchor="middle" className="fill-[#141619] text-[10.5px] font-semibold">
        3 контрольные попытки · Мягкое дно рта
      </text>
    </svg>
  );
}
