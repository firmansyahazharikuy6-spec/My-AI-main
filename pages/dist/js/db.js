import { firebaseConfig } from "./config.js?v=20261020-v5.29";

const FB_BASE = "https://www.gstatic.com/firebasejs/11.2.0";
const LS_KEY = "myai_chats";

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let fb = null;
let auth = null;
let db = null;
let user = null;
let firebaseInitPromise = null;
let firebaseInitError = null;
let lastSyncError = null;
let lastAuthError = null;
let nativeFirebaseAuth = null;
let phoneConfirmation = null;
let phoneRecaptchaVerifier = null;

function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

export function consumeAuthError() {
  const error = lastAuthError;
  lastAuthError = null;
  return error;
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
      try {
        await fb.getRedirectResult(auth);
      } catch (error) {
        lastAuthError = error;
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

export async function signIn() {
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
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error("Login Google tidak mengembalikan token. Periksa konfigurasi Firebase native.");
    const credential = fb.GoogleAuthProvider.credential(idToken);
    return fb.signInWithCredential(auth, credential);
  }
  const provider = new fb.GoogleAuthProvider();
  try {
    return await fb.signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      await fb.signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

async function ensureAuthReady() {
  if ((!fb || !auth) && firebaseInitPromise) await firebaseInitPromise;
  if (!fb || !auth) throw new Error("Firebase Auth belum siap. Muat ulang aplikasi lalu coba lagi.");
}

export async function signInWithEmail(email, password) {
  await ensureAuthReady();
  return fb.signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function createEmailAccount(email, password) {
  await ensureAuthReady();
  const credential = await fb.createUserWithEmailAndPassword(auth, email.trim(), password);
  await fb.sendEmailVerification(credential.user);
  return credential;
}

export async function sendPasswordReset(email) {
  await ensureAuthReady();
  return fb.sendPasswordResetEmail(auth, email.trim());
}

export async function resendEmailVerification() {
  await ensureAuthReady();
  if (!auth.currentUser) throw new Error("Masuk terlebih dahulu untuk mengirim ulang verifikasi.");
  return fb.sendEmailVerification(auth.currentUser);
}

export async function refreshCurrentUser() {
  await ensureAuthReady();
  if (!auth.currentUser) throw new Error("Tidak ada akun yang sedang masuk.");
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

export async function signInWithGithub() {
  await ensureAuthReady();
  if (isNativeApp()) {
    if (!nativeFirebaseAuth) throw new Error("Login GitHub native belum siap. Tutup dan buka kembali aplikasi.");
    const result = await nativeFirebaseAuth.signInWithGithub({ skipNativeAuth: true });
    const accessToken = result.credential?.accessToken;
    if (!accessToken) throw new Error("Login GitHub tidak mengembalikan token. Periksa konfigurasi Firebase native.");
    return fb.signInWithCredential(auth, fb.GithubAuthProvider.credential(accessToken));
  }
  const provider = new fb.GithubAuthProvider();
  return fb.signInWithRedirect(auth, provider);
}

export async function sendPhoneVerification(phoneNumber, recaptchaContainer) {
  await ensureAuthReady();
  if (isNativeApp()) {
    if (!nativeFirebaseAuth) throw new Error("Verifikasi nomor telepon belum siap di aplikasi ini.");
    return new Promise(async (resolve, reject) => {
      let listener;
      const timer = window.setTimeout(() => {
        listener?.remove();
        reject(new Error("Waktu verifikasi habis. Minta kode baru."));
      }, 120000);
      try {
        listener = await nativeFirebaseAuth.addListener("phoneCodeSent", (event) => {
          window.clearTimeout(timer);
          listener?.remove();
          if (!event.verificationId) {
            reject(new Error("Firebase tidak mengembalikan ID verifikasi."));
            return;
          }
          resolve({ verificationId: event.verificationId, native: true });
        });
        await nativeFirebaseAuth.signInWithPhoneNumber({ phoneNumber });
      } catch (error) {
        window.clearTimeout(timer);
        listener?.remove();
        reject(error);
      }
    });
  }
  phoneRecaptchaVerifier?.clear();
  phoneRecaptchaVerifier = null;
  phoneConfirmation = null;
  const verifier = new fb.RecaptchaVerifier(auth, recaptchaContainer, { size: "normal" });
  phoneRecaptchaVerifier = verifier;
  try {
    phoneConfirmation = await fb.signInWithPhoneNumber(auth, phoneNumber, verifier);
    return { native: false };
  } catch (error) {
    verifier.clear();
    phoneRecaptchaVerifier = null;
    throw error;
  }
}

export async function confirmPhoneVerification(code, verification) {
  await ensureAuthReady();
  if (verification?.native) {
    await nativeFirebaseAuth.confirmVerificationCode({
      verificationId: verification.verificationId,
      verificationCode: code.trim(),
    });
    return fb.signInWithCredential(
      auth,
      fb.PhoneAuthProvider.credential(verification.verificationId, code.trim()),
    );
  }
  if (!phoneConfirmation) throw new Error("Minta kode verifikasi terlebih dahulu.");
  const confirmation = phoneConfirmation;
  const result = await confirmation.confirm(code.trim());
  phoneConfirmation = null;
  phoneRecaptchaVerifier?.clear();
  phoneRecaptchaVerifier = null;
  return result;
}

export async function signInWithApple() {
  if (!fb || !auth) {
    if (firebaseInitPromise) await firebaseInitPromise;
  }
  if (!fb || !auth) {
    throw new Error("Firebase Auth belum siap. Muat ulang aplikasi lalu coba lagi.");
  }
  if (!isNativeApp() || window.Capacitor?.getPlatform?.() !== "ios" || !nativeFirebaseAuth) {
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
    return chats && typeof chats === "object" && !Array.isArray(chats) ? chats : {};
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
