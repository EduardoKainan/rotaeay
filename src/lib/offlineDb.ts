import { IDBPDatabase, openDB } from 'idb';
import {
  DeliveryEvent,
  DeliveryPackage,
  DeliveryRoute,
  FavoriteAddress,
  FinancialEntry,
  ImportTemplate,
  Vehicle,
} from '../types/domain';

const DB_NAME = 'rota_express_v3';
const DB_VERSION = 1;

export interface PersistedWorkspace {
  key: 'real' | 'demo';
  routes: DeliveryRoute[];
  activeRouteId: string | null;
  packages: DeliveryPackage[];
  vehicles: Vehicle[];
  events: DeliveryEvent[];
  financialEntries: FinancialEntry[];
  importTemplates: ImportTemplate[];
  favoriteAddresses: FavoriteAddress[];
  lastSyncedAt: string | null;
  updatedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'eventId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveWorkspaceOffline(workspace: PersistedWorkspace): Promise<void> {
  try {
    const db = await getDb();
    await db.put('workspaces', workspace);
  } catch (err) {
    console.warn('IndexedDB saveWorkspaceOffline warning:', err);
  }
}

export async function loadWorkspaceOffline(key: 'real' | 'demo'): Promise<PersistedWorkspace | null> {
  try {
    const db = await getDb();
    const record = await db.get('workspaces', key);
    return (record as PersistedWorkspace) || null;
  } catch (err) {
    console.warn('IndexedDB loadWorkspaceOffline warning:', err);
    return null;
  }
}

export async function clearWorkspaceOffline(key: 'real' | 'demo'): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('workspaces', key);
  } catch (err) {
    console.warn('IndexedDB clearWorkspaceOffline warning:', err);
  }
}

export async function enqueueOfflineEvent(event: DeliveryEvent): Promise<void> {
  try {
    const db = await getDb();
    await db.put('sync_queue', event);
  } catch (err) {
    console.warn('IndexedDB enqueueOfflineEvent warning:', err);
  }
}

export async function getPendingOfflineEvents(): Promise<DeliveryEvent[]> {
  try {
    const db = await getDb();
    const all = (await db.getAll('sync_queue')) as DeliveryEvent[];
    return all.filter((e) => e.syncStatus === 'pending');
  } catch {
    return [];
  }
}

export async function markOfflineEventSynced(eventId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('sync_queue', eventId);
  } catch {
    // Ignore
  }
}
