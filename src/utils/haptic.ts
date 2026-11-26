export type HapticType = 'light' | 'medium' | 'success';

interface TelegramHapticFeedback {
  impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
}

interface TelegramWebApp {
  HapticFeedback?: TelegramHapticFeedback;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function haptic(type: HapticType): void {
  try {
    const tgHaptic = window.Telegram?.WebApp?.HapticFeedback;
    if (tgHaptic) {
      if (type === 'success' && typeof tgHaptic.notificationOccurred === 'function') {
        tgHaptic.notificationOccurred('success');
        return;
      }
      if ((type === 'light' || type === 'medium') && typeof tgHaptic.impactOccurred === 'function') {
        tgHaptic.impactOccurred(type);
        return;
      }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(15);
    }
  } catch {
    // Silent fallback when running in restricted iframe or unsupported browser
  }
}
