import { Capacitor } from "@capacitor/core";

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

const configuredApiBase = import.meta.env?.VITE_MYAI_API_BASE;
export const AI_API_URL = typeof configuredApiBase === "string" && configuredApiBase.trim()
  ? configuredApiBase.trim().replace(/\/+$/, "")
  : Capacitor.isNativePlatform()
    ? "https://myai-v3-firmansyah.pages.dev/api"
    : "/api";
export const APP_NAME = "MyAI";
export const APP_VERSION = "5.47";
