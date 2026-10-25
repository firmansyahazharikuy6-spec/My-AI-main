// Isi dengan konfigurasi dari Firebase Console > Project settings > Your apps > Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyBxenbvx__OOo5mbbROy8-1jEoLRqXaPSI",
  authDomain: "my-ai-69027.firebaseapp.com",
  projectId: "my-ai-69027",
  storageBucket: "my-ai-69027.firebasestorage.app",
  messagingSenderId: "550223008167",
  appId: "1:550223008167:web:7b5603cdec64b80dc96682",
  measurementId: "G-W29TGCJJJ1",
};

// Local development calls the Worker directly; production uses the same-origin Pages gateway.
const hostname = globalThis.location?.hostname || "";
const localHost = ["localhost", "127.0.0.1"].includes(hostname);
export const AI_API_URL = localHost
  ? "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev"
  : "/api";
export const APP_NAME = "MyAI";
export const APP_VERSION = "5.42";
