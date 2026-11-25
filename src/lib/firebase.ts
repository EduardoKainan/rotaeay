import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DeliveryEvent,
  DeliveryPackage,
  DeliveryRoute,
  FavoriteAddress,
  FinancialEntry,
  UserProfile,
  Vehicle,
} from '../types/domain';

const app = initializeApp(firebaseConfig);
// CRITICAL: Pass firestoreDatabaseId for Enterprise / named Firestore instance
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, message: 'Conectado ao Cloud Firestore.' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { ok: false, message: 'Cliente offline ou configuração do Firestore indisponível.' };
    }
    // Missing/insufficient permissions on unauthenticated boot is expected when signed out
    if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
      return { ok: true, message: 'Firestore acessível (aguardando autenticação).' };
    }
    return { ok: false, message: msg };
  }
}

// Run startup connectivity probe
void testFirestoreConnection();

export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function registerWithEmail(name: string, email: string, password: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName: name });
  return result.user;
}

export async function resetUserPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function logoutFirebase(): Promise<void> {
  await signOut(auth);
}

export async function deleteCurrentFirebaseAccount(): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch {
    // Profile may not exist yet
  }
  await deleteUser(auth.currentUser);
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'id_0';
}

export async function ensureUserProfileInFirestore(user: User): Promise<UserProfile> {
  const uid = sanitizeId(user.uid);
  const ref = doc(db, 'users', uid);
  const orgId = `org_${uid.slice(0, 24)}`;

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        id: uid,
        name: String(data.name || user.displayName || 'Motorista'),
        email: String(data.email || user.email || ''),
        photoUrl: user.photoURL || undefined,
        role: (data.role as UserProfile['role']) || 'driver',
        organizationId: String(data.organizationId || orgId),
        city: String(data.city || 'Goiânia'),
        state: String(data.state || 'GO'),
        platforms: ['Shopee', 'Mercado Livre', 'Amazon'],
        preferredNavigator: (data.preferredNavigator as UserProfile['preferredNavigator']) || 'google_maps',
      };
    }

    const profilePayload = {
      id: uid,
      name: (user.displayName || user.email?.split('@')[0] || 'Motorista').slice(0, 120),
      email: (user.email || 'usuario@rotaexpress.local').slice(0, 160),
      role: 'driver' as const,
      organizationId: orgId,
      city: 'Goiânia',
      state: 'GO',
      preferredNavigator: 'google_maps' as const,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (user.emailVerified) {
      await setDoc(ref, profilePayload);
    }

    return {
      id: uid,
      name: profilePayload.name,
      email: profilePayload.email,
      photoUrl: user.photoURL || undefined,
      role: 'driver',
      organizationId: orgId,
      city: profilePayload.city,
      state: profilePayload.state,
      platforms: ['Shopee', 'Mercado Livre', 'Amazon'],
      preferredNavigator: 'google_maps',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function saveVehicleToFirestore(vehicle: Vehicle): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = sanitizeId(vehicle.id);
  const ref = doc(db, 'vehicles', id);
  const basePayload = {
    id,
    ownerId: auth.currentUser.uid,
    organizationId: sanitizeId(vehicle.organizationId),
    name: vehicle.name.slice(0, 80),
    type: vehicle.type,
    fuelType: vehicle.fuelType.slice(0, 30),
    consumptionKmPerLiter: Number(vehicle.consumptionKmPerLiter) || 10,
    fuelPricePerLiter: Number(vehicle.fuelPricePerLiter) || 0,
    maintenanceCostPerKm: Number(vehicle.maintenanceCostPerKm) || 0,
    hourlyCost: Number(vehicle.hourlyCost) || 0,
    maxWeightKg: Number(vehicle.maxWeightKg) || 0,
    maxPackages: Math.max(1, Math.min(2000, Math.round(vehicle.maxPackages || 100))),
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        name: basePayload.name,
        type: basePayload.type,
        fuelType: basePayload.fuelType,
        consumptionKmPerLiter: basePayload.consumptionKmPerLiter,
        fuelPricePerLiter: basePayload.fuelPricePerLiter,
        maintenanceCostPerKm: basePayload.maintenanceCostPerKm,
        hourlyCost: basePayload.hourlyCost,
        maxWeightKg: basePayload.maxWeightKg,
        maxPackages: basePayload.maxPackages,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, { ...basePayload, createdAt: serverTimestamp() });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `vehicles/${id}`);
  }
}

