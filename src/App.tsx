import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { StepHeader } from './components/StepHeader';
import { Step1Onboarding } from './components/Step1Onboarding';
import { Step2FrenulumTest } from './components/Step2FrenulumTest';
import { Step3TactileRecord } from './components/Step3TactileRecord';
import { Step4ABMirror } from './components/Step4ABMirror';
import { Step5EarCalibration } from './components/Step5EarCalibration';
import { Step6SummaryPaywall } from './components/Step6SummaryPaywall';
import { Stage1Training } from './components/Stage1Training';
import {
  DiagnosticState,
  DiagnosticStep,
  INITIAL_DIAGNOSTIC_STATE,
} from './types/diagnostic';
import { AppMode } from './types/stage1';
import { haptic } from './utils/haptic';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('diagnostic');
  const [isStage1SessionActive, setIsStage1SessionActive] = useState(false);
  const [state, setState] = useState<DiagnosticState>(INITIAL_DIAGNOSTIC_STATE);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
      window.Telegram?.WebApp?.disableVerticalSwipes?.();
    } catch {
      // Ignore outside Telegram environment
    }
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const goToStep = (step: DiagnosticStep) => {
    setState((prev) => ({ ...prev, step }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    if (state.step <= 1) return;
    haptic('light');
    goToStep((state.step - 1) as DiagnosticStep);
  };

  const handleRemindLater = () => {
    setState((prev) => ({ ...prev, remindLaterClicked: true }));
    setToastMessage('Бот пришлет напоминание через 4 часа');
  };

  const handleToggleDebugMode = () => {
    setDebugMode((prev) => {
      const next = !prev;
      setToastMessage(next ? 'Режим отладки включён' : 'Режим отладки выключен');
      return next;
    });
  };

  const handleRestart = () => {
    if (state.recordedAudioUrl && state.recordedAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.recordedAudioUrl);
    }
    setState(INITIAL_DIAGNOSTIC_STATE);
    setToastMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const switchMode = (mode: AppMode) => {
    if (mode !== 'stage1') {
      setIsStage1SessionActive(false);
    }
    setAppMode(mode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hideTopHeader = appMode === 'stage1' && isStage1SessionActive;

  return (
    <div className="min-h-[100dvh] bg-[#F5F4F0] bg-[radial-gradient(circle_at_50%_0%,rgba(15,92,92,0.06),transparent_45%)] text-[#141619] overflow-x-hidden">
      <div className="w-full max-w-md mx-auto min-h-[100dvh] flex flex-col justify-between relative overflow-x-hidden">
        {!hideTopHeader && (
          <StepHeader
            appMode={appMode}
            onChangeMode={switchMode}
            step={state.step}
            onBack={handleBack}
            debugMode={debugMode}
            onToggleDebugMode={handleToggleDebugMode}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0">
          {appMode === 'stage1' ? (
            <Stage1Training onActiveSessionChange={setIsStage1SessionActive} />
          ) : (
            <>
              {state.step === 1 && (
            <Step1Onboarding
              remindLaterClicked={state.remindLaterClicked}
              onStart={() => goToStep(2)}
              onRemindLater={handleRemindLater}
            />
          )}

          {state.step === 2 && (
            <Step2FrenulumTest
              frenulumStatus={state.frenulumStatus}
              onSelect={(frenulumStatus) =>
                setState((prev) => ({ ...prev, frenulumStatus }))
              }
              onNext={() => goToStep(3)}
            />
          )}

          {state.step === 3 && (
            <Step3TactileRecord
              debugMode={debugMode}
              recordedAudioUrl={state.recordedAudioUrl}
              recordedBuffer={state.recordedBuffer}
              neckVibration={state.neckVibration}
              onRecordComplete={(recordedAudioUrl, recordedBuffer) =>
                setState((prev) => {
                  if (prev.recordedAudioUrl && prev.recordedAudioUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(prev.recordedAudioUrl);
                  }
                  return { ...prev, recordedAudioUrl, recordedBuffer };
                })
              }
              onResetRecording={() =>
                setState((prev) => {
                  if (prev.recordedAudioUrl && prev.recordedAudioUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(prev.recordedAudioUrl);
                  }
                  return {
                    ...prev,
                    recordedAudioUrl: null,
                    recordedBuffer: null,
                    neckVibration: null,
                  };
                })
              }
              onSelectVibration={(neckVibration) =>
                setState((prev) => ({ ...prev, neckVibration }))
              }
              onNext={() => goToStep(4)}
            />
          )}

          {state.step === 4 && (
            <Step4ABMirror
              debugMode={debugMode}
              neckVibration={state.neckVibration}
              recordedBuffer={state.recordedBuffer}
              customReferenceBuffer={state.customReferenceBuffer}
              customReferenceName={state.customReferenceName}
              onUploadCustomReference={(customReferenceBuffer, customReferenceName) =>
                setState((prev) => ({
                  ...prev,
                  customReferenceBuffer,
                  customReferenceName,
                }))
              }
              onResetCustomReference={() =>
                setState((prev) => ({
                  ...prev,
                  customReferenceBuffer: null,
                  customReferenceName: null,
                }))
              }
              onNext={() => goToStep(5)}
            />
          )}

          {state.step === 5 && (
            <Step5EarCalibration
              debugMode={debugMode}
              earScore={state.earScore}
              onUpdateScore={(earScore) =>
                setState((prev) => ({ ...prev, earScore }))
              }
              onNext={() => goToStep(6)}
            />
          )}

          {state.step === 6 && (
            <Step6SummaryPaywall
              state={state}
              onRestart={handleRestart}
              onStartStage1={() => switchMode('stage1')}
            />
          )}
            </>
          )}
        </main>

        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] z-50"
          >
            <div className="bg-[#141619] text-white rounded-2xl px-4 py-3 shadow-[0_12px_28px_-8px_rgba(20,22,25,0.45)] flex items-center justify-between gap-3 border border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bell className="w-4 h-4 text-[#2DD4BF] shrink-0" />
                <p className="text-xs font-medium leading-snug">
                  {toastMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="min-h-[36px] min-w-[36px] -mr-1.5 flex items-center justify-center rounded-lg text-white/60 hover:text-white transition-colors shrink-0"
                aria-label="Закрыть уведомление"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
