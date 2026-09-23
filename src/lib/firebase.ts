import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';

const firebaseConfig = {
  projectId: "gen-lang-client-0527980301",
  appId: "1:997405072479:web:49a2067e091ff0e39ccfea",
  apiKey: "AIzaSyDXaEt89D_gh0gPlVGYSQtbCp-Pl4aU0Pc",
  authDomain: "gen-lang-client-0527980301.firebaseapp.com",
  storageBucket: "gen-lang-client-0527980301.firebasestorage.app",
  messagingSenderId: "997405072479"
};

// Initialize Firebase once
export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

export const OPERATOR_EMAIL = 'tlm@tarrenmunoz.com';

export const isOperator = (user: User | null): boolean => {
  return !!user && user.email?.toLowerCase() === OPERATOR_EMAIL.toLowerCase();
};

export const signInWithGoogle = async () => {
  return await signInWithPopup(auth, googleProvider);
};

export const logOut = async () => {
  return await signOut(auth);
};

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  type User
};

/**
 * Authorization header for this spoke's own API. Every journey route verifies the ID
 * token server-side and derives the owner from it, so a call without this header is a
 * 401 rather than a save into a uid the caller typed.
 */
export const authHeaders = async (): Promise<Record<string, string>> => {
  const u = auth.currentUser;
  if (!u) return {};
  try {
    return { Authorization: `Bearer ${await u.getIdToken()}` };
  } catch {
    return {};
  }
};
