import { Capacitor } from "@capacitor/core";
import { firebaseConfig } from "./config.js?v=20261029-v5.130";

const FB_BASE = "https://www.gstatic.com/firebasejs/11.2.0";
const LS_KEY = "myai_chats";
const PENDING_AUTH_PROVIDER_KEY = "myai_pending_auth_provider";

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let fb = null;
let auth = null;
let db = null;
let user = null;
let firebaseInitPromise = null;
let firebaseInitError = null;
let lastSyncError = null;
let lastAuthError = null;
let lastAuthProvider = null;
let nativeFirebaseAuth = null;
let pendingGithubLink = null;

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function consumeAuthError() {
  const error = lastAuthError;
  lastAuthError = null;
  return error;
}

export function consumeAuthProvider() {
  const provider = lastAuthProvider;
  lastAuthProvider = null;
  return provider;
}

export function consumeSyncError() {
  const error = lastSyncError;
  lastSyncError = null;
  return error;
}

export async function initFirebase(onUserChange) {
  if (!firebaseEnabled) {
    onUserChange(null);
    return;
  }
  firebaseInitError = null;
  firebaseInitPromise = (async () => {
    const native = isNativeApp();
    const [appMod, authMod, fsMod, nativeAuthMod] = await Promise.all([
      import(`${FB_BASE}/firebase-app.js`),
      import(`${FB_BASE}/firebase-auth.js`),
      import(`${FB_BASE}/firebase-firestore.js`),
      native ? import("@capacitor-firebase/authentication") : Promise.resolve(null),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    auth = native
      ? authMod.initializeAuth(app, { persistence: authMod.indexedDBLocalPersistence })
      : authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    fb = { ...authMod, ...fsMod };
    nativeFirebaseAuth = nativeAuthMod?.FirebaseAuthentication || null;
    let lastReportedAuthState;
    fb.onIdTokenChanged(auth, (u) => {
      const providerIds = u?.providerData?.map((provider) => provider.providerId).sort().join(",") || "";
      const authState = u ? `${u.uid}:${u.emailVerified}:${providerIds}` : "";
      if (authState === lastReportedAuthState) return;
      lastReportedAuthState = authState;
      user = u;
      onUserChange(u);
    }, (error) => {
      lastAuthError = error;
    });
    if (!native) {
      const pendingProvider = sessionStorage.getItem(PENDING_AUTH_PROVIDER_KEY);
      // Parameter OAuth di URL menandai balikan redirect yang gagal; tanpa itu,
      // kunci pending hanyalah sisa percobaan lama di tab yang sama.
      const oauthReturn = /[?&](?:code|state|oauth_token|oauth_verifier)=/.test(location.search);
      try {
        const result = await fb.getRedirectResult(auth);
        if (!result && pendingProvider && oauthReturn) {
          const error = new Error("Autentikasi kembali tanpa menyelesaikan login.");
          error.code = "auth/redirect-no-result";
          lastAuthError = error;
          lastAuthProvider = pendingProvider;
        }
      } catch (error) {
        if (pendingProvider && oauthReturn) {
          lastAuthError = error;
          lastAuthProvider = pendingProvider;
        }
      } finally {
        sessionStorage.removeItem(PENDING_AUTH_PROVIDER_KEY);
      }
    }
  })();
  try {
    await firebaseInitPromise;
  } catch (error) {
    firebaseInitError = error;
    throw error;
  }
}

export function hasPendingGithubLink() {
  return Boolean(pendingGithubLink);
}

export async function linkPendingGithubCredential(targetUser) {
  if (!pendingGithubLink) return null;
  const expectedEmail = pendingGithubLink.email?.trim().toLowerCase();
  const actualEmail = targetUser?.email?.trim().toLowerCase();
  if (!expectedEmail || !actualEmail || expectedEmail !== actualEmail) {
    const error = new Error("Masuk dengan akun Google yang menggunakan alamat email yang sama dengan akun GitHub.");
    error.code = "auth/github-link-email-mismatch";
    throw error;
  }
  try {
    const result = await fb.linkWithCredential(targetUser, pendingGithubLink.credential);
    pendingGithubLink = null;
    return result;
  } catch (error) {
    if (["auth/credential-already-in-use", "auth/provider-already-linked"].includes(error?.code)) {
      pendingGithubLink = null;
    }
    throw error;
  }
}

export async function signIn({ allowRedirectFallback = true } = {}) {
  if ((!fb || !auth) && firebaseInitPromise) {
    try {
      await firebaseInitPromise;
    } catch (error) {
      const reason = error?.message || String(error);
      throw new Error(`Firebase gagal dimuat: ${reason}. Periksa koneksi ke Firebase dan konfigurasi aplikasi.`);
    }
  }
  if (!fb || !auth) {
    const reason = firebaseInitError?.message;
    throw new Error(reason
      ? `Firebase gagal dimuat: ${reason}. Periksa koneksi ke Firebase dan konfigurasi aplikasi.`
      : "Firebase Auth belum diinisialisasi. Muat ulang halaman lalu coba lagi.");
  }
  if (isNativeApp()) {
    if (!nativeFirebaseAuth) {
      throw new Error("Login Google native belum siap. Tutup dan buka kembali aplikasi.");
    }
    const result = await nativeFirebaseAuth.signInWithGoogle({ skipNativeAuth: true });
    const idToken = result.credential?.idToken || result.idToken;
    if (!idToken) {
      throw new Error("Login Google tidak mengembalikan token. Pastikan Firebase Android app sudah terdaftar dan provider Google aktif.");
    }
    const credential = fb.GoogleAuthProvider.credential(idToken);
    return fb.signInWithCredential(auth, credential);
  }
  const provider = new fb.GoogleAuthProvider();
  try {
    const result = await fb.signInWithPopup(auth, provider);
    sessionStorage.removeItem(PENDING_AUTH_PROVIDER_KEY);
    return result;
  } catch (error) {
    if (allowRedirectFallback && ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      sessionStorage.setItem(PENDING_AUTH_PROVIDER_KEY, "google");
      try {
        await fb.signInWithRedirect(auth, provider);
        return null;
      } catch (redirectError) {
        sessionStorage.removeItem(PENDING_AUTH_PROVIDER_KEY);
        throw redirectError;
      }
    }
    throw error;
  }
}

async function ensureAuthReady() {
  if ((!fb || !auth) && firebaseInitPromise) await firebaseInitPromise;
  if (!fb || !auth) throw new Error("Firebase Auth belum siap. Muat ulang aplikasi lalu coba lagi.");
}

export async function signInWithGithub() {
  await ensureAuthReady();
  const native = isNativeApp();
  const provider = native ? null : new fb.GithubAuthProvider();
  try {
    if (native) {
      if (!nativeFirebaseAuth) throw new Error("Login GitHub native belum siap. Tutup dan buka kembali aplikasi.");
      const result = await nativeFirebaseAuth.signInWithGithub({ skipNativeAuth: true });
      const accessToken = result.credential?.accessToken || result.accessToken;
      if (!accessToken) {
        throw new Error("Login GitHub tidak mengembalikan token. Pastikan Github provider di Firebase Console aktif dan app Android sudah di-register.");
      }
      return await fb.signInWithCredential(auth, fb.GithubAuthProvider.credential(accessToken));
    }
    const result = await fb.signInWithPopup(auth, provider);
    sessionStorage.removeItem(PENDING_AUTH_PROVIDER_KEY);
    return result;
  } catch (error) {
    if (error?.code === "auth/account-exists-with-different-credential") {
      const credential = fb.GithubAuthProvider.credentialFromError(error);
      const email = error.customData?.email || error.email || "";
      if (credential && email) pendingGithubLink = { credential, email };
    }
    if (!native && ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      sessionStorage.setItem(PENDING_AUTH_PROVIDER_KEY, "github");
      try {
        await fb.signInWithRedirect(auth, provider);
        return null;
      } catch (redirectError) {
        sessionStorage.removeItem(PENDING_AUTH_PROVIDER_KEY);
        throw redirectError;
      }
    }
    throw error;
  }
}

export async function signInWithApple() {
  if (!fb || !auth) {
    if (firebaseInitPromise) await firebaseInitPromise;
  }
  if (!fb || !auth) {
    throw new Error("Firebase Auth belum siap. Muat ulang aplikasi lalu coba lagi.");
  }
  if (!isNativeApp() || Capacitor.getPlatform() !== "ios" || !nativeFirebaseAuth) {
    throw new Error("Login Apple hanya tersedia di aplikasi iOS.");
  }
  const result = await nativeFirebaseAuth.signInWithApple({ skipNativeAuth: true });
  if (!result.credential?.idToken || !result.credential?.nonce) {
    throw new Error("Login Apple tidak mengembalikan token yang diperlukan. Periksa konfigurasi Apple/Firebase.");
  }
  const credential = new fb.OAuthProvider("apple.com").credential({
    idToken: result.credential?.idToken,
    rawNonce: result.credential?.nonce,
  });
  return fb.signInWithCredential(auth, credential);
}

export async function signOutUser() {
  if (isNativeApp() && nativeFirebaseAuth) await nativeFirebaseAuth.signOut();
  return fb.signOut(auth);
}
export const getAuthToken = () => user ? user.getIdToken() : Promise.resolve("");

const readLocal = () => {
  try {
    const chats = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    if (!chats || typeof chats !== "object" || Array.isArray(chats)) return {};
    return Object.fromEntries(Object.entries(chats).filter(([id, chat]) =>
      typeof id === "string"
      && chat
      && typeof chat === "object"
      && !Array.isArray(chat)
      && chat.id === id
      && Array.isArray(chat.messages)));
  } catch {
    return {};
  }
};
const writeLocal = (obj) => localStorage.setItem(LS_KEY, JSON.stringify(obj));
function withTimeout(promise, timeoutMs = 8000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Firebase tidak memberi konfirmasi tepat waktu.");
      error.code = "sync-timeout";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const chatsCol = () => fb.collection(db, "users", user.uid, "chats");
const settingsDoc = () => fb.doc(db, "users", user.uid, "private", "settings");

export async function loadCloudSettings() {
  if (!user) return null;
  const snap = await fb.getDoc(settingsDoc());
  return snap.exists() ? snap.data() : null;
}

export async function saveCloudSettings(settings) {
  if (!user) return;
  await fb.setDoc(settingsDoc(), { ...settings, updatedAt: Date.now() });
}

export async function listChats() {
  if (user) {
    try {
      const snap = await withTimeout(fb.getDocs(fb.query(chatsCol(), fb.orderBy("updatedAt", "desc"))));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      lastSyncError = error;
    }
  }
  return Object.values(readLocal()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChat(chat) {
  // Firestore menolak nilai undefined; round-trip JSON membuangnya.
  const data = JSON.parse(JSON.stringify(chat));
  const all = readLocal();
  all[data.id] = data;
  writeLocal(all);
  if (user) {
    const { id, ...rest } = data;
    try {
      await withTimeout(fb.setDoc(fb.doc(chatsCol(), id), rest));
    } catch (error) {
      return error;
    }
  }
  return null;
}

export async function deleteChat(id) {
  const all = readLocal();
  delete all[id];
  writeLocal(all);
  if (user) {
    try {
      await withTimeout(fb.deleteDoc(fb.doc(chatsCol(), id)));
    } catch (error) {
      return error;
    }
  }
  return null;
}
