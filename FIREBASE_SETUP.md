# Firebase Online Login Setup

The provided Firebase web configuration is in `firebase-config.js`. Its API key and project identifiers are public browser configuration, not service credentials. Do not add a Firebase Admin SDK private key or service account JSON to this repository.

## Enable Online Login

1. Open the Firebase Console project `fuji-d3292`.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. In **Firestore Database**, create a production database.
4. In **Authentication → Users**, add the first user with an email and password.
5. Copy that user's UID. In Firestore, create `users/{uid}` with fields:

```json
{
  "name": "FUJI Administrator",
  "role": "admin"
}
```

For every other online account, create the Firebase Auth user in the console and add `users/{uid}` with `role` set to `user` or `admin`. The browser never creates or edits online role documents.

## Secure the Database

Publish the contents of `firestore.rules` in **Firestore Database → Rules**. The rules allow signed-in users to read announcements and their own profile, but only an admin profile can create, update, or delete announcements. Client writes to every user role document are denied. Create the initial admin role document in the Firebase Console, which has privileged administrative access.

Do not leave Firestore in test mode. Review the rules simulator with both an admin and a standard user before using real inventory announcements.

## Local Offline Mode

The login page defaults to **Local Machine Login**. On first use it seeds local test accounts `admin` / `admin123` and `user` / `user123`. A local admin can create more local accounts in the account menu. Local roles, sessions, and announcements are stored only in that browser profile and can be changed by anyone with access to that computer; this mode is for a trusted master machine, not a server security boundary.

The local flow does not load Firebase SDK scripts. Online mode downloads Firebase's public compat SDK from `gstatic.com` when selected, so local login remains usable with no network connection.

## Build and Publish

The static build copies `firebase-config.js` and excludes server-only configuration. GitHub Pages uses the repository's Actions workflow; set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then trigger a workflow run or push to `main`. No Firebase service-account secret is required for this static build.

For a local preview, run:

```sh
npm run build:pages
python3 -m http.server --directory dist 4173
```

Open `http://localhost:4173`. Firebase Auth requires an authorized domain; `localhost` and the published `fujitzu25.github.io` domain should be listed in **Authentication → Settings → Authorized domains**.
