import { SavedAttemptRecord, Stage1Progress } from '../types/stage1';

const DB_NAME = 'smc_stage1_db';
const DB_VERSION = 1;
const STORE_ATTEMPTS = 'attempts';
const STORE_STATE = 'state';
const STATE_KEY = 'progress';

const STAGE2_UNLOCKED_KEY = 'stage2Unlocked';

export const DEFAULT_STAGE1_PROGRESS: Stage1Progress = {
  day: 1,
  sessionTime: 'morning',
  trainingMode: 'full',
  workingKey: null,
  chinWasSoft: false,
  completedSessions: 0,
  history: [],
};

function sanitizeStage1Progress(raw: Partial<Stage1Progress> | undefined): Stage1Progress {
  if (!raw) return DEFAULT_STAGE1_PROGRESS;
  return {
    day: raw.day ?? DEFAULT_STAGE1_PROGRESS.day,
    sessionTime: raw.sessionTime ?? DEFAULT_STAGE1_PROGRESS.sessionTime,
    trainingMode: raw.trainingMode ?? DEFAULT_STAGE1_PROGRESS.trainingMode,
    workingKey: raw.workingKey ?? DEFAULT_STAGE1_PROGRESS.workingKey,
    chinWasSoft: Boolean(raw.chinWasSoft),
    completedSessions: typeof raw.completedSessions === 'number' ? raw.completedSessions : 0,
    history: Array.isArray(raw.history) ? raw.history : [],
  };
}

export function loadStage2Unlocked(): boolean {
  try {
    return window.localStorage.getItem(STAGE2_UNLOCKED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveStage2Unlocked(unlocked: boolean): void {
  try {
    window.localStorage.setItem(STAGE2_UNLOCKED_KEY, unlocked ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open error'));
  });
}

export async function loadStage1ProgressFromDb(): Promise<Stage1Progress> {
  try {
    const db = await openDb();
    return await new Promise<Stage1Progress>((resolve) => {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const store = tx.objectStore(STORE_STATE);
      const req = store.get(STATE_KEY);

      req.onsuccess = () => {
        const saved = req.result as Partial<Stage1Progress> | undefined;
        db.close();
        resolve(sanitizeStage1Progress(saved));
      };

      req.onerror = () => {
        db.close();
        resolve(DEFAULT_STAGE1_PROGRESS);
      };
    });
  } catch {
    // Fallback to localStorage if IndexedDB is blocked
    try {
      const raw = window.localStorage.getItem('smc_stage1_progress_v1');
      if (!raw) return DEFAULT_STAGE1_PROGRESS;
      const parsed = JSON.parse(raw) as Partial<Stage1Progress>;
      return sanitizeStage1Progress(parsed);
    } catch {
      return DEFAULT_STAGE1_PROGRESS;
    }
  }
}

export async function saveStage1ProgressToDb(progress: Stage1Progress): Promise<void> {
  const cleanProgress = sanitizeStage1Progress(progress);
  try {
    window.localStorage.setItem('smc_stage1_progress_v1', JSON.stringify(cleanProgress));
  } catch {
    // ignore localStorage mirror error
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, 'readwrite');
      const store = tx.objectStore(STORE_STATE);
      const req = store.put(cleanProgress, STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // fallback handled by localStorage mirror
  }
}

export async function saveAttemptToDb(record: SavedAttemptRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readwrite');
      const store = tx.objectStore(STORE_ATTEMPTS);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // ignore storage errors in restricted environments
  }
}

export async function deleteAttemptFromDb(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readwrite');
      const store = tx.objectStore(STORE_ATTEMPTS);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // ignore
  }
}

export async function loadAllAttemptsFromDb(): Promise<SavedAttemptRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<SavedAttemptRecord[]>((resolve) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readonly');
      const store = tx.objectStore(STORE_ATTEMPTS);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        const rows = (req.result as SavedAttemptRecord[]) ?? [];
        resolve(rows);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}
