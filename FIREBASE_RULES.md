# Firebase Security Rules (Firestore-Only — No Storage Needed)

## Firestore Rules

Go to **Firebase Console → Firestore Database → Rules** and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Sounds collection
    match /sounds/{soundId} {
      // Anyone can read
      allow read: if true;
      
      // Must be logged in to create
      allow create: if request.auth != null
                    && request.resource.data.keys().hasAll(['name', 'audioData', 'createdAt'])
                    && request.resource.data.name is string
                    && request.resource.data.name.size() >= 2
                    && request.resource.data.name.size() <= 50;

      // Must be logged in AND (be the creator OR the specific Admin UID)
      allow update, delete: if request.auth != null && (
          request.auth.uid == resource.data.userId || 
          request.auth.uid == 'Db3uryElkEdX90GlEHsyhOMugD43'
        );
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Setup Checklist

1. Create/open your Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore Database** (Start in production mode)
3. Apply the **Firestore rules** above
4. ~~Firebase Storage is NOT needed~~ — audio is stored directly in Firestore
5. Deploy or serve locally — done!
