# EMERGENCY DATA RESTORE

## What Happened
The auto-fix script may have accidentally cleared game history data instead of fixing it.

## Immediate Actions Needed

### Option 1: Check Firebase Console
1. Go to: https://console.firebase.google.com/project/xiangqi-sq/firestore/data
2. Navigate to: `artifacts/sg-xiangqi/users/[YOUR_UID]/game-history`
3. Check if the game documents still exist

### Option 2: Restore from Git Backup
The game data is stored in Firestore (not in git), so we cannot restore from git.

### Option 3: Contact Me for Manual Restore
I need to know:
1. What does your game records page show now?
2. What does your profile show for ELO?
3. Can you check Firebase Console to see if game history documents still exist?

## The Bug
The auto-fix script may have:
- Deleted game documents instead of updating them
- Updated wrong fields
- Cleared the game history collection

## Next Steps
1. DO NOT run the auto-fix tool again
2. Check Firebase Console to see current state
3. Share screenshot of Firebase Console showing game-history collection
