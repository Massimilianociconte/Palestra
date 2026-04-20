# Admin: migrate user emails

The `migrateUserEmails` Cloud Function now requires an admin custom claim
(`admin === true` or `role === 'admin'`). This replaces the public web page
that used to be at `migrate-emails.html` (removed for security).

## Grant the admin claim (one-off)

Run the snippet below from a machine with `firebase-admin` credentials that
have permission to manage Firebase Auth for the project:

```bash
# In a throwaway script on a trusted machine
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.auth().getUserByEmail('you@example.com')
  .then(u => admin.auth().setCustomUserClaims(u.uid, { admin: true }))
  .then(() => console.log('OK — user needs to sign out/in to refresh token'))
  .catch(console.error);
"
```

The user needs to **sign out and back in** (or call
`firebase.auth().currentUser.getIdToken(true)`) for the claim to take effect.

## Run the migration

From any page where the user (now admin) is authenticated:

```js
import { getFunctions, httpsCallable } from 'firebase/functions';
const migrate = httpsCallable(getFunctions(), 'migrateUserEmails');
const result = await migrate();
console.log(result.data);
// { success: true, migrated: N, skipped: M, errors: K, total: T }
```

## Revoke admin after use

```js
await admin.auth().setCustomUserClaims(uid, { admin: false });
```
