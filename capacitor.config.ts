import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.myai.assistant",
  appName: "MyAI",
  webDir: "www",
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com", "github.com"],
    },
  },
  ios: {
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
  },
};

export default config;
