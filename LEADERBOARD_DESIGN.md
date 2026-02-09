# Centralized Leaderboard Design

## Problem
Current ranking system tries to read individual user profiles, causing:
- Permission errors
- Slow performance
- Complex queries

## Solution: Single Leaderboard Document

### Firestore Structure
```
artifacts/
  sg-xiangqi/
    public/
      data/
        leaderboard (document)
          players: [
            {
              uid: "xxx",
              playerName: "Player1",
              elo: 1250,
              gamesPlayed: 10,
              wins: 7,
              losses: 2,
              draws: 1,
              lastGameAt: 1737914832000
            },
            ...
          ]
          updatedAt: timestamp
```

### Update Strategy
- When game completes, update BOTH:
  1. User's individual profile (private)
  2. Centralized leaderboard (public read)

### Benefits
- ✅ Single document read (fast)
- ✅ Public readable (no permission issues)
- ✅ Easy to query and sort
- ✅ No complex calculations on client

### Implementation Steps
1. Create leaderboard update function
2. Call it after each game
3. Update ranking.html to read from leaderboard
4. Add fallback migration script for existing users
