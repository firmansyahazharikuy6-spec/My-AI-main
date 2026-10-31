import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";

const NativeBridge = registerPlugin("MyAIDownloads");
const POLICY_HOST = "myai-v3-firmansyah.pages.dev";

export const isNativeApp = () => Capacitor.isNativePlatform();

function updateNetworkNotice() {
  document.getElementById("offlineNotice")?.classList.toggle("hidden", navigator.onLine);
}

function setNativeTheme() {
  const light = document.documentElement.dataset.theme === "light";
  void StatusBar.setStyle({ style: light ? Style.Dark : Style.Light })
    .catch((error) => console.warn("Could not update native status bar:", error));
  void StatusBar.setBackgroundColor({ color: light ? "#f4f3f7" : "#11131b" })
    .catch((error) => console.warn("Could not update status bar color:", error));
  void NativeBridge.setNavigationBar({ light })
    .catch((error) => console.warn("Could not update navigation bar:", error));
}

function closeTopLayer() {
  const dialogs = [...document.querySelectorAll("dialog[open]")];
  if (dialogs.length) {
    const dialog = dialogs[dialogs.length - 1];
    if (dialog.id === "premiumConfirmDialog") {
      document.getElementById("cancelPremiumConfirm")?.click();
    } else {
      dialog.close();
    }
    return true;
  }

  const menuIds = ["attachMenu", "taskModeMenu", "modelMenu", "languageMenu"];
  for (const id of menuIds) {
    const menu = document.getElementById(id);
    if (menu && !menu.classList.contains("hidden")) {
      menu.classList.add("hidden");
      return true;
    }
  }

  const artifact = document.getElementById("artifactPanel");
  if (artifact && !artifact.hidden) {
    artifact.hidden = true;
    return true;
  }

  const sidebar = document.getElementById("sidebar");
  if (sidebar?.classList.contains("open")) {
    sidebar.classList.remove("open");
    document.getElementById("backdrop")?.classList.remove("show");
    return true;
  }
  return false;
}

function hideNativeDiagnostics() {
  document.getElementById("usageDashboardButton")?.classList.add("hidden");
  document.getElementById("openMonid")?.classList.add("hidden");
  document.querySelectorAll(
    '[data-action="api"], [data-action="monid"], #folderInput, #switchVoiceMode, #voiceCameraToggle',
  )
    .forEach((element) => element.classList.add("hidden"));
}

export async function initializePlatform() {
  updateNetworkNotice();
  window.addEventListener("online", updateNetworkNotice);
  window.addEventListener("offline", updateNetworkNotice);
  if (!isNativeApp()) {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      const scriptUrl = new URL("./service-worker.js", location.href);
      const scope = new URL("./", location.href).pathname;
      navigator.serviceWorker.register(scriptUrl, { scope })
        .catch((error) => console.warn("MyAI offline shell could not be registered:", error));
    }
    return;
  }

  document.documentElement.classList.add("native-app");
  hideNativeDiagnostics();
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    setNativeTheme();
  } catch (error) {
    console.warn("Native system UI setup failed:", error);
  }

  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link || event.defaultPrevented || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin === location.origin && link.target !== "_blank") return;
    event.preventDefault();
    void Browser.open({ url: url.href }).catch((error) => {
      console.error("Could not open external link:", error);
      window.dispatchEvent(new CustomEvent("myai-platform-error", {
        detail: { message: "Tautan tidak dapat dibuka. Periksa browser dan koneksi internet." },
      }));
    });
  });

  await App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopLayer()) return;
    if (canGoBack) history.back();
    else App.exitApp();
  });

  await App.addListener("appUrlOpen", ({ url }) => {
    try {
      const callback = new URL(url);
      if (callback.protocol === "myai:" && callback.hostname === "auth") {
        window.dispatchEvent(new Event("myai-auth-callback"));
      } else if (callback.hostname === POLICY_HOST && callback.pathname === "/auth/return") {
        window.dispatchEvent(new Event("myai-auth-callback"));
      }
    } catch (error) {
      console.error("Invalid app link received:", error);
    }
  });

  const observer = new MutationObserver(setNativeTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function downloadWithAnchor(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  });
}

export async function saveBlob(blob, filename) {
  if (!isNativeApp()) {
    downloadWithAnchor(blob, filename);
    return;
  }
  if (blob.size > 20 * 1024 * 1024) {
    throw new Error("File lebih besar dari batas simpan aplikasi (20 MB).");
  }
  await NativeBridge.saveFile({
    filename,
    mimeType: blob.type || "application/octet-stream",
    data: await blobToBase64(blob),
  });
}

export async function shareText({ title, text }) {
  if (isNativeApp()) {
    await Share.share({ title, text, dialogTitle: title });
    return;
  }
  if (navigator.share) {
    await navigator.share({ title, text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function openExternalUrl(url) {
  if (isNativeApp()) return Browser.open({ url });
  window.open(url, "_blank", "noopener,noreferrer");
}
