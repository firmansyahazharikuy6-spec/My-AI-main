# Firebase setup

MyAI uses Firebase Authentication for sign-in and Firestore for per-user chat history and private settings. The current web sign-in UI offers Google and GitHub. The Worker accepts verified Google and GitHub identity tokens for authenticated AI routes.

## 1. Configure the Firebase web app

1. Create or select the Firebase project used by the deployment.
2. Register a Firebase **Web app** and copy its client configuration into `js/config.js`.
3. Treat this web configuration as public client configuration. It is included in the browser bundle; do not put provider API keys or other server secrets there.
4. Set the matching Firebase project ID in the Worker variable `FIREBASE_PROJECT_ID`.

## 2. Enable supported sign-in providers

1. In Firebase Console, enable **Google** under Authentication → Sign-in method.
2. Enable **GitHub** there and configure its OAuth client credentials using the callback URL shown by Firebase for this project.
3. Add every deployed site hostname under Authentication → Settings → Authorized domains. For local development, authorize `localhost`; the app is served at `http://localhost:4173`.

The current UI exposes Google and GitHub sign-in. Although Firebase can offer other sign-in methods, the Worker rejects `password` and `phone` provider tokens for AI API access. Do not document Email/Password or Phone as supported MyAI sign-in paths unless the frontend and Worker are changed and tested. Native Apple authentication is also not accepted by the current Worker.

## 3. Enable Firestore and deploy rules

1. Create a Firestore database in the Firebase project.
2. Publish the repository's `firestore.rules`.
3. The rules allow each signed-in user to access only:
   - `users/{uid}/chats/{chatId}`
   - `users/{uid}/private/settings`

The browser also keeps a local chat copy for offline continuity. When a user is signed in, the app attempts to synchronize durable chat records and private settings to Firestore. File contents and uploaded image bytes are removed from durable chat records; attachment names/details may remain as chat metadata.

## 4. Verify

- Test Google and GitHub sign-in on the actual local or production hostname.
- Confirm the Firebase user has a verified email; the Worker requires it.
- Save a chat and confirm it appears under that user's `users/{uid}/chats` collection.
- Confirm another account cannot read that collection or the private settings document.
- Check the browser and Worker logs for authentication or Firestore errors. Never paste an ID token or provider secret into an issue or chat.

## Items to verify before production

- Confirm the GitHub OAuth callback and authorized domains match the Firebase Console values for the deployed project.
- Confirm Firestore location, backup policy, retention, and billing settings; these are Firebase project settings, not established by this repository.
- Decide whether account deletion and deletion of associated Firestore/local data should be supported and document the user-facing process.
- If adding Email/Password, Phone, or Apple sign-in, update Worker authorization policy and tests before advertising those methods.
