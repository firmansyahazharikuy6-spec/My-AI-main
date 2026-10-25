const LANGUAGE_STORAGE_KEY = "myai_selected_lang";
const PROFILE_STORAGE_KEY = "myai_user_profile";
const CUSTOM_INSTRUCTIONS_STORAGE_KEY = "myai_custom_instructions";

const CORRECTIONS = {
  en: [
    [/\brecieve\b/gi, "receive"],
    [/\bdefinately\b/gi, "definitely"],
    [/\bteh\b/g, "the"],
  ],
  id: [
    [/\bmenggunaan\b/gi, "menggunakan"],
    [/\bmerabar\b/gi, "meraba"],
    [/\btersebu\b/gi, "tersebut"],
    [/\bmemaami\b/gi, "memahami"],
    [/\bmengaapa\b/gi, "mengapa"],
  ],
  es: [
    [/\btambien\b/gi, "también"],
    [/\basi\b/gi, "así"],
  ],
  fr: [
    [/\bfrancais\b/gi, "français"],
    [/\betait\b/gi, "était"],
  ],
  de: [
    [/\bueber\b/gi, "über"],
    [/\bfuer\b/gi, "für"],
  ],
};

export function multiLingualSanitizer(textResponse, currentLang = "en") {
  let clean = String(textResponse ?? "");
  for (const [pattern, replacement] of CORRECTIONS[String(currentLang).split("-")[0].toLowerCase()] || []) {
    clean = clean.replace(pattern, replacement);
  }
  return clean;
}

export function loadUserProfile() {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
    return {
      name: typeof value.name === "string" ? value.name.slice(0, 100) : "",
      role: typeof value.role === "string" ? value.role.slice(0, 150) : "",
      tone: typeof value.tone === "string" ? value.tone.slice(0, 150) : "",
      preferences: typeof value.preferences === "string" ? value.preferences.slice(0, 1000) : "",
      about: typeof value.about === "string" ? value.about.slice(0, 1500) : "",
    };
  } catch (error) {
    console.warn("Could not read the saved MyAI user profile.", error);
    return { name: "", role: "", tone: "", preferences: "", about: "" };
  }
}

export function saveUserProfile(profile) {
  const normalized = {
    name: String(profile.name || "").trim().slice(0, 100),
    role: String(profile.role || "").trim().slice(0, 150),
    tone: String(profile.tone || "").trim().slice(0, 150),
    preferences: String(profile.preferences || "").trim().slice(0, 1000),
    about: String(profile.about || "").trim().slice(0, 1500),
  };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadCustomInstructions() {
  try {
    const value = localStorage.getItem(CUSTOM_INSTRUCTIONS_STORAGE_KEY);
    return typeof value === "string" ? value.slice(0, 4000) : "";
  } catch (error) {
    console.warn("Could not read the saved MyAI custom instructions.", error);
    return "";
  }
}

export function saveCustomInstructions(instructions) {
  const normalized = String(instructions || "").trim().slice(0, 4000);
  localStorage.setItem(CUSTOM_INSTRUCTIONS_STORAGE_KEY, normalized);
  return normalized;
}

export function getPrimaryLanguage() {
  return String(localStorage.getItem(LANGUAGE_STORAGE_KEY) || localStorage.getItem("myai_language") || "en")
    .split("-")[0].toLowerCase();
}

export function profileSystemContext(profile = loadUserProfile(), language = getPrimaryLanguage()) {
  return `User Name: ${profile.name || "Not specified"}\nRole: ${profile.role || "Not specified"}\nTone: ${profile.tone || "Natural and helpful"}\nPreferences: ${profile.preferences || "Not specified"}\nAbout User: ${profile.about || "Not specified"}\nPrimary Language: ${language}. Always proofread responses to ensure zero typos and perfect grammar in ${language}.`;
}