export async function saveRouteSummaryToFirestore(route: DeliveryRoute): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified || route.isDemo) return;
  const id = sanitizeId(route.id);
  const ref = doc(db, 'routes', id);
  const activeVer = route.versions.find((v) => v.version === route.activeVersion);

  const metricsMap = activeVer
    ? {
        totalStops: activeVer.metrics.totalStops,
        totalPackages: activeVer.metrics.totalPackages,
        totalDistanceMeters: activeVer.metrics.totalDistanceMeters,
        totalDurationSeconds: activeVer.metrics.totalDurationSeconds,
        estimatedOperationalCost: activeVer.metrics.estimatedOperationalCost,
        isRoadDistanceReal: activeVer.metrics.isRoadDistanceReal,
      }
    : {};

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingStatus = snap.data()?.status;
      if (existingStatus === 'finished' || existingStatus === 'cancelled') return;
      await updateDoc(ref, {
        status: route.status,
        metrics: metricsMap,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id,
        userId: auth.currentUser.uid,
        organizationId: sanitizeId(route.organizationId),
        vehicleId: sanitizeId(route.vehicleId),
        name: route.name.slice(0, 120),
        status: route.status,
        activeVersion: Math.max(1, Math.round(route.activeVersion)),
        selectedStrategy: route.selectedStrategy,
        origin: { label: route.origin.label.slice(0, 100), address: route.origin.address.slice(0, 200) },
        metrics: metricsMap,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `routes/${id}`);
  }
}

export async function syncDeliveryEventToFirestore(event: DeliveryEvent): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = sanitizeId(event.eventId);
  const ref = doc(db, 'delivery_events', id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return; // Idempotent
    await setDoc(ref, {
      id,
      userId: auth.currentUser.uid,
      routeId: sanitizeId(event.routeId),
      stopId: sanitizeId(event.stopId),
      packageId: sanitizeId(event.packageId),
      eventType: event.eventType.slice(0, 50),
      previousStatus: (event.previousStatus || 'pending').slice(0, 40),
      newStatus: event.newStatus.slice(0, 40),
      reason: (event.reason || '').slice(0, 200),
      notes: (event.notes || '').slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `delivery_events/${id}`);
  }
}

export async function syncFinancialEntryToFirestore(entry: FinancialEntry): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = sanitizeId(entry.id);
  const ref = doc(db, 'financial_entries', id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        category: String(entry.category).slice(0, 60),
        description: entry.description.slice(0, 200),
        amount: Math.max(0, Number(entry.amount) || 0),
        isEstimated: Boolean(entry.isEstimated),
        date: entry.date.slice(0, 30),
      });
    } else {
      await setDoc(ref, {
        id,
        userId: auth.currentUser.uid,
        routeId: (entry.routeId || '').slice(0, 128),
        type: entry.type,
        category: String(entry.category).slice(0, 60),
        description: entry.description.slice(0, 200),
        amount: Math.max(0, Number(entry.amount) || 0),
        isEstimated: Boolean(entry.isEstimated),
        date: entry.date.slice(0, 30),
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `financial_entries/${id}`);
  }
}

export async function syncFavoriteAddressToFirestore(fav: FavoriteAddress): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = sanitizeId(fav.id);
  const ref = doc(db, 'favorite_addresses', id);
  try {
    const snap = await getDoc(ref);
    const payload: Record<string, unknown> = {
      id,
      userId: auth.currentUser.uid,
      name: fav.name.slice(0, 80),
      address: fav.address.slice(0, 300),
      createdAt: serverTimestamp(),
    };
    if (fav.coordinates) {
      payload.lat = fav.coordinates.lat;
      payload.lng = fav.coordinates.lng;
    }
    if (!snap.exists()) {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `favorite_addresses/${id}`);
  }
}

export async function loadUserFinancialEntriesFromFirestore(uid: string): Promise<FinancialEntry[]> {
  try {
    const q = query(collection(db, 'financial_entries'), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        userId: String(data.userId),
        routeId: data.routeId ? String(data.routeId) : undefined,
        type: data.type === 'revenue' ? 'revenue' : 'expense',
        category: String(data.category),
        description: String(data.description || ''),
        amount: Number(data.amount || 0),
        isEstimated: Boolean(data.isEstimated),
        date: String(data.date || new Date().toISOString().slice(0, 10)),
        createdAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'financial_entries');
  }
}

export async function syncPackageSnapshotToFirestore(pkg: DeliveryPackage): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = sanitizeId(pkg.id);
  const ref = doc(db, 'packages', id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        status: pkg.status,
        updatedAt: serverTimestamp(),
      });
    } else {
      const payload: Record<string, unknown> = {
        id,
        userId: auth.currentUser.uid,
        organizationId: sanitizeId(pkg.organizationId),
        trackingCode: pkg.trackingCode.slice(0, 100),
        platform: pkg.platform.slice(0, 60),
        recipientName: pkg.recipientName.slice(0, 140),
        normalizedAddress: pkg.normalizedAddress.formatted.slice(0, 300),
        status: pkg.status,
        locationConfidence: pkg.locationConfidence,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (pkg.routeId) payload.routeId = sanitizeId(pkg.routeId);
      if (pkg.physicalLocationId) payload.physicalLocationId = pkg.physicalLocationId.slice(0, 60);
      if (pkg.coordinates) {
        payload.lat = pkg.coordinates.lat;
        payload.lng = pkg.coordinates.lng;
      }
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `packages/${id}`);
  }
}

export { firebaseConfig };
