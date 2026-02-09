# URGENT: Manual Game Record Fix

## Game Details to Fix
- **Winner**: Red (行百里半九十)
- **Loser**: Black (CHSPrimary)
- **Current Status**: Incorrectly recorded as DRAW
- **Current ELO Change**: Red +1 (WRONG - should be ~+16)
- **Game Date**: 26 Jan 2026, 08:33 pm
- **Game ID**: Check in Firebase Console

## Steps to Fix Manually in Firebase Console

1. **Go to Firestore Database**:
   https://console.firebase.google.com/project/xiangqi-sq/firestore/data

2. **Navigate to the game history documents**:
   - `artifacts/sg-xiangqi/users/[Red Player UID]/game-history/[GameID]`
   - `artifacts/sg-xiangqi/users/[Black Player UID]/game-history/[GameID]`

3. **Update the following fields**:
   ```
   winner: "red"
   reason: "resignation"
   eloChanges.red.change: 16
   eloChanges.red.newRating: 1216
   eloChanges.black.change: -16
   eloChanges.black.newRating: 1184
   ```

4. **Update player profiles**:
   - Red player: `artifacts/sg-xiangqi/users/[Red UID]/profile/data`
     - Set `elo: 1216`

   - Black player: `artifacts/sg-xiangqi/users/[Black UID]/profile/data`
     - Set `elo: 1184`

## Automated Fix Script

Since I cannot directly access your Firebase database, YOU need to either:
1. Manually fix it in Firebase Console (steps above)
2. OR run this fix in browser console on the game page
