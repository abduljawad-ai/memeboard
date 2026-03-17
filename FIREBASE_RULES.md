# Firebase Security Rules (Firestore-Only — No Storage Needed)

## Firestore Rules

Go to **Firebase Console → Firestore Database → Rules** and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper function to check if user is verified
    function isVerified() {
      return request.auth != null && (
        request.auth.token.email_verified == true || 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.emailVerified == true ||
        request.auth.uid == 'Db3uryElkEdX90GlEHsyhOMugD43'
      );
    }

    // User profiles
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
    }

    // OTP storage (Temporary)
    match /otps/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId
                    && request.resource.data.attempts <= 3; // Brute force protection
      allow delete: if request.auth != null && request.auth.uid == userId;
    }

    // Sounds collection
    match /sounds/{soundId} {
      // Anyone can read
      allow read: if true;
      
      // Must be verified to create
      allow create: if isVerified()
                    && request.resource.data.keys().hasAll(['name', 'audioData', 'userId', 'createdAt'])
                    && request.resource.data.name is string
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
