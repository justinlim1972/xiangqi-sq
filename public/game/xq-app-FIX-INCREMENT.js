import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, deleteField, increment, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getDatabase, ref, onValue, onDisconnect, set, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { XQEngine } from "./xq-engine.js?v=206";
import { XQUI } from "./xq-ui.js?v=107";

// Voice Chat character profiles — tuned for Microsoft TTS voices
// pitch range: 0 (deepest) to 2 (highest), 1 = normal
// rate range: 0.1 (slowest) to 10 (fastest), 1 = normal
const VOICE_PROFILES = {
    'young-lady':  { label: 'Young Lady',  emoji: '👩', pitch: 1.1,  rate: 0.95, gender: 'female' },
    'old-man':     { label: 'Old Man',     emoji: '👴', pitch: 0.3,  rate: 0.65, gender: 'male'   },
    'old-auntie':  { label: 'Old Auntie',  emoji: '👵', pitch: 0.6,  rate: 0.7,  gender: 'female' },
    'young-man':   { label: 'Young Man',   emoji: '👨', pitch: 0.8,  rate: 1.0,  gender: 'male'   },
    'boy':         { label: 'Small Boy',   emoji: '👦', pitch: 1.4,  rate: 1.15, gender: 'male'   },
    'girl':        { label: 'Small Girl',  emoji: '👧', pitch: 1.8,  rate: 1.15, gender: 'female' },
    'baby':        { label: 'Baby',        emoji: '👶', pitch: 2.0,  rate: 0.6,  gender: 'female' },
};

/**
 * XQApp - Complete Fixed Orchestrator
 * FIXES:
 * 1. One seat per person validation
 * 2. Avatar loading on sit
 * 3. Presence list with proper highlighting
 * 4. Chat system fixed
 * 5. Piece movement system implemented
 * 6. Observer count tracking fixed
 */
export class XQApp {
    constructor() {
        const config = {
            apiKey: "AIzaSyDq_LECOrc4SY90SyDsBQGmwl-YnUNFIj8",
            authDomain: "xiangqi-sq.firebaseapp.com",
            databaseURL: "https://xiangqi-sq-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "xiangqi-sq",
            storageBucket: "xiangqi-sq.firebasestorage.app",
            messagingSenderId: "351923336298",
            appId: "1:351923336298:web:e7278ea095ba085ac4935b"
        };
        this.fb = initializeApp(config);
        this.auth = getAuth(this.fb);
        this.db = getFirestore(this.fb);
        this.rtdb = getDatabase(this.fb); // Realtime Database for presence
        this.appId = 'sg-xiangqi';
        
        const params = new URLSearchParams(window.location.search);
        this.tid = params.get('id'); 
        this.rid = params.get('rid');
        this.rewardTile = params.get('tile') || "🀄";
        
        this.engine = new XQEngine();
        this.ui = new XQUI();
        this.user = null;
        this.profile = null;
        this.table = null;
        this.gameState = null;
        this.previousGameStatus = null; // Track previous game status to detect battle start
        this.previousTurn = null; // Track previous turn to detect turn changes
        this.currentGameGeneration = null; // Track game startedAt to detect new games
        this._animationTimeout = null; // Track pending animation timeout for cancellation
        this.occupants = []; // Initialize as empty array
        this.lastButtonState = null; // Track button state to prevent unnecessary recreation
        this.myPieceStyle = 'ivory'; // Default piece style
        this.myBoardStyle = 'classic'; // Default board style
        this.myEnvironmentBg = 'forest'; // Default environment background
        this.presenceRef = null; // Realtime Database presence reference

        // Sound system - using simple tone generation for now (can replace with real sounds later)
        this.sounds = {
            pickup: this.createToneSound(800, 0.08, 0.3),    // High short beep for pickup (200% louder)
            place: this.createToneSound(400, 0.1, 0.45),      // Lower beep for placement (200% louder)
            capture: null,  // Will use TTS for "吃"
            check: null,    // Will use TTS for "将军"
            victory: null   // Will use TTS for victory announcement
        };

        // Move selection state
        this.selectedPiece = null; // {x, y}
        this.validMoves = [];

        // Add sitting lock to prevent double-clicks
        this.isSitting = false;

        // Add move lock to prevent double-click piece disappearance
        this.isMoving = false;

        // Track last move timestamp to avoid duplicate animations
        this.lastMoveTimestamp = null;
        this.hasCompletedFirstSync = false; // Track if we've completed the initial page load sync
        this.lastResignationTimestamp = null; // Track resignation timestamp to avoid duplicate animations

        // NEW TIMESTAMP-BASED TIMER SYSTEM
        // Only display interval, no countdown logic
        this.timerDisplayInterval = null;
        this.timeIncrement = 0; // Will be loaded from region data

        // Settings (load from localStorage and remember user's preference)
        // If value is null (never set), default to ON
        // If value is 'true', setting is ON
        // If value is 'false', setting is OFF (respect user's choice)
        const musicSetting = localStorage.getItem('xq-setting-music');
        const soundSetting = localStorage.getItem('xq-setting-sound');
        const animationSetting = localStorage.getItem('xq-setting-animation');
        const autosaveSetting = localStorage.getItem('xq-setting-autosave');
        const voiceChatSetting = localStorage.getItem('xq-setting-voiceChat');
        const voiceTypeSetting = localStorage.getItem('xq-setting-voiceType');

        this.settings = {
            sound: soundSetting !== 'false', // default ON if null, OFF if 'false'
            animation: animationSetting !== 'false', // default ON if null, OFF if 'false'
            autosave: autosaveSetting !== 'false', // default ON if null, OFF if 'false'
            music: musicSetting !== 'false', // default ON if null, OFF if 'false'
            voiceChat: voiceChatSetting === 'true', // default OFF - opt-in feature
            voiceType: (voiceTypeSetting && VOICE_PROFILES[voiceTypeSetting]) ? voiceTypeSetting : 'young-lady'
        };

        // Voice chat TTS: only speak messages newer than page load time
        this._voiceChatReadyTime = Date.now();
        this._spokenChatIds = new Set();

        // Pre-load TTS voices (Chrome loads them async)
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                const voices = window.speechSynthesis.getVoices();
                console.log(`🔊 TTS voices loaded: ${voices.length} voices available`);
            };
        }

        // Debug log to track settings state
        console.log('⚙️ Settings loaded from localStorage:', {
            sound: this.settings.sound + ' (localStorage: "' + soundSetting + '")',
            animation: this.settings.animation + ' (localStorage: "' + animationSetting + '")',
            autosave: this.settings.autosave + ' (localStorage: "' + autosaveSetting + '")',
            music: this.settings.music + ' (localStorage: "' + musicSetting + '")',
            voiceChat: this.settings.voiceChat + ' (localStorage: "' + voiceChatSetting + '")',
            voiceType: this.settings.voiceType + ' (localStorage: "' + voiceTypeSetting + '")'
        });

        // Ambient music system
        this.ambientMusic = null;
        this.musicUnblockListenerAdded = false; // Track if we've added autoplay unblock listener
        this.musicTracks = [
            '/music/beyond-by-onycs.mp3',
            '/music/cyber-shogun.mp3',
            '/music/digital-samurai-showdown.mp3',
            '/music/dreamcatcher-by-onycs.mp3',
            '/music/neon-arpeggio.mp3',
            '/music/paradise-by-onycs.mp3',
            '/music/solitudes-embrace.mp3',
            '/music/woven-threads.mp3'
        ];

        // Start from random track each time
        this.currentTrackIndex = Math.floor(Math.random() * this.musicTracks.length);

        // Battle request countdown timer
        this.battleRequestCountdownTimer = null;

        // Battle rejection notification timer
        this.battleRejectionCountdownTimer = null;

        // Idle seat auto-kick system
        this.IDLE_SEAT_TIMEOUT = 180;       // 3 minutes before kick
        this.IDLE_WARNING_TIME = 150;       // Warning at 2:30 (30s countdown)
        this.POST_GAME_TIMEOUT = 30;        // 30 seconds post-game to rematch
        this.POST_GAME_WARNING_TIME = 15;   // Warning at 15s post-game
        this.IDLE_CHECK_INTERVAL = 5000;    // Check every 5 seconds
        this._idleCheckInterval = null;
        this._idleWarningCountdownTimer = null;
        this._idleWarningShown = false;     // Prevent duplicate warning modals

        // Room inactivity auto-cleanup (1 hour)
        this.ROOM_INACTIVITY_TIMEOUT = 60 * 60 * 1000;  // 1 hour in ms
        this.ROOM_INACTIVITY_CHECK_INTERVAL = 60000;     // Check every 60 seconds
        this._roomInactivityInterval = null;

        // Timer sync optimization - LOCAL ONLY (no Firebase sync)
        this.timerTickCount = 0; // Track seconds elapsed for optimized syncing
        this.lastMoveTime = Date.now(); // Track when last move was made for time calculation
        this.turnStartTime = Date.now(); // Track when current turn started
        this.timersInitialized = false; // Track if timers have been initialized for mid-game join

        this.hasJoined = false;
        window.addEventListener('beforeunload', () => this.leaveRoom());

        // Load speech synthesis voices
        if ('speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = () => {
                console.log('🎤 Speech voices loaded:', window.speechSynthesis.getVoices().length);
            };
        }
    }

    async init() {
        if (!this.tid || !this.rid) return window.location.href = '../lobby/lobby.html';

        const rewardEl = document.getElementById('match-reward-tile');
        if (rewardEl) rewardEl.innerText = decodeURIComponent(this.rewardTile);

        // Initialize debug logger (safe, non-invasive)
        try {
            if (window.debugLogger) {
                window.debugLogger.init(this.tid, null); // userId will be set after auth
                console.log('🐛 Debug logger initialized');
            }
        } catch (e) {
            console.log('Debug logger initialization failed (non-critical):', e);
        }

        onAuthStateChanged(this.auth, async (u) => {
            console.log('🔐 AUTH STATE CHANGED - User:', u?.uid);
            console.log('  hasJoined flag:', this.hasJoined);

            if(!u) return window.location.href = '../index.html';
            this.user = u;

            // Update debug logger with user ID
            try {
                if (window.debugLogger) {
                    window.debugLogger.userId = u.uid;
                }
            } catch (e) {
                console.log('Debug logger user update failed (non-critical):', e);
            }

            try {
                const snap = await getDoc(doc(this.db, 'artifacts', this.appId, 'users', u.uid, 'profile', 'data'));
                this.profile = snap.data();
                console.log('👤 Profile loaded:', this.profile?.playerName);

                // Load player's preferred piece style
                if (this.profile && this.profile.pieceSet) {
                    this.myPieceStyle = this.profile.pieceSet;
                    console.log('🎨 Loaded piece style from profile:', this.myPieceStyle);
                } else {
                    console.log('⚠️ No piece style in profile, using default:', this.myPieceStyle);
                }

                // Load player's preferred board style
                if (this.profile && this.profile.boardSet) {
                    this.myBoardStyle = this.profile.boardSet;
                    console.log('🎨 Loaded board style from profile:', this.myBoardStyle);
                } else {
                    console.log('⚠️ No board style in profile, using default:', this.myBoardStyle);
                }

                // Load player's preferred environment background
                if (this.profile && this.profile.environmentBg) {
                    this.myEnvironmentBg = this.profile.environmentBg;
                    console.log('🎨 Loaded environment background:', this.myEnvironmentBg);
                }

                // Apply board styling and environment
                this.applyBoardStyle();
                this.applyEnvironmentBackground();

                // Join room - add to occupants list using transaction to prevent race conditions
                if (!this.hasJoined) {
                    const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

                    // Check for stale room and clean before joining
                    try {
                        const freshSnap = await getDoc(tRef);
                        if (freshSnap.exists()) {
                            const td = freshSnap.data();
                            const hasPlayers = td.playerRed || td.playerBlack;
                            const lastActivity = td.lastActivityAt || 0;
                            const elapsed = Date.now() - lastActivity;
                            const hasGhostOccupants = (td.occupants || []).length > 0;

                            if (!hasPlayers && elapsed > this.ROOM_INACTIVITY_TIMEOUT && (hasGhostOccupants || td.matchActive)) {
                                // Safety check: verify game data is also stale before wiping
                                const gRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                                const gSnap = await getDoc(gRef);
                                const gData = gSnap.exists() ? gSnap.data() : {};
                                const gameIsActive = gData.status === 'playing';
                                const gameJustFinished = gData.finishedAt && (Date.now() - gData.finishedAt < 300000); // 5 min grace
                                const hasGameHistory = (gData.history || []).length > 0;

                                if (gameIsActive || gameJustFinished || hasGameHistory) {
                                    // Game data still present — don't wipe, just update lastActivityAt
                                    console.log('⚠️ Skipping stale cleanup - game data still present');
                                    await setDoc(tRef, { lastActivityAt: Date.now() }, { merge: true });
                                } else {
                                    console.log(`🧹 Stale room detected on entry (idle ${Math.round(elapsed / 60000)} min). Cleaning...`);
                                    await setDoc(tRef, {
                                        occupants: [],
                                        queue: [],
                                        matchActive: false,
                                        battleRequest: deleteField(),
                                        lastActivityAt: Date.now(),
                                        postGameIdle: false
                                    }, { merge: true });
                                    await setDoc(gRef, {
                                        chat: [],
                                        board: null,
                                        status: 'waiting',
                                        history: [],
                                        moveHistory: [],
                                        turn: 'red'
                                    }, { merge: true });
                                    // Clear RTDB presence
                                    const tablePresenceRef = ref(this.rtdb, `presence/${this.rid}/${this.tid}`);
                                    await remove(tablePresenceRef);
                                    console.log('✅ Stale room cleaned on entry');
                                }
                            }
                        }
                    } catch (staleErr) {
                        console.warn('⚠️ Stale room check failed (proceeding with join):', staleErr);
                    }

                    const playerData = {
                        uid: this.user.uid,
                        name: this.profile?.playerName || this.user.email.split('@')[0],
                        elo: this.profile?.elo || 1200,
                        coins: this.profile?.coins || 0,
                        avatar: this.profile?.avatarUrl || '/lobby/1.JPG'
                    };

                    console.log('🚪 ATTEMPTING TO JOIN ROOM');
                    console.log('  My Data:', playerData);

                    try {
                        await runTransaction(this.db, async (transaction) => {
                            const tableDoc = await transaction.get(tRef);
                            if (!tableDoc.exists()) {
                                throw new Error("Table does not exist!");
                            }

                            const tableData = tableDoc.data();
                            const currentOccupants = tableData.occupants || [];

                            console.log('  📋 Current occupants BEFORE join:', currentOccupants.length);
                            console.log('  📋 Occupants UIDs:', currentOccupants.map(o => o.uid).join(', '));

                            // Check if I'm already in the list
                            const alreadyInRoom = currentOccupants.some(occ => occ.uid === this.user.uid);

                            if (!alreadyInRoom) {
                                // Add me to the occupants array atomically
                                const updatedOccupants = [...currentOccupants, playerData];
                                transaction.update(tRef, {
                                    occupants: updatedOccupants
                                });
                                console.log('✅ TRANSACTION: Added myself to occupants');
                                console.log('  📋 NEW occupants count:', updatedOccupants.length);
                                console.log('  📋 NEW Occupants UIDs:', updatedOccupants.map(o => o.uid).join(', '));
                            } else {
                                console.log('ℹ️ TRANSACTION: Already in room occupants list');
                            }
                        });
                        console.log('✅ Transaction completed successfully');
                    } catch (err) {
                        console.error('❌❌❌ TRANSACTION FAILED ❌❌❌');
                        console.error('Error name:', err.name);
                        console.error('Error message:', err.message);
                        console.error('Error code:', err.code);
                        console.error('Full error:', err);
                        alert('Failed to join room: ' + err.message);
                    }

                    this.hasJoined = true;

                    // Set up presence tracking in Realtime Database
                    await this.setupPresenceTracking();

                    // Reset room activity (observer/player joined)
                    this.resetRoomActivity();
                }

                this.syncTable();
                this.syncGame();

                // Initialize settings UI to match loaded settings
                this.initializeSettingsUI();
            } catch (err) {
                console.error("Init Error:", err);
                this.hideLoader();
            }
        });
    }

    hideLoader() {
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.pointerEvents = 'none'; // CRITICAL: Allow clicks through!
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }

    rotateBoard(board) {
        // Rotate board 180 degrees: reverse rows and reverse each row
        return board.slice().reverse().map(row => row.slice().reverse());
    }

    applyBoardStyle() {
        // Board style configurations matching setting.html
        const boardStyles = {
            classic: { bg: '#dcb35c', lineColor: '#5d2e0c', borderColor: '#2a1a10' },
            emerald: { bg: '#0a3d2e', lineColor: '#a8e6cf', borderColor: '#1a4d3a' },
            slate: { bg: '#f0f2f5', lineColor: '#2c3e50', borderColor: '#34495e' },
            mahogany: { bg: '#2a1817', lineColor: '#facc15', borderColor: '#1a0f0e' },
            bamboo: { bg: '#8ba888', lineColor: '#2d5016', borderColor: '#1a3010' },
            stone: { bg: '#6b7280', lineColor: '#1f2937', borderColor: '#111827' },
            cyber: { bg: '#0a0a0a', lineColor: '#00ffff', borderColor: '#00ffff' },
            cherry: { bg: '#ffc9d9', lineColor: '#881337', borderColor: '#4c0519' }
        };

        const style = boardStyles[this.myBoardStyle] || boardStyles.classic;

        // Update board container background
        const boardContainer = document.querySelector('.board-container');
        if (boardContainer) {
            boardContainer.style.background = style.bg;
            boardContainer.style.borderColor = style.borderColor;
        }

        // Update grid lines via UI
        this.ui.drawGrid('board-svg', style.lineColor);

        console.log('🎨 Applied board style:', this.myBoardStyle, style);
    }

    applyEnvironmentBackground() {
        // Environment background configurations matching setting.html
        const environmentBackgrounds = {
            forest: { url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1200', position: 'center center' },
            pyramid: { url: 'https://images.unsplash.com/photo-1572252009286-268acec5ca0a?q=80&w=1200', position: 'center center' },
            greatwall: { url: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1200', position: 'center center' },
            temple: { url: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?q=80&w=1200', position: 'center center' },
            mountains: { url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=1200', position: 'center center' },
            ocean: { url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?q=80&w=1200', position: 'center center' },
            aurora: { url: 'https://images.unsplash.com/photo-1579033461380-adb47c3eb938?q=80&w=1200', position: 'center center' },
            volcano: { url: 'https://images.unsplash.com/photo-1603487742131-4160ec999306?q=80&w=1200', position: 'center center' }
        };

        const envData = environmentBackgrounds[this.myEnvironmentBg] || environmentBackgrounds.forest;

        // Update environment background
        const envBg = document.getElementById('environment-bg');
        if (envBg) {
            envBg.style.backgroundImage = `url('${envData.url}')`;
            envBg.style.backgroundPosition = envData.position;
        }

        console.log('🎨 Applied environment background:', this.myEnvironmentBg, envData);
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // NEW TIMESTAMP-BASED DISPLAY UPDATE
    updateTimerDisplay() {
        if (!this.gameState || this.gameState.status !== 'playing') return;

        const g = this.gameState;

        // Calculate elapsed time since turn started
        const elapsed = g.turnStartTime ? (Date.now() - g.turnStartTime) / 1000 : 0;

        // Calculate display times
        let redDisplay = g.redTimeLeft || 0;
        let blackDisplay = g.blackTimeLeft || 0;

        // Subtract elapsed time from current player
        if (g.turn === 'red') {
            redDisplay = Math.max(0, redDisplay - elapsed);
        } else if (g.turn === 'black') {
            blackDisplay = Math.max(0, blackDisplay - elapsed);
        }

        // Update display elements
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');

        if (redTimerEl) {
            redTimerEl.innerText = this.formatTime(redDisplay);
            redTimerEl.style.display = 'block';
        }
        if (blackTimerEl) {
            blackTimerEl.innerText = this.formatTime(blackDisplay);
            blackTimerEl.style.display = 'block';
        }

        // Stress animation when under 60 seconds
        const redCard = document.getElementById('player-card-red');
        const blackCard = document.getElementById('player-card-black');

        if (redCard) {
            if (redDisplay <= 60 && redDisplay > 0) {
                redCard.classList.add('time-stress');
            } else {
                redCard.classList.remove('time-stress');
            }
        }
        if (blackCard) {
            if (blackDisplay <= 60 && blackDisplay > 0) {
                blackCard.classList.add('time-stress');
            } else {
                blackCard.classList.remove('time-stress');
            }
        }

        // Check for timeout — but NEVER on a fresh game with no moves
        const hasMoves = g.history && g.history.length > 0;
        if (!hasMoves) return;

        // Don't check timeout if timer hasn't been initialized yet
        if (!g.timerStarted || !g.redTimeLeft || !g.blackTimeLeft) return;

        if (redDisplay <= 0 && g.turn === 'red') {
            this.handleTimeout('red');
        } else if (blackDisplay <= 0 && g.turn === 'black') {
            this.handleTimeout('black');
        }
    }

    // NEW TIMESTAMP-BASED TIMER - ONLY DISPLAY UPDATES
    startTimerDisplay() {
        // Prevent multiple intervals
        if (this.timerDisplayInterval) {
            console.log('⏱️ Timer display already running');
            return;
        }

        console.log('⏱️ Starting timestamp-based timer display (300ms updates)');

        // Show timer elements
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'block';
        if (blackTimerEl) blackTimerEl.style.display = 'block';

        // Update display every 300ms for smooth countdown
        this.timerDisplayInterval = setInterval(() => {
            this.updateTimerDisplay();
        }, 300);

        // Initial display update
        this.updateTimerDisplay();
    }

    stopTimerDisplay() {
        if (this.timerDisplayInterval) {
            clearInterval(this.timerDisplayInterval);
            this.timerDisplayInterval = null;
        }

        // Hide timer displays
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'none';
        if (blackTimerEl) blackTimerEl.style.display = 'none';

        // Remove stress animation
        const redCard = document.getElementById('player-card-red');
        const blackCard = document.getElementById('player-card-black');
        if (redCard) redCard.classList.remove('time-stress');
        if (blackCard) blackCard.classList.remove('time-stress');
    }

    async handleTimeout(color) {
        // Prevent duplicate timeout calls (both players may detect timeout simultaneously)
        if (this._timeoutHandled) return;
        this._timeoutHandled = true;

        // Safety: Never declare timeout on a fresh game with no moves
        if (!this.gameState?.history || this.gameState.history.length === 0) {
            console.log('⏭️ Skipping timeout - no moves made yet in this game');
            return;
        }

        this.stopTimerDisplay();
        const winner = color === 'red' ? 'black' : 'red';

        // Show timeout animation and sound
        this.showMoveAnimation('timeout', { winner: winner, loser: color });

        // Clear matchActive flag in table and start post-game idle timer
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            matchActive: deleteField(),
            postGameIdle: true,
            playerRedSeatedAt: Date.now(),
            playerBlackSeatedAt: Date.now(),
            playerRedWarned: false,
            playerBlackWarned: false
        }, { merge: true });

        // Update game status
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        await setDoc(gameRef, {
            status: 'finished',
            winner: winner,
            reason: 'timeout',
            chat: arrayUnion({
                user: 'SYSTEM',
                text: `⏰ ${color.toUpperCase()} ran out of time! ${winner.toUpperCase()} wins!`,
                ts: Date.now()
            })
        }, { merge: true });

        // Save game to history
        await this.saveGameToHistory(winner, 'timeout');

        this.showStatus(`${color.toUpperCase()} ran out of time!`, "red");
    }

    syncTable() {
        const tableRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        onSnapshot(tableRef, snap => {
            if(!snap.exists()) return;
            this.table = snap.data();

            // Cache player data whenever both seats are occupied (for saving after a player leaves)
            // Always update cache when both seats are filled - handles page refresh, new game, etc.
            if (this.table?.playerRed?.uid && this.table?.playerBlack?.uid) {
                this._cachedPlayers = {
                    red: { ...this.table.playerRed },
                    black: { ...this.table.playerBlack }
                };
            }

            // Populate occupants list from table data
            this.occupants = this.table.occupants || [];

            console.log('═══════════════════════════════════════');
            console.log('🔄 TABLE SYNCED - Full Data:');
            console.log('  My UID:', this.user?.uid);
            console.log('  Occupants Array:', JSON.stringify(this.occupants, null, 2));
            console.log('  Occupants Count:', this.occupants.length);
            console.log('  Red Player:', this.table.playerRed?.uid);
            console.log('  Black Player:', this.table.playerBlack?.uid);
            console.log('  Battle Request:', this.table.battleRequest);
            console.log('═══════════════════════════════════════');

            // Handle ambient music based on occupant count
            this.handleMusicOnOccupantsChange();

            // Start room inactivity monitor (only starts once)
            this.startRoomInactivityCheck();

            // Update player displays
            document.getElementById('name-red').innerText = this.table.playerRed?.name || 'Empty Slot';
            document.getElementById('name-black').innerText = this.table.playerBlack?.name || 'Empty Slot';

            const redImg = document.getElementById('avatar-red');
            const blackImg = document.getElementById('avatar-black');
            if (redImg) redImg.src = this.table.playerRed?.avatar || '/lobby/1.JPG';
            if (blackImg) blackImg.src = this.table.playerBlack?.avatar || '/lobby/1.JPG';

            // Update table owner badges
            const ownerBadgeRed = document.getElementById('owner-badge-red');
            const ownerBadgeBlack = document.getElementById('owner-badge-black');
            const tableOwner = this.table.tableOwner;

            if (ownerBadgeRed) {
                ownerBadgeRed.style.display = (tableOwner && this.table.playerRed?.uid === tableOwner.uid) ? 'inline' : 'none';
            }
            if (ownerBadgeBlack) {
                ownerBadgeBlack.style.display = (tableOwner && this.table.playerBlack?.uid === tableOwner.uid) ? 'inline' : 'none';
            }

            // Update player card borders to show RED/BLACK clearly
            const redCard = document.getElementById('player-card-red');
            const blackCard = document.getElementById('player-card-black');

            if (redCard) {
                redCard.classList.remove('occupied-red', 'empty-slot');
                redCard.classList.add(this.table.playerRed ? 'occupied-red' : 'empty-slot');
            }

            if (blackCard) {
                blackCard.classList.remove('occupied-black', 'empty-slot');
                blackCard.classList.add(this.table.playerBlack ? 'occupied-black' : 'empty-slot');
            }

            // Update presence list
            this.renderPresenceList();

            // Check for draw offer and show modal
            this.checkDrawOfferModal();

            // Check for battle request and show modal
            this.checkBattleRequestModal();

            // Check for battle rejection notification
            this.checkBattleRejectionNotification();

            // Check for battle timeout notification (opponent booted for not responding)
            this.checkBattleTimeoutNotification();

            // Show/hide seating controls BASED ON CURRENT TABLE STATE
            const seatingArea = document.getElementById('seating-area');
            const btnEngage = document.getElementById('btn-engage');
            
            const iAmRed = this.table.playerRed?.uid === this.user.uid;
            const iAmBlack = this.table.playerBlack?.uid === this.user.uid;
            const iAmSeated = iAmRed || iAmBlack;
            
            // Track button state to avoid unnecessary recreation
            const currentState = {
                iAmSeated,
                iAmRed,
                iAmBlack,
                redEmpty: !this.table.playerRed,
                blackEmpty: !this.table.playerBlack
            };
            
            const stateChanged = !this.lastButtonState || 
                this.lastButtonState.iAmSeated !== currentState.iAmSeated || 
                this.lastButtonState.iAmRed !== currentState.iAmRed || 
                this.lastButtonState.iAmBlack !== currentState.iAmBlack ||
                this.lastButtonState.redEmpty !== currentState.redEmpty ||
                this.lastButtonState.blackEmpty !== currentState.blackEmpty;
            
            if (stateChanged) {
                console.log('🔄 Button state changed, rebuilding...');
                // Button state has changed, rebuild them
                this.updateSeatingButtons(iAmSeated, iAmRed, iAmBlack);
                
                // Save current state
                this.lastButtonState = currentState;
            } else {
                console.log('⏭️ Button state unchanged, skipping rebuild');
            }

            // Show engage button only if both seats filled and I'm seated
            if (btnEngage) {
                const bothSeated = this.table.playerRed && this.table.playerBlack;
                const battleRequest = this.table.battleRequest;

                console.log('🎮 Engage button logic:', {
                    bothSeated,
                    iAmSeated,
                    matchActive: this.table.matchActive,
                    battleRequest,
                    myUid: this.user?.uid
                });

                if (bothSeated && iAmSeated && !this.table.matchActive) {
                    if (!battleRequest) {
                        // No request pending - clear requester countdown if running
                        if (this.requesterCountdownTimer) {
                            clearInterval(this.requesterCountdownTimer);
                            this.requesterCountdownTimer = null;
                            console.log('🔄 Requester countdown cleared - battle request resolved');
                        }
                        // No request yet - show "Request Battle"
                        console.log('✅ Showing REQUEST BATTLE button');
                        btnEngage.style.display = 'block';
                        btnEngage.innerText = 'REQUEST BATTLE';
                        btnEngage.disabled = false;
                        btnEngage.style.opacity = '1';
                        btnEngage.onclick = () => this.requestBattle();
                    } else if (battleRequest.from === this.user.uid) {
                        // I sent the request - show "Waiting..."
                        console.log('⏳ Showing WAITING FOR OPPONENT');
                        btnEngage.style.display = 'block';
                        btnEngage.innerText = 'WAITING FOR OPPONENT...';
                        btnEngage.disabled = true;
                        btnEngage.style.opacity = '0.5';
                    } else {
                        // Opponent sent request - show "Accept Battle"
                        console.log('✅ Showing ACCEPT BATTLE');
                        btnEngage.style.display = 'block';
                        btnEngage.innerText = 'ACCEPT BATTLE';
                        btnEngage.disabled = false;
                        btnEngage.style.opacity = '1';
                        btnEngage.onclick = () => this.acceptBattle();
                    }
                } else {
                    // Match active or not both seated - clear requester countdown
                    if (this.requesterCountdownTimer) {
                        clearInterval(this.requesterCountdownTimer);
                        this.requesterCountdownTimer = null;
                    }
                    btnEngage.style.display = 'none';
                }
            }

            // Update in-game controls
            console.log('📞 Calling updateInGameControls from syncTable()');
            this.updateInGameControls();

            // Update queue display whenever table data changes
            this.updateQueueDisplay();

            // Idle seat monitoring
            this.manageIdleMonitoring();
            this.updateIdleBadges();

            this.hideLoader();
        });
    }

    // ═══════════════════════════════════════════
    // IDLE SEAT AUTO-KICK SYSTEM
    // ═══════════════════════════════════════════

    manageIdleMonitoring() {
        const shouldMonitor = this.table &&
            (this.table.playerRed || this.table.playerBlack) &&
            !this.table.matchActive;

        if (shouldMonitor && !this._idleCheckInterval) {
            this._idleCheckInterval = setInterval(() => {
                this.checkIdleSeats();
            }, this.IDLE_CHECK_INTERVAL);
            console.log('⏰ Started idle seat monitoring');
        } else if (!shouldMonitor && this._idleCheckInterval) {
            clearInterval(this._idleCheckInterval);
            this._idleCheckInterval = null;
            this._idleWarningShown = false;
            // Hide warning modal if game started
            const modal = document.getElementById('idle-warning-modal');
            if (modal) modal.style.display = 'none';
            if (this._idleWarningCountdownTimer) {
                clearInterval(this._idleWarningCountdownTimer);
                this._idleWarningCountdownTimer = null;
            }
            console.log('⏰ Stopped idle seat monitoring');
        }
    }

    checkIdleSeats() {
        if (!this.user || !this.table) return;
        if (this.table.matchActive) return;
        if (this.table.battleRequest) return; // Active battle request = not idle

        const now = Date.now();
        const isPostGame = this.table.postGameIdle === true;
        const timeout = isPostGame ? this.POST_GAME_TIMEOUT : this.IDLE_SEAT_TIMEOUT;
        const warningTime = isPostGame ? this.POST_GAME_WARNING_TIME : this.IDLE_WARNING_TIME;

        // Check RED seat
        if (this.table.playerRed && this.table.playerRedSeatedAt) {
            const idleSeconds = (now - this.table.playerRedSeatedAt) / 1000;
            if (idleSeconds >= timeout) {
                this.kickIdlePlayer('red');
            } else if (idleSeconds >= warningTime && !this.table.playerRedWarned) {
                this.showIdleWarning('red', timeout - idleSeconds);
            }
        }

        // Check BLACK seat
        if (this.table.playerBlack && this.table.playerBlackSeatedAt) {
            const idleSeconds = (now - this.table.playerBlackSeatedAt) / 1000;
            if (idleSeconds >= timeout) {
                this.kickIdlePlayer('black');
            } else if (idleSeconds >= warningTime && !this.table.playerBlackWarned) {
                this.showIdleWarning('black', timeout - idleSeconds);
            }
        }
    }

    async showIdleWarning(side, timeRemaining) {
        const playerData = side === 'red' ? this.table.playerRed : this.table.playerBlack;
        if (!playerData) return;

        const iAmIdle = playerData.uid === this.user.uid;

        // Set warned flag in Firestore (so observers see the badge)
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const warnedKey = side === 'red' ? 'playerRedWarned' : 'playerBlackWarned';

        try {
            await setDoc(tRef, { [warnedKey]: true }, { merge: true });
        } catch (e) {
            console.error('⚠️ Failed to set warned flag:', e);
        }

        // Post warning to chat (visible to everyone)
        const playerName = playerData.name || 'Player';
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        try {
            await setDoc(gameRef, {
                chat: arrayUnion({
                    user: 'SYSTEM',
                    text: `⚠️ ${playerName} will be kicked for idling in ${Math.ceil(timeRemaining)} seconds!`,
                    ts: Date.now()
                })
            }, { merge: true });
        } catch (e) {
            console.error('⚠️ Failed to post idle warning chat:', e);
        }

        // Show modal only to the idle player
        if (iAmIdle && !this._idleWarningShown) {
            this._idleWarningShown = true;
            const modal = document.getElementById('idle-warning-modal');
            if (modal) {
                modal.style.display = 'flex';
                this.startIdleWarningCountdown(Math.ceil(timeRemaining));
            }
        }
    }

    startIdleWarningCountdown(initialTime) {
        if (this._idleWarningCountdownTimer) {
            clearInterval(this._idleWarningCountdownTimer);
        }

        let timeLeft = initialTime;
        const countdownEl = document.getElementById('idle-countdown');
        if (countdownEl) countdownEl.innerText = timeLeft;

        this._idleWarningCountdownTimer = setInterval(() => {
            timeLeft--;
            if (countdownEl) countdownEl.innerText = Math.max(0, timeLeft);
            if (timeLeft <= 0) {
                clearInterval(this._idleWarningCountdownTimer);
                this._idleWarningCountdownTimer = null;
            }
        }, 1000);
    }

    async dismissIdleWarning() {
        // Hide modal
        const modal = document.getElementById('idle-warning-modal');
        if (modal) modal.style.display = 'none';
        this._idleWarningShown = false;

        if (this._idleWarningCountdownTimer) {
            clearInterval(this._idleWarningCountdownTimer);
            this._idleWarningCountdownTimer = null;
        }

        // Reset idle timer in Firestore
        const iAmRed = this.table?.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user.uid;
        if (!iAmRed && !iAmBlack) return;

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const updates = {};

        if (iAmRed) {
            updates.playerRedSeatedAt = Date.now();
            updates.playerRedWarned = false;
        }
        if (iAmBlack) {
            updates.playerBlackSeatedAt = Date.now();
            updates.playerBlackWarned = false;
        }

        try {
            await setDoc(tRef, updates, { merge: true });
            console.log('⏰ Idle timer reset - user acknowledged presence');
            this.showStatus("Idle timer reset", "gold");
        } catch (e) {
            console.error('❌ Failed to reset idle timer:', e);
        }
    }

    async kickIdlePlayer(side) {
        const playerData = side === 'red' ? this.table.playerRed : this.table.playerBlack;
        if (!playerData) return;

        // Only the idle player's own client OR the table owner should execute the kick
        const iAmIdlePlayer = playerData.uid === this.user.uid;
        const iAmOwner = this.table.tableOwner?.uid === this.user.uid;
        if (!iAmIdlePlayer && !iAmOwner) return;

        console.log(`⏰ Kicking idle player from ${side} seat: ${playerData.name}`);

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

        try {
            // Fresh read to prevent race conditions
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();

            if (t.matchActive) return;
            if (t.battleRequest) return;

            const seatKey = side === 'red' ? 'playerRed' : 'playerBlack';
            const freshPlayer = t[seatKey];
            if (!freshPlayer) return;

            // Double-check timeout
            const seatedAtKey = side === 'red' ? 'playerRedSeatedAt' : 'playerBlackSeatedAt';
            const seatedAt = t[seatedAtKey];
            if (!seatedAt) return;

            const isPostGame = t.postGameIdle === true;
            const timeout = isPostGame ? this.POST_GAME_TIMEOUT : this.IDLE_SEAT_TIMEOUT;
            const idleSeconds = (Date.now() - seatedAt) / 1000;
            if (idleSeconds < timeout) return;

            const playerName = freshPlayer.name || 'Player';

            const updates = {
                [seatKey]: deleteField(),
                [seatedAtKey]: deleteField(),
                [side === 'red' ? 'playerRedWarned' : 'playerBlackWarned']: deleteField()
            };

            if (t.battleRequest) {
                updates.battleRequest = deleteField();
            }

            // Handle ownership transfer
            const opponentStillSeated = side === 'red' ? t.playerBlack : t.playerRed;
            const kickedPlayerIsOwner = t.tableOwner?.uid === freshPlayer.uid;

            if (kickedPlayerIsOwner) {
                if (opponentStillSeated) {
                    updates.tableOwner = {
                        uid: opponentStillSeated.uid,
                        name: opponentStillSeated.name,
                        since: Date.now()
                    };
                } else {
                    updates.tableOwner = deleteField();
                }
            }

            await setDoc(tRef, updates, { merge: true });
            console.log(`✅ Kicked ${playerName} for being idle`);

            // Post system chat message
            const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
            await setDoc(gameRef, {
                chat: arrayUnion({
                    user: 'SYSTEM',
                    text: `⏰ ${playerName} was removed for inactivity`,
                    ts: Date.now()
                })
            }, { merge: true });

            // Show notification
            if (iAmIdlePlayer) {
                this.showStatus("You were removed for inactivity", "red");
                const modal = document.getElementById('idle-warning-modal');
                if (modal) modal.style.display = 'none';
                this._idleWarningShown = false;
            } else {
                this.showStatus(`${playerName} was removed for inactivity`, "gold");
            }

        } catch (error) {
            console.error('❌ Kick idle player error:', error);
        }
    }

    updateIdleBadges() {
        const redBadge = document.getElementById('idle-badge-red');
        const blackBadge = document.getElementById('idle-badge-black');

        if (redBadge) {
            redBadge.style.display = this.table?.playerRedWarned ? 'inline' : 'none';
        }
        if (blackBadge) {
            blackBadge.style.display = this.table?.playerBlackWarned ? 'inline' : 'none';
        }
    }

    // ========== ROOM INACTIVITY AUTO-CLEANUP (1 HOUR) ==========

    /**
     * Reset the room activity timestamp. Called whenever meaningful activity occurs.
     */
    async resetRoomActivity() {
        if (!this.tid || !this.rid) return;
        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            await setDoc(tRef, { lastActivityAt: Date.now() }, { merge: true });
        } catch (e) {
            console.warn('⚠️ Failed to reset room activity timestamp:', e);
        }
    }

    /**
     * Start the room inactivity check interval. Only starts once.
     */
    startRoomInactivityCheck() {
        if (this._roomInactivityInterval) return; // Already running
        console.log('🕐 Starting room inactivity monitor (1 hour timeout)');

        // Main check every 60 seconds
        this._roomInactivityInterval = setInterval(() => {
            this.checkRoomInactivity();
        }, this.ROOM_INACTIVITY_CHECK_INTERVAL);

        // Also check immediately when user returns to tab (browser throttles timers in background)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Tab became visible - running inactivity check');
                this.checkRoomInactivity();
            }
        });
    }

    /**
     * Check if the room has been inactive for 1 hour and perform cleanup.
     */
    async checkRoomInactivity() {
        if (!this.table || !this.user) return;

        // Skip if either seat is occupied (players are present)
        if (this.table.playerRed || this.table.playerBlack) return;

        // Safeguard: if matchActive is true but both seats are empty, it's stale — force clear it
        if (this.table.matchActive) {
            console.log('⚠️ matchActive is true but both seats empty — clearing stale matchActive');
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            await setDoc(tRef, { matchActive: false }, { merge: true });
            return; // Will trigger cleanup on next check
        }

        const lastActivity = this.table.lastActivityAt || 0;
        const elapsed = Date.now() - lastActivity;

        if (elapsed < this.ROOM_INACTIVITY_TIMEOUT) return;

        console.log(`🧹 Room inactive for ${Math.round(elapsed / 60000)} minutes. Performing cleanup...`);

        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            const gRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);

            // 1. Clear all occupants from table
            await setDoc(tRef, {
                occupants: [],
                queue: [],
                battleRequest: deleteField(),
                matchActive: false,
                lastActivityAt: Date.now()
            }, { merge: true });

            // 2. Clear chat and reset game state
            await setDoc(gRef, {
                chat: [],
                board: null,
                status: 'waiting',
                history: [],
                moveHistory: [],
                turn: 'red'
            }, { merge: true });

            // 3. Clear all presence entries from RTDB
            const tablePresenceRef = ref(this.rtdb, `presence/${this.rid}/${this.tid}`);
            await remove(tablePresenceRef);

            console.log('✅ Room cleanup complete - observers kicked, chat cleared');

            // Redirect this client back to lobby since they were kicked
            window.location.href = '../lobby/lobby.html';

        } catch (error) {
            console.error('❌ Room inactivity cleanup failed:', error);
        }
    }

    updateInGameControls() {
        // Safety check - make sure we have necessary data
        if (!this.user || !this.table) {
            console.log('⚠️ updateInGameControls skipped - waiting for user/table data');
            return;
        }

        const btnUnseat = document.getElementById('btn-unseat');
        const btnResign = document.getElementById('btn-resign');
        const btnDraw = document.getElementById('btn-draw');

        // Check if I'm seated
        const iAmRed = this.table.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table.playerBlack?.uid === this.user.uid;
        const iAmSeated = iAmRed || iAmBlack;

        const gameIsPlaying = this.gameState && this.gameState.status === 'playing';

        console.log('🎮 In-game controls logic:', {
            gameIsPlaying,
            iAmSeated,
            iAmRed,
            iAmBlack,
            gameStatus: this.gameState?.status,
            myUid: this.user?.uid,
            redUid: this.table.playerRed?.uid,
            blackUid: this.table.playerBlack?.uid,
            showInGameControls: gameIsPlaying && iAmSeated
        });

        // FIX: Show/hide timers based on game status (not seating status)
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');

        if (gameIsPlaying) {
            // Game is active - show timers for EVERYONE (players and observers)
            if (redTimerEl) redTimerEl.style.display = 'block';
            if (blackTimerEl) blackTimerEl.style.display = 'block';
        } else {
            // Game not active - hide timers
            if (redTimerEl) redTimerEl.style.display = 'none';
            if (blackTimerEl) blackTimerEl.style.display = 'none';
        }

        if (gameIsPlaying && iAmSeated) {
            // Game is active AND I'm seated - hide UNSEAT, show RESIGN and OFFER DRAW
            console.log('✅ Showing RESIGN and OFFER DRAW buttons');
            if (btnUnseat) btnUnseat.style.display = 'none';
            if (btnResign) btnResign.style.display = 'block';
            if (btnDraw) btnDraw.style.display = 'block';
        } else {
            // Game not active OR I'm an observer - hide RESIGN and OFFER DRAW
            console.log('❌ Hiding RESIGN and OFFER DRAW buttons');
            if (btnResign) btnResign.style.display = 'none';
            if (btnDraw) btnDraw.style.display = 'none';
            // btnUnseat visibility is already controlled by updateSeatingButtons
        }
    }

    renderPresenceList() {
        const countDisplay = document.getElementById('presence-count');
        const listContainer = document.getElementById('presence-list');

        console.log('🎯 renderPresenceList called');
        console.log('🎯 this.occupants:', this.occupants);
        console.log('🎯 this.occupants type:', typeof this.occupants);
        console.log('🎯 this.occupants.length:', this.occupants?.length);
        console.log('🎯 countDisplay element:', countDisplay);
        console.log('🎯 listContainer element:', listContainer);

        if (!listContainer || !countDisplay) {
            console.error('❌ Presence DOM elements not found!', {
                countDisplay: !!countDisplay,
                listContainer: !!listContainer
            });
            return;
        }

        // Safety check
        if (!this.occupants || !Array.isArray(this.occupants)) {
            console.warn('⚠️ Occupants not ready yet - showing syncing message');
            console.log('  this.occupants value:', this.occupants);
            console.log('  typeof this.occupants:', typeof this.occupants);
            console.log('  Array.isArray(this.occupants):', Array.isArray(this.occupants));
            countDisplay.innerText = 'SYNCING...';
            listContainer.innerHTML = '<div style="padding: 15px; text-align: center; color: #666;">Waiting for room data...</div>';
            return;
        }

        // Use actual presence data, not calculated observers
        const totalCount = this.occupants.length;
        console.log('👥 Total occupants:', totalCount);
        console.log('👥 Occupants data:', JSON.stringify(this.occupants, null, 2));

        countDisplay.innerText = `${totalCount} PEOPLE ONLINE`;

        if (totalCount === 0) {
            listContainer.innerHTML = '<div style="padding: 15px; text-align: center; color: #666;">No one in the room</div>';
            console.log('✅ Presence list updated (empty room)');
            return;
        }

        const htmlContent = this.occupants.map(p => {
            let styleClass = "";
            let roleText = "OBSERVER";

            if (this.table?.playerRed?.uid === p.uid) {
                styleClass = "p-red";
                roleText = "RED PLAYER";
            } else if (this.table?.playerBlack?.uid === p.uid) {
                styleClass = "p-black";
                roleText = "BLACK PLAYER";
            }

            const elo = p.elo || 1200;
            const coins = p.coins || 0;

            console.log('👤 Rendering:', p.name, roleText, elo, coins, styleClass);

            return `
                <div class="presence-item ${styleClass || 'p-observer'}">
                    <div class="presence-info">
                        <strong>${p.name}</strong>
                        <em>${roleText} | ELO: ${elo} | Coins: ${coins}</em>
                    </div>
                </div>
            `;
        }).join('');

        console.log('✅ Setting HTML content, length:', htmlContent.length);
        listContainer.innerHTML = htmlContent;
        console.log('✅ Presence list updated successfully');
    }

    syncGame() {
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        onSnapshot(gameRef, async (snap) => {
            const g = snap.data() || {};
            this.gameState = g;

            // Cache player data from game document if available (set by engageBattle)
            // This ensures _cachedPlayers survives page refresh and seat changes
            if (g.playerRed?.uid && g.playerBlack?.uid && !this._cachedPlayers) {
                this._cachedPlayers = {
                    red: { ...g.playerRed },
                    black: { ...g.playerBlack }
                };
                console.log('📋 Cached player data from game document');
            }

            console.log('🎮 Game state updated:', {
                status: g.status,
                hasBoard: !!g.board,
                boardType: typeof g.board,
                timestamp: Date.now()
            });

            // NEW TIMESTAMP-BASED: Initialize timer when battle starts
            const battleJustStarted = g.status === 'playing' && this.previousGameStatus !== null && this.previousGameStatus !== 'playing';

            // Also detect new game by startedAt changing
            const gameGeneration = g.startedAt || 0;
            if (this.currentGameGeneration && gameGeneration !== this.currentGameGeneration && g.status === 'playing') {
                console.log('🔄 New game generation detected! Old:', this.currentGameGeneration, 'New:', gameGeneration);
                this.lastMoveTimestamp = null;
                this.hasCompletedFirstSync = false;
                this.lastResignationTimestamp = null;
                // Cancel any pending animation timeouts
                if (this._animationTimeout) {
                    clearTimeout(this._animationTimeout);
                    this._animationTimeout = null;
                }
                // Hide any lingering animation
                const animEl = document.getElementById('move-animation');
                if (animEl) animEl.style.display = 'none';
                // Hide game-over overlay
                const overlayEl = document.getElementById('game-over-overlay');
                if (overlayEl) {
                    overlayEl.classList.remove('show');
                    overlayEl.style.opacity = '0';
                    overlayEl.style.visibility = 'hidden';
                }
                this.hidePerpetualCheckWarning();
                this._timeoutHandled = false; // Reset timeout guard for new game
                this._queueProcessed = false; // Reset queue processing guard
                this[`${this.tid}_histor_saved`] = false; // Reset auto-save guard for new game
            }
            this.currentGameGeneration = gameGeneration;

            if (battleJustStarted) {
                console.log('⚔️ Battle just started! Initializing timestamp-based timer...');

                // Reset local state tracking to prevent old game announcements from replaying
                this.lastMoveTimestamp = null;
                this.hasCompletedFirstSync = false;
                this.lastResignationTimestamp = null;
                // Cancel any pending animation timeouts
                if (this._animationTimeout) {
                    clearTimeout(this._animationTimeout);
                    this._animationTimeout = null;
                }
                // Hide any lingering animation or game-over overlay from previous game
                const animEl = document.getElementById('move-animation');
                if (animEl) animEl.style.display = 'none';
                const overlayEl = document.getElementById('game-over-overlay');
                if (overlayEl) {
                    overlayEl.classList.remove('show');
                    overlayEl.style.opacity = '0';
                    overlayEl.style.visibility = 'hidden';
                }
                this.hidePerpetualCheckWarning();
                this._timeoutHandled = false; // Reset timeout guard for new game
                this._queueProcessed = false; // Reset queue processing guard for new game
                this[`${this.tid}_histor_saved`] = false; // Reset auto-save guard for new game

                // Cache player data at game start so we can save even if a player leaves
                this._cachedPlayers = {
                    red: this.table?.playerRed ? { ...this.table.playerRed } : null,
                    black: this.table?.playerBlack ? { ...this.table.playerBlack } : null
                };
                console.log('📋 Cached player data for save:', this._cachedPlayers);
                console.log('🔄 Local announcement state reset for new game');

                const iAmRed = this.table?.playerRed?.uid === this.user?.uid;

                if (iAmRed) {
                    console.log('⏱️🔴 I am RED - initializing timer with server timestamp');

                    // Get time control
                    const regionRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid);
                    getDoc(regionRef).then(regionSnap => {
                        const baseTime = (regionSnap.data()?.baseTime || 15) * 60;
                        const increment = regionSnap.data()?.increment || 0;
                        this.timeIncrement = increment;

                        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                        setDoc(gameRef, {
                            redTimeLeft: baseTime,
                            blackTimeLeft: baseTime,
                            turnStartTime: Date.now(), // Use current timestamp
                            timerStarted: true
                        }, { merge: true }).then(() => {
                            console.log(`⏱️✅ Timer initialized: ${baseTime}s each, increment: ${increment}s`);
                        });
                    });
                }
            }

            // Update previous status for next comparison (set to null on first load if no previous status)
            if (this.previousGameStatus === null) {
                this.previousGameStatus = g.status; // Initialize without triggering splash
            } else {
                this.previousGameStatus = g.status;
            }

            // Start timer display if game is playing
            if (g.status === 'playing' && !this.timerDisplayInterval) {
                this.startTimerDisplay();
            } else if (g.status !== 'playing' && this.timerDisplayInterval) {
                this.stopTimerDisplay();
            }

            this.previousTurn = g.turn;

            // Update button visibility when game state changes
            console.log('📞 Calling updateInGameControls from syncGame()');
            this.updateInGameControls();

            // Update chat (desktop sidebar - may not exist on mobile)
            const log = document.getElementById('chat-log');
            if(log && g.chat) {
                log.innerHTML = g.chat.slice(-50).map(m =>
                    `<div class="chat-msg"><strong>${m.user}:</strong> ${this.renderChatText(m.text, m.voiceType)}</div>`
                ).join('');
                log.scrollTop = log.scrollHeight;
            }

            // Voice Chat TTS - speak any new bracketed messages
            if (g.chat) this.speakVoiceChat(g.chat);

            // Update chat history modal (mobile)
            const historyLog = document.getElementById('chat-history-log');
            if(historyLog && g.chat) {
                historyLog.innerHTML = g.chat.slice(-50).map(m =>
                    `<div class="chat-msg">
                        <div class="chat-msg-author">${m.user}</div>
                        <div class="chat-msg-text">${this.renderChatText(m.text)}</div>
                    </div>`
                ).join('');
                historyLog.scrollTop = historyLog.scrollHeight;
            }

            // Update floating chat bubble (mobile)
            if (g.chat && g.chat.length > 0) {
                this.updateFloatingChatBubble(g.chat);
            }

            // Auto-update MOVES tab if it's active
            const movesTab = document.getElementById('tab-content-moves');
            if (movesTab && movesTab.classList.contains('active')) {
                this.updateFENDisplay();
                this.updateMoveHistory();
            }

            // Check for move animations (lastMove changed)
            console.log('🔍 Checking lastMove:', {
                hasLastMove: !!g.lastMove,
                lastMoveTs: g.lastMove?.ts,
                currentTimestamp: this.lastMoveTimestamp,
                hasCompletedFirstSync: this.hasCompletedFirstSync,
                willTrigger: g.lastMove && g.lastMove.ts !== this.lastMoveTimestamp
            });

            if (g.lastMove && g.lastMove.ts !== this.lastMoveTimestamp) {
                const isInitialPageLoad = !this.hasCompletedFirstSync;
                const previousTimestamp = this.lastMoveTimestamp;
                this.lastMoveTimestamp = g.lastMove.ts;

                // Calculate how long ago this move happened
                const moveAge = Date.now() - g.lastMove.ts;
                const isRecentMove = moveAge < 5000; // Move happened within last 5 seconds

                console.log('🎬 Move detected:', {
                    isCapture: g.lastMove.isCapture,
                    isCheck: g.lastMove.isCheck,
                    isCheckmate: g.lastMove.isCheckmate,
                    isStalemate: g.lastMove.isStalemate,
                    timestamp: g.lastMove.ts,
                    moveAge: moveAge,
                    isRecentMove: isRecentMove,
                    isInitialPageLoad: isInitialPageLoad,
                    previousTimestamp: previousTimestamp
                });

                // Show animation if:
                // 1. This is NOT the initial page load (already synced before), OR
                // 2. This IS the initial page load BUT the move is very recent (happened in last 5 seconds)
                const shouldShowAnimation = !isInitialPageLoad || isRecentMove;

                this.hasCompletedFirstSync = true; // Mark that we've completed first sync

                if (shouldShowAnimation) {
                    console.log('✅ Showing animation - recent move or already synced');

                    // Cancel any previous pending animation timeout
                    if (this._animationTimeout) {
                        clearTimeout(this._animationTimeout);
                    }

                    // Capture the game generation at the time of this snapshot
                    const snapshotGeneration = g.startedAt || 0;

                    // Show animation for all clients (including the one who made the move)
                    this._animationTimeout = setTimeout(() => {
                        this._animationTimeout = null;

                        // CRITICAL: If a new game has started since this timeout was set, skip animation
                        if (this.currentGameGeneration !== snapshotGeneration) {
                            console.log('⏭️ Skipping stale animation - new game started since timeout was set');
                            return;
                        }

                        // CRITICAL: No moves made yet = fresh game, never announce any result
                        const hasMovesInGame = this.gameState?.history && this.gameState.history.length > 0;
                        if (!hasMovesInGame) {
                            console.log('⏭️ Skipping animation - no moves made yet in this game');
                            return;
                        }

                        // Use CURRENT game state (not snapshot's stale g) to decide animations
                        const currentStatus = this.gameState?.status;
                        const currentWinner = this.gameState?.winner;
                        const currentReason = this.gameState?.reason;

                        // CRITICAL: If game is now 'playing' (new game), skip any game-ending animations
                        if (currentStatus === 'playing') {
                            // Only show in-game animations (check, capture) - NOT game-ending ones
                            if (g.lastMove && g.lastMove.isCheck) {
                                console.log('👑 Showing check animation');
                                this.showMoveAnimation('check');
                            } else if (g.lastMove && g.lastMove.isCapture) {
                                console.log('⚔️ Showing capture animation');
                                this.showMoveAnimation('capture');
                            }
                            return;
                        }

                        // Check game status for special endings
                        if (currentStatus === 'draw') {
                            console.log('🔁 Showing 3-fold repetition draw animation');
                            this.showMoveAnimation('draw');
                        } else if (currentStatus === 'finished' && currentReason === 'resignation' && currentWinner) {
                            console.log('🏳️ Showing resignation animation for winner:', currentWinner);
                            this.showMoveAnimation('resignation', {winner: currentWinner});
                        } else if (currentStatus === 'perpetual-check') {
                            console.log('♾️ Showing perpetual check animation, winner:', currentWinner);
                            this.showMoveAnimation('perpetual-check', {winner: currentWinner});
                        } else if (currentStatus === 'perpetual-chase') {
                            console.log('♾️ Showing perpetual chase animation, winner:', currentWinner);
                            this.showMoveAnimation('perpetual-chase', {winner: currentWinner});
                        } else if (g.lastMove && g.lastMove.isCheckmate) {
                            console.log('🏆 Showing checkmate animation for winner:', currentWinner);
                            this.showMoveAnimation('checkmate', {winner: currentWinner});
                        } else if (g.lastMove && g.lastMove.isStalemate) {
                            console.log('🤝 Showing stalemate animation');
                            this.showMoveAnimation('stalemate');
                        } else if (g.lastMove && g.lastMove.isCheck) {
                            console.log('👑 Showing check animation');
                            this.showMoveAnimation('check');
                        } else if (g.lastMove && g.lastMove.isCapture) {
                            console.log('⚔️ Showing capture animation');
                            this.showMoveAnimation('capture');
                        }
                    }, 200); // Small delay so the piece updates first
                } else {
                    console.log('⏭️ Skipping animation - stale move from completed game (age: ' + Math.round(moveAge/1000) + 's)');
                }

                // Check for perpetual check warning (progressive: 3, 4, 5, 6 checks)
                if (this.gameState.status === 'playing' && this.gameState.moveHistory) {
                    const checkInfo = this.engine.getConsecutiveCheckCount(this.gameState.moveHistory);
                    if (checkInfo.count >= 3 && checkInfo.count < 7) {
                        this.showPerpetualCheckWarning(checkInfo.count, checkInfo.checker);
                    } else {
                        this.hidePerpetualCheckWarning();
                    }
                } else if (this.gameState.status !== 'playing') {
                    this.hidePerpetualCheckWarning();
                }
            }

            // Check for game-ending statuses that don't involve a move (like resignation)
            // But NEVER announce on a fresh game with no moves (stale data from previous game)
            if (g.status === 'finished' && g.reason === 'resignation' && g.winner && g.history && g.history.length > 0) {
                // Use finishedAt timestamp to track if we've already shown this resignation
                const resignationTimestamp = g.finishedAt || Date.now();

                // On first load, if game is already finished, don't show animation
                // Initialize lastResignationTimestamp to prevent re-showing old animations
                if (this.lastResignationTimestamp === null) {
                    console.log('🔄 First load - game already finished by resignation. Skipping animation.');
                    this.lastResignationTimestamp = resignationTimestamp;
                } else if (resignationTimestamp !== this.lastResignationTimestamp) {
                    console.log('🏳️ Detected NEW resignation - showing animation for winner:', g.winner);
                    console.log('   Resignation timestamp:', resignationTimestamp);
                    console.log('   Last shown resignation:', this.lastResignationTimestamp);

                    this.lastResignationTimestamp = resignationTimestamp;
                    setTimeout(() => {
                        // Safety: only show if game is still finished (not restarted)
                        if (this.gameState?.status === 'playing') {
                            console.log('⏭️ Skipping stale resignation animation - new game already started');
                            return;
                        }
                        this.showMoveAnimation('resignation', {winner: g.winner});
                    }, 200);
                } else {
                    console.log('⏭️ Skipping resignation animation - already shown for this game ending');
                }
            }

            // ========== BACKUP SAVE: If game ended but historySaved is not set, try saving ==========
            // This catches the case where the primary saver (resign/checkmate/timeout) failed or disconnected.
            // ALL clients (players + observers) will attempt this, but the Firestore historySaved flag
            // and the centralized duplicate check prevent double-saves.
            if (g.status && g.status !== 'playing' && g.status !== 'waiting' &&
                g.winner && (g.history || []).length > 0 && !g.historySaved) {
                // Clear any existing backup timer
                clearTimeout(this._backupSaveTimer);
                // Wait 5 seconds to give the primary saver time to finish
                this._backupSaveTimer = setTimeout(async () => {
                    try {
                        // Re-read game document to check if primary saver succeeded
                        const backupGameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                        const backupSnap = await getDoc(backupGameRef);
                        const backupData = backupSnap.exists() ? backupSnap.data() : {};

                        if (!backupData.historySaved && (backupData.history || []).length > 0) {
                            console.log('🔄 BACKUP SAVE: Primary saver did not save within 5s, attempting backup save...');
                            console.log('🔄 Winner:', backupData.winner, 'Reason:', backupData.reason || backupData.status);
                            await this.saveGameToHistory(backupData.winner, backupData.reason || backupData.status);
                        } else if (backupData.historySaved) {
                            console.log('✅ BACKUP SAVE: Not needed - primary saver already completed');
                        }
                    } catch (backupErr) {
                        console.error('❌ BACKUP SAVE failed:', backupErr);
                    }
                }, 5000);
            }
            // If historySaved just became true, cancel any pending backup timer
            if (g.historySaved && this._backupSaveTimer) {
                clearTimeout(this._backupSaveTimer);
                this._backupSaveTimer = null;
            }

            // Render pieces if game is active
            if (g.status === 'playing' && g.board) {
                console.log('♟️ Attempting to render pieces...');

                // Timer display will be started automatically by syncGame

                // Reconstruct 2D array from flattened string
                let board2D;
                if (typeof g.board === 'string') {
                    console.log('📋 Raw board string:', g.board.substring(0, 100) + '...');
                    board2D = g.board.split(';').map(row =>
                        row.split(',').map(cell => cell === '' || cell === 'null' ? null : cell)
                    );
                    console.log('📋 Reconstructed board:', board2D);
                    console.log('📋 Board is array?', Array.isArray(board2D));
                    console.log('📋 Board length:', board2D.length);
                    console.log('📋 First row:', board2D[0]);
                } else {
                    board2D = g.board; // Already an array (backward compatibility)
                    console.log('📋 Board was already an array');
                }

                // Final validation before rendering
                if (!Array.isArray(board2D)) {
                    console.error('❌ CRITICAL: board2D is not an array before render!', typeof board2D, board2D);
                    return;
                }

                this.gameState.board = board2D; // Store reconstructed board

                // Rotate board for black player so they see their pieces at the bottom
                const iAmBlack = this.table?.playerBlack?.uid === this.user.uid;
                const displayBoard = iAmBlack ? this.rotateBoard(board2D) : board2D;

                console.log('🔄 I am black?', iAmBlack, '- Board rotated:', iAmBlack);
                console.log('📋 Original board first row:', board2D[0]);
                console.log('📋 Original board last row:', board2D[9]);
                console.log('📋 Display board first row:', displayBoard[0]);
                console.log('📋 Display board last row:', displayBoard[9]);

                // Transform lastMove coordinates if board is rotated for black player
                let displayLastMove = g.lastMove;
                if (iAmBlack && g.lastMove && g.lastMove.to) {
                    displayLastMove = {
                        ...g.lastMove,
                        to: {
                            x: 8 - g.lastMove.to.x,
                            y: 9 - g.lastMove.to.y
                        }
                    };
                }

                // Transform selectedPiece coordinates if board is rotated for black player
                let displaySelectedPiece = this.selectedPiece;
                if (iAmBlack && this.selectedPiece) {
                    displaySelectedPiece = {
                        x: 8 - this.selectedPiece.x,
                        y: 9 - this.selectedPiece.y
                    };
                }

                this.ui.renderPieces(displayBoard, this.engine.labels, (x, y) => this.handlePieceClick(x, y), this.myPieceStyle, displayLastMove, displaySelectedPiece);
            } else {
                console.log('⏸️ Game not active, clearing board');
                const layer = document.getElementById('pieces-layer');
                if (layer) layer.innerHTML = "";
                const hintsLayer = document.getElementById('hints-layer');
                if (hintsLayer) hintsLayer.innerHTML = "";

                // Stop timer display when game is not active
                this.stopTimerDisplay();

                // Update controls when game ends to hide RESIGN/OFFER DRAW buttons
                this.updateInGameControls();
            }
        });
    }

    /**
     * FIX #1: One Seat Per Person Validation
     */
    /**
     * NEW CLICK-BASED SEAT SYSTEM
     * Players click on player cards instead of buttons
     */
    updateSeatingButtons(iAmSeated, iAmRed, iAmBlack) {
        console.log('🔘 Updating card clickability. iAmSeated:', iAmSeated, 'iAmRed:', iAmRed, 'iAmBlack:', iAmBlack);

        const blackCard = document.getElementById('player-card-black');
        const redCard = document.getElementById('player-card-red');
        const actionMenu = document.getElementById('action-menu');

        if (!blackCard || !redCard || !actionMenu) {
            console.error('❌ Card elements not found!');
            return;
        }

        // Update card clickability
        this.updateCardClickability(blackCard, 'black', iAmSeated, iAmRed, iAmBlack);
        this.updateCardClickability(redCard, 'red', iAmSeated, iAmRed, iAmBlack);

        // Hide action menu by default (will show when card is clicked)
        actionMenu.style.display = 'none';

        console.log('✅ Card clickability updated');
    }

    updateCardClickability(card, side, iAmSeated, iAmRed, iAmBlack) {
        if (!card) return;

        const isOccupied = side === 'red' ? !!this.table.playerRed : !!this.table.playerBlack;
        const isMySlot = side === 'red' ? iAmRed : iAmBlack;
        const iAmOwner = this.table?.tableOwner?.uid === this.user?.uid;

        // Remove all click handlers first
        card.onclick = null;
        card.classList.remove('clickable', 'not-clickable');

        // Determine if this card should be clickable
        let clickable = false;

        if (!iAmSeated && !isOccupied) {
            // Observer clicking empty slot - can sit
            clickable = true;
        } else if (isMySlot) {
            // Seated player clicking their own slot - show actions
            clickable = true;
        } else if (iAmOwner && isOccupied && !isMySlot) {
            // Table owner clicking opponent's slot - can boot
            console.log(`✅ ${side.toUpperCase()} card is clickable for BOOT (owner: ${iAmOwner}, occupied: ${isOccupied}, notMySlot: ${!isMySlot})`);
            clickable = true;
        }

        if (clickable) {
            card.classList.add('clickable');
            card.onclick = () => this.handleSlotClick(side, isMySlot, isOccupied);
        } else {
            card.classList.add('not-clickable');
        }
    }

    handleSlotClick(side, isMySlot, isOccupied) {
        console.log(`🖱️ Clicked ${side} slot - isMySlot: ${isMySlot}, isOccupied: ${isOccupied}`);

        const actions = this.getAvailableActions(side, isMySlot, isOccupied);
        this.showActionMenu(actions);
    }

    getAvailableActions(side, isMySlot, isOccupied) {
        const actions = [];
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const iAmSeated = iAmRed || iAmBlack;
        const iAmOwner = this.table?.tableOwner?.uid === this.user?.uid;
        const bothSeated = this.table?.playerRed && this.table?.playerBlack;
        const battleRequested = this.table?.battleRequest;
        const gameActive = this.gameState?.status === 'playing';

        // Observer clicking empty slot
        if (!iAmSeated && !isOccupied) {
            actions.push({ label: '🪑 SIT HERE', action: () => this.sit(side), color: '#3498db' });
            return actions;
        }

        // Table owner clicking opponent's slot (not during active game)
        console.log('🔍 Boot check:', {
            iAmOwner,
            isMySlot,
            isOccupied,
            gameActive,
            shouldShowBoot: iAmOwner && !isMySlot && isOccupied && !gameActive
        });

        if (iAmOwner && !isMySlot && isOccupied && !gameActive) {
            const opponentName = side === 'red' ? this.table.playerRed?.name : this.table.playerBlack?.name;
            console.log('✅ Showing owner actions for opponent:', opponentName);

            // Swap seats - only when no battle request is pending
            if (!battleRequested) {
                actions.push({
                    label: `🔄 SWAP SEATS`,
                    action: () => this.swapSeats(),
                    color: '#3498db'
                });
            }

            actions.push({
                label: `🥾 BOOT ${opponentName?.toUpperCase()}`,
                action: () => this.bootPlayer(side),
                color: '#cd3333'
            });
            return actions;
        }

        // Seated player clicking their own slot
        if (isMySlot) {
            if (gameActive) {
                // Check for draw offer
                const drawOffer = this.table?.drawOffer;

                if (drawOffer) {
                    if (drawOffer.from === this.user.uid) {
                        // I offered draw - show CANCEL and RESIGN
                        actions.push({ label: '❌ CANCEL DRAW OFFER', action: () => this.cancelDrawOffer(), color: '#cd3333' });
                        actions.push({ label: '🏳️ RESIGN', action: () => this.resign(), color: '#cd3333' });
                    } else {
                        // Opponent offered draw - show ACCEPT, REJECT, RESIGN
                        actions.push({ label: '✅ ACCEPT DRAW', action: () => this.acceptDraw(), color: '#27ae60' });
                        actions.push({ label: '❌ REJECT DRAW', action: () => this.rejectDraw(), color: '#cd3333' });
                        actions.push({ label: '🏳️ RESIGN', action: () => this.resign(), color: '#cd3333' });
                    }
                } else {
                    // During game: RESIGN, OFFER DRAW
                    actions.push({ label: '🏳️ RESIGN', action: () => this.resign(), color: '#cd3333' });
                    actions.push({ label: '🤝 OFFER DRAW', action: () => this.offerDraw(), color: '#3498db' });
                }
            } else if (bothSeated) {
                // Both seated, no battle yet
                if (battleRequested) {
                    if (battleRequested.from === this.user.uid) {
                        // I requested battle
                        actions.push({ label: '❌ CANCEL REQUEST', action: () => this.cancelBattleRequest(), color: '#cd3333' });
                        actions.push({ label: '🚪 UNSEAT', action: () => this.unseat(), color: '#cd3333' });
                    } else {
                        // Opponent requested battle
                        actions.push({ label: '✅ ACCEPT BATTLE', action: () => this.acceptBattle(), color: '#27ae60' });
                        actions.push({ label: '🚪 UNSEAT', action: () => this.unseat(), color: '#cd3333' });
                    }
                } else {
                    // No battle request yet
                    actions.push({ label: '🚪 UNSEAT', action: () => this.unseat(), color: '#cd3333' });
                    actions.push({ label: '⚔️ REQUEST BATTLE', action: () => this.requestBattle(), color: '#27ae60' });
                }
            } else {
                // Seated alone
                actions.push({ label: '🚪 UNSEAT', action: () => this.unseat(), color: '#cd3333' });

                // Show swap if other seat is empty
                const otherSide = iAmRed ? 'black' : 'red';
                const otherOccupied = otherSide === 'red' ? !!this.table.playerRed : !!this.table.playerBlack;
                if (!otherOccupied) {
                    actions.push({ label: `🔄 SWAP TO ${otherSide.toUpperCase()}`, action: () => this.swap(otherSide), color: '#3498db' });
                }
            }
        }

        return actions;
    }

    showActionMenu(actions) {
        const menu = document.getElementById('action-menu');
        const title = document.getElementById('action-menu-title');
        const buttons = document.getElementById('action-menu-buttons');

        if (!menu || !title || !buttons) return;

        if (actions.length === 0) {
            menu.style.display = 'none';
            return;
        }

        title.innerText = 'AVAILABLE ACTIONS';
        buttons.innerHTML = '';

        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'btn-action';
            btn.style.background = action.color;
            btn.style.color = 'white';
            btn.style.padding = '10px';
            btn.style.borderRadius = '8px';
            btn.style.border = 'none';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = '900';
            btn.style.fontSize = '0.85rem';
            btn.innerText = action.label;
            btn.onclick = () => {
                action.action();
                menu.style.display = 'none'; // Hide menu after action
            };
            buttons.appendChild(btn);
        });

        menu.style.display = 'block';
    }

    async unseat() {
        if (!this.user) return;

        console.log('🚪 Unseating...');

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const freshSnap = await getDoc(tRef);
        const t = freshSnap.data();

        const isRed = t?.playerRed?.uid === this.user.uid;
        const isBlack = t?.playerBlack?.uid === this.user.uid;

        if (!isRed && !isBlack) {
            this.showStatus("You're not seated!", "red");
            return;
        }

        try {
            const updates = {};
            if (isRed) {
                updates.playerRed = deleteField();
                updates.playerRedSeatedAt = deleteField();
                updates.playerRedWarned = deleteField();
            }
            if (isBlack) {
                updates.playerBlack = deleteField();
                updates.playerBlackSeatedAt = deleteField();
                updates.playerBlackWarned = deleteField();
            }

            // Check if opponent is still seated
            const opponentStillSeated = isRed ? t?.playerBlack : t?.playerRed;
            const iAmOwner = t?.tableOwner?.uid === this.user.uid;

            if (iAmOwner) {
                if (opponentStillSeated) {
                    // Transfer ownership to opponent
                    updates.tableOwner = {
                        uid: opponentStillSeated.uid,
                        name: opponentStillSeated.name,
                        since: Date.now()
                    };
                    console.log('👑 Transferring table ownership to opponent:', opponentStillSeated.name);
                } else {
                    // No one left, clear ownership
                    updates.tableOwner = deleteField();
                    console.log('👑 Clearing table ownership (no one left)');
                }
            }

            await setDoc(tRef, updates, { merge: true });
            console.log('✅ Unseated successfully');
            this.showStatus("You've left your seat", "gold");
        } catch (error) {
            console.error('❌ Unseat error:', error);
            this.showStatus("Failed to unseat: " + error.message, "red");
        }
    }

    async bootPlayer(side) {
        if (!this.user) return;

        console.log(`🥾 Booting player from ${side} seat...`);

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const freshSnap = await getDoc(tRef);
        const t = freshSnap.data();

        // Verify I'm the table owner
        const iAmOwner = t?.tableOwner?.uid === this.user.uid;
        if (!iAmOwner) {
            this.showStatus("Only the table owner can boot players!", "red");
            return;
        }

        // Verify game is not active
        if (this.gameState?.status === 'playing') {
            this.showStatus("Cannot boot during active game!", "red");
            return;
        }

        try {
            const updates = {};
            const seatKey = side === 'red' ? 'playerRed' : 'playerBlack';
            const playerName = t?.[seatKey]?.name || 'Player';

            updates[seatKey] = deleteField();

            // Clear any pending battle requests
            if (t?.battleRequest) {
                updates.battleRequest = deleteField();
            }

            await setDoc(tRef, updates, { merge: true });
            console.log(`✅ Booted ${playerName} successfully`);
            this.showStatus(`Booted ${playerName} from the table`, "gold");

            // Hide action menu
            const menu = document.getElementById('action-menu');
            if (menu) menu.style.display = 'none';
        } catch (error) {
            console.error('❌ Boot error:', error);
            this.showStatus("Failed to boot player: " + error.message, "red");
        }
    }

    async swapSeats() {
        if (!this.user) return;

        console.log('🔄 Table owner swapping seats with opponent...');

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const freshSnap = await getDoc(tRef);
        const t = freshSnap.data();

        // Verify I'm the table owner
        if (t?.tableOwner?.uid !== this.user.uid) {
            this.showStatus("Only the table owner can swap seats!", "red");
            return;
        }

        // Verify game is not active
        if (this.gameState?.status === 'playing') {
            this.showStatus("Cannot swap during active game!", "red");
            return;
        }

        // Verify no battle request is pending
        if (t?.battleRequest) {
            this.showStatus("Cannot swap while battle request is pending!", "red");
            return;
        }

        // Verify both players are seated
        if (!t?.playerRed || !t?.playerBlack) {
            this.showStatus("Both seats must be occupied to swap!", "red");
            return;
        }

        try {
            const redPlayer = { ...t.playerRed };
            const blackPlayer = { ...t.playerBlack };

            await setDoc(tRef, {
                playerRed: blackPlayer,
                playerBlack: redPlayer
            }, { merge: true });

            console.log(`✅ Swapped seats: ${redPlayer.name} → Black, ${blackPlayer.name} → Red`);
            this.showStatus("Seats swapped!", "gold");
        } catch (error) {
            console.error('❌ Swap seats error:', error);
            this.showStatus("Failed to swap seats: " + error.message, "red");
        }
    }

    handleSwap() {
        console.log('🔵 SWAP button clicked!');
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;

        console.log('  Am I red?', iAmRed);
        console.log('  Am I black?', iAmBlack);

        if (iAmRed) {
            this.swap('black');
        } else if (iAmBlack) {
            this.swap('red');
        } else {
            console.error('❌ Not seated, cannot swap!');
            this.showStatus("You must be seated to swap!", "red");
        }
    }

    async swap(toSide) {
        if (!this.user || !this.profile) return;

        console.log('🔄 Swapping to', toSide);
        
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const freshSnap = await getDoc(tRef);
        const t = freshSnap.data();
        
        const isRed = t?.playerRed?.uid === this.user.uid;
        const isBlack = t?.playerBlack?.uid === this.user.uid;
        
        if (!isRed && !isBlack) {
            this.showStatus("You're not seated!", "red");
            return;
        }
        
        // Check if target seat is empty
        const targetSeatKey = toSide === 'red' ? 'playerRed' : 'playerBlack';
        if (t[targetSeatKey]) {
            this.showStatus("Target seat is taken!", "red");
            return;
        }
        
        try {
            const myName = this.profile.playerName || this.user.email.split('@')[0];
            const myAvatar = this.profile.avatarUrl || '/lobby/1.JPG';
            
            const updates = {};
            
            // Remove from current seat
            if (isRed) updates.playerRed = deleteField();
            if (isBlack) updates.playerBlack = deleteField();
            
            // Add to new seat
            updates[targetSeatKey] = {
                uid: this.user.uid,
                name: myName,
                avatar: myAvatar
            };
            
            await setDoc(tRef, updates, { merge: true });
            console.log('✅ Swapped successfully');
            this.showStatus(`Swapped to ${toSide.toUpperCase()}`, "gold");
        } catch (error) {
            console.error('❌ Swap error:', error);
            this.showStatus("Failed to swap: " + error.message, "red");
        }
    }

    async sit(side) {
        console.log('🪑 sit() called for side:', side);
        
        // LOCK CHECK: Prevent simultaneous sits
        if (this.isSitting) {
            console.log('⏳ Already processing a sit request, please wait...');
            this.showStatus("Please wait...", "red");
            return;
        }
        
        if (!this.user) {
            console.error('❌ No user logged in');
            return;
        }
        
        if (!this.profile) {
            console.error('❌ No profile loaded');
            return;
        }
        
        // SET LOCK
        this.isSitting = true;
        
        console.log('✅ User:', this.user.uid);
        console.log('✅ Profile:', this.profile);
        
        // IMMEDIATE CHECK: Am I already seated?
        const iAmRed = this.table?.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user.uid;
        
        if (iAmRed || iAmBlack) {
            console.log('⚠️ Already seated! (Immediate check)');
            this.showStatus("You're already seated!", "red");
            this.isSitting = false; // RELEASE LOCK
            return;
        }
        
        // DISABLE BUTTONS IMMEDIATELY to prevent double-click
        const seatingArea = document.getElementById('seating-area');
        if (seatingArea) seatingArea.style.pointerEvents = 'none';
        
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        
        try {
            // Get fresh data
            const freshSnap = await getDoc(tRef);
            const currentTable = freshSnap.data() || {};
            
            console.log('📊 Current table state:', currentTable);
            
            // Check if already seated somewhere (DOUBLE CHECK with fresh data)
            const iAmRedFresh = currentTable.playerRed?.uid === this.user.uid;
            const iAmBlackFresh = currentTable.playerBlack?.uid === this.user.uid;
            
            if (iAmRedFresh || iAmBlackFresh) {
                console.log('⚠️ Already seated! (Fresh data check)');
                this.showStatus("You're already seated!", "red");
                if (seatingArea) seatingArea.style.pointerEvents = 'auto';
                this.isSitting = false; // RELEASE LOCK
                return;
            }
            
            // Check if target seat is taken
            const seatKey = side === 'red' ? 'playerRed' : 'playerBlack';
            if (currentTable[seatKey]) {
                console.log('⚠️ Seat is taken:', currentTable[seatKey]);
                this.showStatus("Seat is taken.", "red");
                if (seatingArea) seatingArea.style.pointerEvents = 'auto';
                this.isSitting = false; // RELEASE LOCK
                return;
            }

            // Sit down
            const myName = this.profile.playerName || this.user.email.split('@')[0];
            const myAvatar = this.profile.avatarUrl || '/lobby/1.JPG';

            console.log('💺 Attempting to sit with:', { myName, myAvatar });

            // Check if this is the first person sitting (no one else seated)
            const bothSeatsEmpty = !currentTable.playerRed && !currentTable.playerBlack;
            const updates = {
                [seatKey]: {
                    uid: this.user.uid,
                    name: myName,
                    avatar: myAvatar
                }
            };

            // If first person sitting, set as table owner
            if (bothSeatsEmpty) {
                updates.tableOwner = {
                    uid: this.user.uid,
                    name: myName,
                    since: Date.now()
                };
                console.log('👑 Setting as table owner (first to sit)');
            }

            // Record seat timestamp for idle detection
            const seatedAtKey = side === 'red' ? 'playerRedSeatedAt' : 'playerBlackSeatedAt';
            const warnedKey = side === 'red' ? 'playerRedWarned' : 'playerBlackWarned';
            updates[seatedAtKey] = Date.now();
            updates[warnedKey] = false;
            updates.postGameIdle = false; // Fresh sit = full 3-min timeout

            // Also remove from queue if sitting down while in queue
            const currentQueue = currentTable.queue || [];
            const queueIdx = currentQueue.findIndex(q => q.uid === this.user.uid);
            if (queueIdx >= 0) {
                updates.queue = currentQueue.filter(q => q.uid !== this.user.uid);
                console.log('🎫 Removing myself from queue (now seated)');
            }

            await setDoc(tRef, updates, { merge: true });

            console.log('✅ Successfully saved to Firestore!');
            this.showStatus(`You are now seated as ${side.toUpperCase()}`, "gold");
            this.resetRoomActivity(); // Seat taken resets room inactivity timer

        } catch (error) {
            console.error('❌ Error saving to Firestore:', error);

            // Check if it's a permission error (likely trying to sit in both seats)
            if (error.code === 'permission-denied' || error.message.includes('permissions')) {
                this.showStatus("Cannot sit in both seats!", "red");
            } else {
                this.showStatus("Failed to sit down: " + error.message, "red");
            }

            if (seatingArea) seatingArea.style.pointerEvents = 'auto';
        } finally {
            // ALWAYS RELEASE LOCK
            this.isSitting = false;
        }
    }

    /**
     * FIX #2: Chat System Fixed
     */
    async sendChat() {
        const el = document.getElementById('chat-msg');
        if(!el || !el.value.trim() || !this.user) return;

        const myName = this.profile?.playerName || this.user.email.split('@')[0];
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);

        try {
            await setDoc(gameRef, {
                chat: arrayUnion({
                    user: myName,
                    text: el.value.trim(),
                    ts: Date.now(),
                    voiceType: this.settings.voiceType || 'young-lady'
                })
            }, { merge: true });
            el.value = "";
            this.resetRoomActivity(); // Chat activity resets room inactivity timer
        } catch (e) {
            console.error("Chat Error:", e);
            this.showStatus("Chat Failed", "red");
        }
    }

    /**
     * MOBILE: Send chat from board area input
     */
    async sendBoardChat() {
        const el = document.getElementById('board-chat-msg');
        if(!el || !el.value.trim() || !this.user) return;

        const myName = this.profile?.playerName || this.user.email.split('@')[0];
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);

        try {
            await setDoc(gameRef, {
                chat: arrayUnion({
                    user: myName,
                    text: el.value.trim(),
                    ts: Date.now(),
                    voiceType: this.settings.voiceType || 'young-lady'
                })
            }, { merge: true });
            el.value = "";
            this.resetRoomActivity(); // Chat activity resets room inactivity timer
        } catch (e) {
            console.error("Chat Error:", e);
            this.showStatus("Chat Failed", "red");
        }
    }

    /**
     * MOBILE: Open chat history modal
     */
    openChatHistory() {
        const modal = document.getElementById('chat-history-modal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    /**
     * MOBILE: Close chat history modal
     */
    closeChatHistory(event) {
        // If event is provided and clicked target is not the modal background, ignore
        if (event && event.target.id !== 'chat-history-modal') return;

        const modal = document.getElementById('chat-history-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * MOBILE: Update floating chat bubble with latest message
     */
    updateFloatingChatBubble(messages) {
        if (!messages || messages.length === 0) return;

        const bubble = document.getElementById('floating-chat-bubble');
        if (!bubble) return;

        // Get the latest message
        const latestMsg = messages[messages.length - 1];

        // Update bubble content
        bubble.innerHTML = `
            <div class="chat-bubble-author">${latestMsg.user}</div>
            <div class="chat-bubble-message">${this.renderChatText(latestMsg.text, latestMsg.voiceType)}</div>
        `;

        // Show bubble
        bubble.style.display = 'block';
        bubble.classList.remove('fade-out');

        // Auto-fade after 5 seconds
        clearTimeout(this.chatBubbleTimeout);
        this.chatBubbleTimeout = setTimeout(() => {
            bubble.classList.add('fade-out');
        }, 5000);
    }

    /**
     * FIX #3: Observer Count Management
     */
    async leaveRoom() {
        if (!this.user || !this.hasJoined) return;
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        const gRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);

        const freshSnap = await getDoc(tRef);
        const t = freshSnap.data();
        const isRed = t?.playerRed?.uid === this.user.uid;
        const isBlack = t?.playerBlack?.uid === this.user.uid;

        console.log('🚪 Leaving room. isRed:', isRed, 'isBlack:', isBlack);

        // Build updates object
        const updates = {};

        // Remove from occupants array (filter out my uid)
        const currentOccupants = t?.occupants || [];
        const updatedOccupants = currentOccupants.filter(occ => occ.uid !== this.user.uid);

        if (currentOccupants.length !== updatedOccupants.length) {
            updates.occupants = updatedOccupants;
            console.log('👋 Removing myself from occupants');
            console.log('👥 Before:', currentOccupants.length, 'After:', updatedOccupants.length);
        } else {
            console.log('⚠️ Was not found in occupants list');
        }

        // Only remove the seat I'm actually in
        if (isRed) {
            updates.playerRed = deleteField();
            console.log('🔴 Removing from Red seat');
        }
        if (isBlack) {
            updates.playerBlack = deleteField();
            console.log('⚫ Removing from Black seat');
        }

        // Clear battle request if a player leaves
        if (isRed || isBlack) {
            updates.battleRequest = deleteField();
            console.log('🧹 Clearing battle request');
        }

        // Remove from queue if leaving the room
        const currentQueue = t?.queue || [];
        const updatedQueue = currentQueue.filter(q => q.uid !== this.user.uid);
        if (currentQueue.length !== updatedQueue.length) {
            updates.queue = updatedQueue;
            console.log('🎫 Removing myself from queue');
        }

        // Check if table will be empty after I leave
        const occupantsWillBeEmpty = (t?.occupants || []).length <= 1;

        // Cleanup game if table becomes completely empty
        if (occupantsWillBeEmpty) {
            console.log('🧹 Last person leaving - cleaning up game state');
            await setDoc(gRef, {
                chat: [],
                board: null,
                status: 'waiting',
                history: [],
                moveHistory: [], // Clear move history for repetition detection
                turn: 'red'
            }, { merge: true });
            updates.matchActive = false;
            updates.queue = []; // Clear queue when table is empty
        }
        
        await setDoc(tRef, updates, { merge: true });
        console.log('✅ Left room successfully');
        this.hasJoined = false;

        // Stop music when I leave (will be stopped by occupants change too, but this is immediate)
        this.stopAmbientMusic();

        // Remove from Realtime Database presence
        if (this.presenceRef) {
            await remove(this.presenceRef);
            console.log('🔌 Removed from Realtime Database presence');
        }
    }

    async setupPresenceTracking() {
        console.log('🔌 Setting up presence tracking in Realtime Database');

        // Create a reference in Realtime Database for this user in this table
        this.presenceRef = ref(this.rtdb, `presence/${this.rid}/${this.tid}/${this.user.uid}`);

        const presenceData = {
            uid: this.user.uid,
            name: this.profile?.playerName || this.user.email.split('@')[0],
            avatar: this.profile?.avatarUrl || '/lobby/1.JPG',
            elo: this.profile?.elo || 1200,
            coins: this.profile?.coins || 0,
            connectedAt: Date.now()
        };

        // Set presence data
        await set(this.presenceRef, presenceData);

        // Set up automatic removal on disconnect
        onDisconnect(this.presenceRef).remove();

        console.log('✅ Presence tracking set up with auto-disconnect removal');

        // Listen to ALL presence changes for this table and sync to Firestore
        this.listenToPresenceChanges();
    }

    listenToPresenceChanges() {
        const tablePresenceRef = ref(this.rtdb, `presence/${this.rid}/${this.tid}`);

        onValue(tablePresenceRef, async (snapshot) => {
            console.log('👂 Presence change detected in Realtime Database');

            const presenceData = snapshot.val();
            const onlineUsers = presenceData ? Object.values(presenceData) : [];

            console.log('🔌 Online users from RTDB:', onlineUsers.length, onlineUsers.map(u => u.name));

            // Sync to Firestore occupants array
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

            try {
                await runTransaction(this.db, async (transaction) => {
                    const tableDoc = await transaction.get(tRef);
                    if (!tableDoc.exists()) {
                        console.log('❌ Table no longer exists');
                        return;
                    }

                    const tableData = tableDoc.data();
                    const currentOccupants = tableData.occupants || [];

                    // Build new occupants list from RTDB presence (source of truth)
                    const newOccupants = onlineUsers.map(u => ({
                        uid: u.uid,
                        name: u.name,
                        elo: u.elo,
                        coins: u.coins,
                        avatar: u.avatar
                    }));

                    // Only update if changed
                    const currentUIDs = currentOccupants.map(o => o.uid).sort().join(',');
                    const newUIDs = newOccupants.map(o => o.uid).sort().join(',');

                    if (currentUIDs !== newUIDs) {
                        console.log('🔄 Syncing Firestore occupants with RTDB presence');
                        console.log('  Before:', currentOccupants.length, 'occupants');
                        console.log('  After:', newOccupants.length, 'occupants');

                        transaction.update(tRef, { occupants: newOccupants });

                        // If room is now completely empty, clean up chat
                        if (newOccupants.length === 0) {
                            console.log('🧹 Room is now empty - cleaning up chat');
                            const gRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                            transaction.update(gRef, {
                                chat: [],
                                board: null,
                                status: 'waiting',
                                history: [],
                                moveHistory: [],
                                turn: 'red'
                            });
                            transaction.update(tRef, { matchActive: false });
                        }
                    } else {
                        console.log('✅ Occupants already in sync');
                    }
                });
            } catch (err) {
                console.error('❌ Error syncing presence to Firestore:', err);
            }
        });
    }

    async handleExit() {
        // Check if user is a player in an active game
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const isPlaying = this.gameState?.status === 'playing';

        if ((iAmRed || iAmBlack) && isPlaying) {
            // User is a player in an active game - automatically resign
            console.log('🚪 Player leaving during active game - auto-resigning');
            await this.resign();
        }

        await this.leaveRoom();
        window.location.href = '../lobby/lobby.html';
    }

    async requestBattle() {
        console.log('⚔️ Requesting battle...');
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

        const battleRequestData = {
            from: this.user.uid,
            ts: Date.now()
        };

        console.log('💾 Saving battleRequest to Firestore:', battleRequestData);
        await setDoc(tRef, {
            battleRequest: battleRequestData,
            // Reset idle timers - both players are active
            playerRedSeatedAt: Date.now(),
            playerBlackSeatedAt: Date.now(),
            playerRedWarned: false,
            playerBlackWarned: false,
            postGameIdle: false
        }, { merge: true });
        console.log('✅ battleRequest saved successfully');

        // Verify it was saved by reading it back
        const verifySnap = await getDoc(tRef);
        const verifyData = verifySnap.data();
        console.log('🔍 Verification - battleRequest in Firestore:', verifyData.battleRequest);

        const myName = this.profile?.playerName || this.user.email.split('@')[0];
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        await setDoc(gameRef, {
            chat: arrayUnion({
                user: 'SYSTEM',
                text: `⚔️ ${myName} has requested battle!`,
                ts: Date.now()
            })
        }, { merge: true });

        this.showStatus("Battle requested! Waiting for opponent...", "gold");

        // Start requester-side countdown to boot opponent if no response
        this.startRequesterCountdown();
    }

    startRequesterCountdown() {
        // Clear any existing countdown
        if (this.requesterCountdownTimer) {
            clearInterval(this.requesterCountdownTimer);
            this.requesterCountdownTimer = null;
        }

        let timeLeft = 10;
        console.log('⏱️ Requester countdown started: 10 seconds to respond');

        this.requesterCountdownTimer = setInterval(async () => {
            timeLeft--;
            console.log(`⏱️ Requester countdown: ${timeLeft}s remaining`);

            if (timeLeft <= 0) {
                clearInterval(this.requesterCountdownTimer);
                this.requesterCountdownTimer = null;
                console.log('⏰ Opponent did not respond - booting from seat');
                await this.requesterTimeoutBoot();
            }
        }, 1000);
    }

    async requesterTimeoutBoot() {
        console.log('🥾 Requester booting non-responding opponent...');

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

        try {
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();

            // Check if battle request still exists (opponent hasn't responded)
            if (!t?.battleRequest || t.battleRequest.from !== this.user.uid) {
                console.log('ℹ️ Battle request already resolved, skip boot');
                return;
            }

            // Find the opponent's seat (the one who is NOT me)
            const iAmRed = t?.playerRed?.uid === this.user.uid;
            const iAmBlack = t?.playerBlack?.uid === this.user.uid;
            const opponentSeatKey = iAmRed ? 'playerBlack' : (iAmBlack ? 'playerRed' : null);
            const opponentData = iAmRed ? t?.playerBlack : t?.playerRed;

            if (!opponentSeatKey || !opponentData) {
                console.warn('⚠️ Cannot boot - opponent not found');
                return;
            }

            const opponentName = opponentData.name || 'Opponent';

            const updates = {
                battleRequest: deleteField(),
                [opponentSeatKey]: deleteField(),
                battleTimeout: {
                    bootedUid: opponentData.uid,
                    bootedName: opponentName,
                    requestedBy: this.user.uid,
                    timestamp: Date.now()
                }
            };

            // Transfer table ownership if opponent was the owner
            const opponentIsOwner = t?.tableOwner?.uid === opponentData.uid;
            if (opponentIsOwner) {
                updates.tableOwner = {
                    uid: this.user.uid,
                    name: this.profile?.playerName || this.user.email?.split('@')[0],
                    since: Date.now()
                };
                console.log('👑 Transferring table ownership to requester (me)');
            }

            await setDoc(tRef, updates, { merge: true });
            console.log(`✅ Booted ${opponentName} for not responding`);
            this.showStatus(`${opponentName} did not respond — removed from seat`, "gold");

            // Auto-clear timeout notification after 6 seconds
            setTimeout(async () => {
                await setDoc(tRef, {
                    battleTimeout: deleteField()
                }, { merge: true });
            }, 6000);
        } catch (error) {
            console.error('❌ Requester timeout boot error:', error);
        }
    }

    async acceptBattle() {
        console.log('✅ Accepting battle...');
        // Clear the battle request first
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            battleRequest: deleteField()
        }, { merge: true });

        // Now start the battle
        await this.engageBattle();
    }


    async engageBattle() {
        console.log('⚔️ Engaging battle...');

        // Reset local state tracking to prevent old game announcements from replaying
        this.lastMoveTimestamp = null;
        this.hasCompletedFirstSync = false;
        this.lastResignationTimestamp = null;

        // Note: Battle splash will be shown automatically by syncGame() listener for ALL players

        // First, check if game is already starting/started
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        const gameSnap = await getDoc(gameRef);
        const existingGame = gameSnap.data() || {};

        if (existingGame.status === 'playing') {
            console.log('⚠️ Battle already started!');
            this.showStatus("Battle already started!", "gold");
            return;
        }

        const board = this.engine.init();
        console.log('📋 Board initialized:', board);

        // Flatten 2D array to string for Firebase (Firebase doesn't support nested arrays)
        // Convert null to empty string for proper reconstruction
        const flatBoard = board.map(row =>
            row.map(cell => cell === null ? '' : cell).join(',')
        ).join(';');
        console.log('📋 Flattened board:', flatBoard);

        try {
            // CRITICAL FIX: Split into two operations to ensure history is properly cleared
            // First, clear the history arrays completely (cannot reliably clear arrays with merge:true + arrayUnion)
            await setDoc(gameRef, {
                board: flatBoard,
                status: 'playing',
                turn: 'red',
                history: [],
                moveHistory: [],
                lastMove: deleteField(), // Clear previous game's last move (prevents stale announcements)
                startedAt: Date.now(), // Track when game started
                finishedAt: deleteField(), // Clear previous game's finish time
                winner: deleteField(), // Clear previous winner
                reason: deleteField(), // Clear previous finish reason
                // Store player data in game doc so saveGameToHistory can always find it
                playerRed: this.table?.playerRed ? { ...this.table.playerRed } : null,
                playerBlack: this.table?.playerBlack ? { ...this.table.playerBlack } : null,
                // Clear stale timer data from previous game to prevent instant timeout
                redTimeLeft: deleteField(),
                blackTimeLeft: deleteField(),
                turnStartTime: deleteField(),
                timerStarted: deleteField(),
                // Clear historySaved flag so the new game can be recorded
                historySaved: deleteField(),
                historySavedAt: deleteField()
            }, { merge: true });

            // Then add the chat message separately
            await setDoc(gameRef, {
                chat: arrayUnion({
                    user: 'SYSTEM',
                    text: '⚔️ Battle has begun! Red moves first.',
                    ts: Date.now()
                })
            }, { merge: true });

            console.log('✅ Game state saved to Firestore (history cleared for new game)');

            await setDoc(doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid), {
                matchActive: true,
                // Clear idle tracking during active game
                playerRedSeatedAt: deleteField(),
                playerBlackSeatedAt: deleteField(),
                playerRedWarned: false,
                playerBlackWarned: false,
                postGameIdle: false
            }, { merge: true });

            console.log('✅ Match marked as active');
            this.resetRoomActivity(); // Game started resets room inactivity timer
        } catch (error) {
            console.error('❌ Error starting battle:', error);
            this.showStatus("Failed to start battle: " + error.message, "red");
        }
    }

    /**
     * FIX #4: Complete Piece Movement System
     */
    handlePieceClick(x, y) {
        if (!this.gameState || this.gameState.status !== 'playing') return;

        // Determine my color first
        const iAmRed = this.table.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table.playerBlack?.uid === this.user.uid;
        const myColor = iAmRed ? 'red' : (iAmBlack ? 'black' : null);

        // If black player, convert display coordinates back to actual board coordinates
        let actualX = x;
        let actualY = y;
        if (iAmBlack) {
            actualX = 8 - x;
            actualY = 9 - y;
            console.log(`🔄 Black player clicked (${x}, ${y}) → actual (${actualX}, ${actualY})`);
        }

        const board = this.gameState.board;
        const piece = board[actualY][actualX];
        
        if (!myColor) {
            this.showStatus("Observers cannot move pieces", "red");
            return;
        }
        
        // Check if it's my turn
        if (this.gameState.turn !== myColor) {
            this.showStatus(`Wait for ${this.gameState.turn.toUpperCase()}'s turn`, "red");
            return;
        }

        // If clicking own piece - select it or deselect if clicking the same piece
        if (piece) {
            const isRed = piece === piece.toUpperCase();
            const pieceColor = isRed ? 'red' : 'black';

            if (pieceColor === myColor) {
                // Check if clicking the same piece (deselect)
                if (this.selectedPiece && this.selectedPiece.x === actualX && this.selectedPiece.y === actualY) {
                    this.deselectPiece();
                } else {
                    // Selecting a different piece of the same color
                    this.selectPiece(actualX, actualY);
                }
            } else {
                this.showStatus("That's not your piece!", "red");
            }
        }
    }

    selectPiece(x, y) {
        this.selectedPiece = {x, y};

        // Play pickup sound
        this.playSound('pickup');

        // Get valid moves based on actual board coordinates
        this.validMoves = this.engine.getValidMoves(this.gameState.board, x, y);

        // If black player, transform the valid move coordinates for display
        const iAmBlack = this.table?.playerBlack?.uid === this.user.uid;
        const displayMoves = iAmBlack
            ? this.validMoves.map(m => ({ x: 8 - m.x, y: 9 - m.y }))
            : this.validMoves;

        // Render hints using display coordinates
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) {
            hintsLayer.innerHTML = displayMoves.map((m, idx) => {
                const hintX = 10 + m.x * 10;
                const hintY = ((10 + m.y * 10) / 110) * 100;
                // Store original move coordinates in the onclick, not display coordinates
                const originalMove = this.validMoves[idx];
                return `<div class="move-hint" style="left:${hintX}%; top:${hintY}%;" onclick="app.executeMove(${originalMove.x}, ${originalMove.y})"></div>`;
            }).join('');
        }

        // Re-render pieces to show the selected piece highlight
        this.renderBoard();
    }

    deselectPiece() {
        console.log('🔓 Deselecting piece');
        this.selectedPiece = null;
        this.validMoves = [];

        // Clear hints
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) hintsLayer.innerHTML = "";

        // Re-render to remove highlight
        this.renderBoard();
    }

    async executeMove(toX, toY) {
        if (!this.selectedPiece) return;

        // Prevent double-click: if a move is already in progress, ignore
        if (this.isMoving) return;
        this.isMoving = true;

        try {

        // Clear hints immediately to prevent second click on same hint
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) hintsLayer.innerHTML = "";

        // These are already actual board coordinates
        const fromX = this.selectedPiece.x;
        const fromY = this.selectedPiece.y;

        // CRITICAL FIX: Prevent moving piece to same square (would delete the piece!)
        if (fromX === toX && fromY === toY) {
            console.warn('⚠️ Attempted to move piece to same square - ignoring');
            this.isMoving = false;
            this.deselectPiece();
            return;
        }

        // Check if this is a capture move
        const capturedPiece = this.gameState.board[toY][toX];
        const isCapture = capturedPiece !== null && capturedPiece !== '';

        // Update board
        const newBoard = this.gameState.board.map(row => [...row]);
        newBoard[toY][toX] = newBoard[fromY][fromX];
        newBoard[fromY][fromX] = null;

        // Play placement sound (local only, immediate feedback)
        this.playSound('place');

        // NOTE: Don't show animations here - let Firebase sync trigger them for ALL clients
        // This ensures everyone sees the same animation at the same time

        // Switch turn
        const nextTurn = this.gameState.turn === 'red' ? 'black' : 'red';

        // Check for check, checkmate, or stalemate on the OPPONENT (who is now on turn)
        const opponentIsRed = nextTurn === 'red';
        const isCheck = this.engine.isInCheck(newBoard, opponentIsRed);
        const isCheckmate = isCheck && this.engine.isCheckmate(newBoard, opponentIsRed);
        const isStalemate = !isCheck && this.engine.isStalemate(newBoard, opponentIsRed);

        // Generate board hash for repetition detection
        const boardHash = this.engine.getBoardHash(newBoard);

        // Get move history from game state
        const currentHistory = this.gameState.moveHistory || [];

        // Create move record for history tracking
        const moveRecord = {
            boardHash: boardHash,
            movedBy: this.gameState.turn, // Who made this move
            isCheck: isCheck,
            isCapture: isCapture, // Capture resets perpetual check count (standard Xiangqi rule)
            ts: Date.now()
        };

        // Check for 3-fold repetition
        const isRepetition = this.engine.isThreefoldRepetition(
            currentHistory.map(m => m.boardHash),
            boardHash
        );

        // Check for perpetual check
        const perpetualCheck = this.engine.isPerpetualCheck([...currentHistory, moveRecord]);

        // Check for perpetual chase
        const perpetualChase = this.engine.isPerpetualChase([...currentHistory, moveRecord]);

        // Flatten board for Firebase (convert null to empty string)
        const flatBoard = newBoard.map(row =>
            row.map(cell => cell === null ? '' : cell).join(',')
        ).join(';');

        // Check if I have an active draw offer - if so, cancel it when making a move
        const drawOffer = this.table?.drawOffer;
        const iOfferedDraw = drawOffer && drawOffer.from === this.user.uid;

        if (iOfferedDraw) {
            // Cancel my draw offer since I'm making a move instead
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            await setDoc(tRef, {
                drawOffer: deleteField()
            }, { merge: true });
        }

        // Save to Firebase with move metadata for animations
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        const movedPiece = this.gameState.board[fromY][fromX];
        const moveData = {
            from: {x: fromX, y: fromY},
            to: {x: toX, y: toY},
            piece: movedPiece, // Add piece type for notation
            isCapture: isCapture,
            capturedPiece: capturedPiece,
            isCheck: isCheck,
            isCheckmate: isCheckmate,
            isStalemate: isStalemate,
            ts: Date.now()
        };

        // Determine new game status
        let newStatus = 'playing';
        let winner = null;

        if (isCheckmate) {
            newStatus = 'checkmate';
            winner = this.gameState.turn; // Current player (who just moved) wins
            // NOTE: Don't show animation here - Firebase sync will trigger it for ALL clients
        } else if (isStalemate) {
            newStatus = 'stalemate';
            winner = 'draw';  // ✅ Fixed: Stalemate is a draw, set winner explicitly
            // NOTE: Don't show animation here - Firebase sync will trigger it for ALL clients
        } else if (isRepetition) {
            newStatus = 'draw';
            winner = 'draw';  // ✅ Fixed: Use 'draw' instead of null for consistency
            console.log('🔁 3-fold repetition detected! Game is a draw.');
        } else if (perpetualCheck) {
            newStatus = 'perpetual-check';
            winner = perpetualCheck.loser === 'red' ? 'black' : 'red'; // Opponent wins
            console.log('♾️ Perpetual check detected! Player', perpetualCheck.loser, 'loses.');
        } else if (perpetualChase) {
            newStatus = 'perpetual-chase';
            winner = perpetualChase.loser === 'red' ? 'black' : 'red'; // Opponent wins
            console.log('♾️ Perpetual chase detected! Player', perpetualChase.loser, 'loses.');
        }
        // NOTE: Check animation will also be triggered by Firebase sync

        // NEW TIMESTAMP-BASED TIMER: Calculate time used and update Firebase
        const now = Date.now();
        const gameSnap = await getDoc(gameRef);
        const currentGameData = gameSnap.data();

        // Get increment from region
        const regionRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid);
        const regionSnap = await getDoc(regionRef);
        const increment = regionSnap.data()?.increment || 0;

        // Calculate elapsed time since turn started
        const turnStartTime = currentGameData?.turnStartTime || now;
        const elapsedSeconds = Math.floor((now - turnStartTime) / 1000);

        // Get current timer values
        let newRedTime = currentGameData?.redTimeLeft || 900;
        let newBlackTime = currentGameData?.blackTimeLeft || 900;

        // Deduct time from player who just moved, add increment
        if (this.gameState.turn === 'red') {
            newRedTime = Math.max(0, newRedTime - elapsedSeconds + increment);
        } else {
            newBlackTime = Math.max(0, newBlackTime - elapsedSeconds + increment);
        }

        console.log(`⏱️ TIMESTAMP UPDATE: Red=${newRedTime}s, Black=${newBlackTime}s, Elapsed=${elapsedSeconds}s, Increment=${increment}s`);

        const updateData = {
            board: flatBoard,
            turn: nextTurn,
            lastMove: moveData,
            history: arrayUnion(moveData),
            moveHistory: arrayUnion(moveRecord),
            redTimeLeft: newRedTime,
            blackTimeLeft: newBlackTime,
            turnStartTime: now // NEW turn starts now
        };

        if (newStatus !== 'playing') {
            updateData.status = newStatus;
            if (winner) updateData.winner = winner;
        }

        await setDoc(gameRef, updateData, { merge: true });

        // Save game to history and clear matchActive if game ended
        if (newStatus !== 'playing') {
            const gameWinner = winner || 'draw';
            await this.saveGameToHistory(gameWinner, newStatus);

            // Clear matchActive from table and start post-game idle timer
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            await setDoc(tRef, {
                matchActive: deleteField(),
                postGameIdle: true,
                playerRedSeatedAt: Date.now(),
                playerBlackSeatedAt: Date.now(),
                playerRedWarned: false,
                playerBlackWarned: false
            }, { merge: true });
        }

        // Clear selection and release move lock
        this.selectedPiece = null;
        this.validMoves = [];
        this.isMoving = false;

        } catch (error) {
            console.error('❌ executeMove error:', error);
            this.showStatus("⚠️ Move error: " + error.message, "red");
            this.selectedPiece = null;
            this.validMoves = [];
            this.isMoving = false;
        }
    }

    async resign() {
        if (!this.gameState || this.gameState.status !== 'playing') return;

        const iAmRed = this.table.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table.playerBlack?.uid === this.user.uid;
        const myColor = iAmRed ? 'red' : (iAmBlack ? 'black' : null);

        if (!myColor) {
            this.showStatus("You are not a player!", "red");
            return;
        }

        if (!confirm(`Are you sure you want to resign? ${myColor === 'red' ? 'BLACK' : 'RED'} will win!`)) {
            return;
        }

        const winner = myColor === 'red' ? 'black' : 'red';
        const myName = this.profile?.playerName || this.user.email.split('@')[0];

        // Clear matchActive flag in table and start post-game idle timer
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            matchActive: deleteField(),
            postGameIdle: true,
            playerRedSeatedAt: Date.now(),
            playerBlackSeatedAt: Date.now(),
            playerRedWarned: false,
            playerBlackWarned: false
        }, { merge: true });

        // Update game status
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        const resignationTime = Date.now();

        console.log('🏳️ RESIGNATION: Saving to Firebase:', {
            winner: winner,
            reason: 'resignation',
            myColor: myColor,
            tableId: this.tid
        });

        await setDoc(gameRef, {
            status: 'finished',
            winner: winner,
            reason: 'resignation',
            finishedAt: resignationTime, // Add timestamp to prevent duplicate animations
            chat: arrayUnion({
                user: 'SYSTEM',
                text: `🏳️ ${myName} (${myColor.toUpperCase()}) has resigned. ${winner.toUpperCase()} wins!`,
                ts: resignationTime
            })
        }, { merge: true });

        console.log('✅ RESIGNATION: Firebase updated, now saving to history...');

        // Save game to history
        await this.saveGameToHistory(winner, 'resignation');

        console.log('✅ RESIGNATION: History saved successfully');

        this.showStatus("You have resigned", "red");
    }

    async offerDraw() {
        if (!this.gameState || this.gameState.status !== 'playing') return;

        const iAmRed = this.table.playerRed?.uid === this.user.uid;
        const iAmBlack = this.table.playerBlack?.uid === this.user.uid;
        const myColor = iAmRed ? 'red' : (iAmBlack ? 'black' : null);

        if (!myColor) {
            this.showStatus("You are not a player!", "red");
            return;
        }

        // Only allow offering draw during your turn
        if (this.gameState.turn !== myColor) {
            this.showStatus("You can only offer a draw during your turn!", "red");
            return;
        }

        const myName = this.profile?.playerName || this.user.email.split('@')[0];

        // Store draw offer in table
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            drawOffer: {
                from: this.user.uid,
                fromName: myName,
                timestamp: Date.now()
            }
        }, { merge: true });

        this.showStatus("Draw offer sent!", "gold");
    }

    async acceptDraw() {
        if (!this.gameState || this.gameState.status !== 'playing') return;

        // End game as draw
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        await setDoc(gameRef, {
            status: 'draw',
            chat: arrayUnion({
                user: 'SYSTEM',
                text: '🤝 Draw accepted! Game ended as a draw.',
                ts: Date.now()
            })
        }, { merge: true });

        // Save game to history
        await this.saveGameToHistory('draw', 'draw');

        // Clear draw offer
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            drawOffer: deleteField()
        }, { merge: true });

        this.showStatus("Draw accepted!", "gold");
    }

    async rejectDraw() {
        // Clear draw offer
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            drawOffer: deleteField()
        }, { merge: true });

        this.showStatus("Draw offer rejected", "gold");
    }

    async cancelDrawOffer() {
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

        await setDoc(tRef, {
            drawOffer: deleteField()
        }, { merge: true });

        this.showStatus("Draw offer cancelled", "gold");
    }

    checkDrawOfferModal() {
        const drawOffer = this.table?.drawOffer;
        const modal = document.getElementById('draw-offer-modal');

        if (!modal) return;

        // FIX: Only show if I'm the seated opponent receiving the offer
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const iAmSeated = iAmRed || iAmBlack;
        const iAmReceiver = drawOffer && drawOffer.from !== this.user?.uid && iAmSeated;

        if (iAmReceiver) {
            // Show modal
            modal.style.display = 'block';

            // Update message
            const message = document.getElementById('draw-offer-message');
            if (message) {
                message.innerText = `${drawOffer.fromName} offers a draw`;
            }

            // Start countdown if not already running
            if (!this.drawOfferCountdownTimer) {
                this.startDrawOfferCountdown();
            }
        } else {
            // Hide modal
            modal.style.display = 'none';

            // Clear countdown timer
            if (this.drawOfferCountdownTimer) {
                clearInterval(this.drawOfferCountdownTimer);
                this.drawOfferCountdownTimer = null;
            }
        }
    }

    startDrawOfferCountdown() {
        let timeLeft = 10;
        const countdownEl = document.getElementById('draw-offer-countdown');

        if (countdownEl) {
            countdownEl.innerText = timeLeft;
        }

        this.drawOfferCountdownTimer = setInterval(() => {
            timeLeft--;
            if (countdownEl) {
                countdownEl.innerText = timeLeft;
            }

            if (timeLeft <= 0) {
                // Auto-reject
                this.rejectDraw();
                clearInterval(this.drawOfferCountdownTimer);
                this.drawOfferCountdownTimer = null;
            }
        }, 1000);
    }

    checkBattleRequestModal() {
        const battleRequest = this.table?.battleRequest;
        const modal = document.getElementById('battle-request-modal');

        if (!modal) return;

        // Only show if I'm the seated opponent receiving the request (not the requester and not an observer)
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const iAmSeated = iAmRed || iAmBlack;
        const iAmReceiver = battleRequest && battleRequest.from !== this.user?.uid && iAmSeated;

        if (iAmReceiver) {
            // Show modal
            modal.style.display = 'block';

            // Update message with requester's name
            const message = document.getElementById('battle-request-message');
            if (message) {
                // Get requester's name from table
                const isRedRequester = this.table.playerRed?.uid === battleRequest.from;
                const requesterName = isRedRequester
                    ? (this.table.playerRed?.name || 'Opponent')
                    : (this.table.playerBlack?.name || 'Opponent');
                message.innerText = `${requesterName} requests a battle`;
            }

            // Start countdown if not already running
            if (!this.battleRequestCountdownTimer) {
                this.startBattleRequestCountdown();
            }
        } else {
            // Hide modal
            modal.style.display = 'none';

            // Clear countdown timer
            if (this.battleRequestCountdownTimer) {
                clearInterval(this.battleRequestCountdownTimer);
                this.battleRequestCountdownTimer = null;
            }
        }
    }

    startBattleRequestCountdown() {
        let timeLeft = 10;
        const countdownEl = document.getElementById('battle-request-countdown');

        if (countdownEl) {
            countdownEl.innerText = timeLeft;
        }

        this.battleRequestCountdownTimer = setInterval(() => {
            timeLeft--;
            if (countdownEl) {
                countdownEl.innerText = timeLeft;
            }

            if (timeLeft <= 0) {
                // Auto-dismiss modal - requester handles the boot
                clearInterval(this.battleRequestCountdownTimer);
                this.battleRequestCountdownTimer = null;
                const modal = document.getElementById('battle-request-modal');
                if (modal) modal.style.display = 'none';
            }
        }, 1000);
    }

    async acceptBattleRequest() {
        console.log('✅ Accepting battle request...');

        // Clear battle request countdown
        if (this.battleRequestCountdownTimer) {
            clearInterval(this.battleRequestCountdownTimer);
            this.battleRequestCountdownTimer = null;
        }

        // Hide modal
        const modal = document.getElementById('battle-request-modal');
        if (modal) modal.style.display = 'none';

        // Clear the battle request from Firestore
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            battleRequest: deleteField()
        }, { merge: true });

        // Start the battle
        await this.engageBattle();
    }

    async rejectBattleRequest() {
        console.log('❌ Rejecting battle request...');

        // Clear battle request countdown
        if (this.battleRequestCountdownTimer) {
            clearInterval(this.battleRequestCountdownTimer);
            this.battleRequestCountdownTimer = null;
        }

        // Hide modal
        const modal = document.getElementById('battle-request-modal');
        if (modal) modal.style.display = 'none';

        // Get the current battle request to know who requested it
        const currentRequest = this.table?.battleRequest;

        // Set a rejection notification for the requester
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            battleRequest: deleteField(),
            battleRejection: {
                requestedBy: currentRequest?.from,
                rejectedBy: this.user.uid,
                rejectedByName: this.profile?.playerName || this.user.email.split('@')[0],
                timestamp: Date.now()
            }
        }, { merge: true });

        this.showStatus("Battle request rejected", "gold");

        // Clear the rejection notification after 6 seconds (so requester has time to see it)
        setTimeout(async () => {
            await setDoc(tRef, {
                battleRejection: deleteField()
            }, { merge: true });
        }, 6000);
    }

    async timeoutBattleRequest() {
        console.log('⏰ Battle request timed out - booting non-responding player...');

        // Hide modal
        const modal = document.getElementById('battle-request-modal');
        if (modal) modal.style.display = 'none';

        // Get the current battle request to know who requested it
        const currentRequest = this.table?.battleRequest;

        // Determine which seat I (the non-responder) am sitting in
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const mySeatKey = iAmRed ? 'playerRed' : (iAmBlack ? 'playerBlack' : null);

        if (!mySeatKey) {
            console.warn('⚠️ Cannot boot - not seated');
            return;
        }

        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);

        try {
            // Fetch fresh table data for ownership transfer
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();

            const updates = {
                battleRequest: deleteField(),
                [mySeatKey]: deleteField(),
                battleTimeout: {
                    bootedUid: this.user.uid,
                    bootedName: this.profile?.playerName || this.user.email?.split('@')[0] || 'Player',
                    requestedBy: currentRequest?.from,
                    timestamp: Date.now()
                }
            };

            // Handle table ownership transfer if I was the owner
            const iAmOwner = t?.tableOwner?.uid === this.user.uid;
            if (iAmOwner) {
                const opponent = iAmRed ? t?.playerBlack : t?.playerRed;
                if (opponent) {
                    updates.tableOwner = {
                        uid: opponent.uid,
                        name: opponent.name,
                        since: Date.now()
                    };
                    console.log('👑 Transferring table ownership to:', opponent.name);
                } else {
                    updates.tableOwner = deleteField();
                }
            }

            await setDoc(tRef, updates, { merge: true });
            console.log('✅ Non-responding player booted from seat');
            this.showStatus("You did not respond - removed from seat", "red");

            // Auto-clear timeout notification after 6 seconds
            setTimeout(async () => {
                await setDoc(tRef, {
                    battleTimeout: deleteField()
                }, { merge: true });
            }, 6000);
        } catch (error) {
            console.error('❌ Timeout boot error:', error);
        }
    }

    checkBattleRejectionNotification() {
        const battleRejection = this.table?.battleRejection;
        const notification = document.getElementById('battle-rejected-notification');

        if (!notification) return;

        // Only show if I'm the one who requested the battle
        const iAmRequester = battleRejection && battleRejection.requestedBy === this.user?.uid;

        if (iAmRequester) {
            // Show notification
            notification.style.display = 'block';

            // Update message with rejecter's name
            const message = document.getElementById('battle-rejected-message');
            if (message) {
                message.innerText = `${battleRejection.rejectedByName} declined your battle request`;
            }

            // Start countdown if not already running
            if (!this.battleRejectionCountdownTimer) {
                this.startBattleRejectionCountdown();
            }
        } else {
            // Hide notification
            notification.style.display = 'none';

            // Clear countdown timer
            if (this.battleRejectionCountdownTimer) {
                clearInterval(this.battleRejectionCountdownTimer);
                this.battleRejectionCountdownTimer = null;
            }
        }
    }

    startBattleRejectionCountdown() {
        let timeLeft = 5;
        const countdownEl = document.getElementById('battle-rejected-countdown');

        if (countdownEl) {
            countdownEl.innerText = timeLeft;
        }

        this.battleRejectionCountdownTimer = setInterval(() => {
            timeLeft--;
            if (countdownEl) {
                countdownEl.innerText = timeLeft;
            }

            if (timeLeft <= 0) {
                // Auto-close
                const notification = document.getElementById('battle-rejected-notification');
                if (notification) notification.style.display = 'none';
                clearInterval(this.battleRejectionCountdownTimer);
                this.battleRejectionCountdownTimer = null;
            }
        }, 1000);
    }

    checkBattleTimeoutNotification() {
        const battleTimeout = this.table?.battleTimeout;
        const notification = document.getElementById('battle-rejected-notification');

        if (!notification) return;

        // Only show if I'm the one who requested the battle (the requester sees opponent got booted)
        const iAmRequester = battleTimeout && battleTimeout.requestedBy === this.user?.uid;

        if (iAmRequester) {
            // Reuse the rejection notification UI to show timeout message
            notification.style.display = 'block';

            const message = document.getElementById('battle-rejected-message');
            if (message) {
                message.innerText = `${battleTimeout.bootedName} did not respond — removed from seat`;
            }

            // Update the title to show TIMED OUT instead of DECLINED
            const titleEl = notification.querySelector('h2');
            if (titleEl) {
                titleEl.innerText = 'NO RESPONSE';
                titleEl.style.color = '#cd3333';
            }

            // Start countdown if not already running
            if (!this.battleRejectionCountdownTimer) {
                this.startBattleRejectionCountdown();
            }
        }
    }

    showStatus(msg, color = "gold") {
        const el = document.getElementById('chat-msg');
        if (el) {
            el.placeholder = msg;
            el.style.borderColor = color === "red" ? "#cd3333" : "#f1c40f";
            setTimeout(() => {
                el.placeholder = "Broadcast to room...";
                el.style.borderColor = "#333";
            }, 4000);
        }
    }

    // ==================== SOUND SYSTEM ====================

    /**
     * Create a simple tone sound using Web Audio API
     */
    createToneSound(frequency, duration, volume = 0.1) {
        return () => {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = frequency;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
            } catch (e) {
                console.warn('Audio playback failed:', e);
            }
        };
    }

    /**
     * Play a sound effect
     */
    playSound(soundName) {
        // Check if sounds are enabled
        if (!this.settings.sound) return;

        if (this.sounds[soundName] && typeof this.sounds[soundName] === 'function') {
            this.sounds[soundName]();
        }
    }

    /**
     * Generate Chinese TTS speech and play it
     */
    async playChineseTTS(text) {
        // Check if sounds are enabled
        if (!this.settings.sound) return;

        try {
            // Cancel any pending game TTS to prevent double announcements
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 0.8;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('TTS playback failed:', e);
        }
    }

    /**
     * Show move animation with sound
     * @param {string} type - 'capture', 'check', 'checkmate', 'stalemate'
     * @param {object} data - Additional data (winner, etc.)
     */
    async showMoveAnimation(type, data = {}) {
        console.log('🎭 showMoveAnimation called:', type, data);

        // Transfer table ownership to winner and process queue (no game-over image)
        if ((type === 'checkmate' || type === 'perpetual-check' || type === 'perpetual-chase' || type === 'resignation' || type === 'timeout') && data.winner) {
            this.transferOwnershipToWinner(data.winner);

            // Process queue: unseat loser, seat first queued player (run once)
            if (!this._queueProcessed) {
                this._queueProcessed = true;
                this.processQueueAfterGame(data.winner);
            }
        }

        // Check if animations are enabled for the sidebar animation
        if (!this.settings.animation) {
            console.log('⏭️ Animations disabled by user settings');
            return;
        }

        const animationEl = document.getElementById('move-animation');
        const iconEl = document.getElementById('move-animation-icon');
        const chineseEl = document.getElementById('move-animation-chinese');
        const englishEl = document.getElementById('move-animation-english');

        if (!animationEl || !iconEl || !chineseEl || !englishEl) {
            console.error('❌ Animation elements not found!');
            return;
        }

        // Hide draw offer modal if showing
        const drawOfferModal = document.getElementById('draw-offer-modal');
        if (drawOfferModal) drawOfferModal.style.display = 'none';

        // Configure animation based on type
        let icon, chinese, english, sound, duration;

        switch(type) {
            case 'capture':
                icon = '⚔️';
                chinese = '吃';
                english = 'CAPTURE';
                sound = '吃';
                duration = 1500;
                break;
            case 'check':
                icon = '👑';
                chinese = '将军';
                english = 'CHECK';
                sound = '将军';
                duration = 2000;
                break;
            case 'checkmate':
                const winner = data.winner === 'red' ? '红胜' : '黑胜';
                const winnerEn = data.winner === 'red' ? 'RED WINS' : 'BLACK WINS';
                icon = '🏆';
                chinese = `绝杀！无解\n${winner}`;
                english = `CHECKMATE!\n${winnerEn}`;
                sound = `绝杀！无解 ${winner}`;
                duration = 5000; // Extended to 5 seconds to match image display
                chineseEl.style.fontSize = '2rem'; // Smaller for multi-line
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            case 'stalemate':
                icon = '🤝';
                chinese = '和棋';
                english = 'STALEMATE';
                sound = '和棋';
                duration = 3000;
                break;
            case 'draw':
                icon = '🔁';
                chinese = '三次重复局面\n和棋';
                english = '3-FOLD REPETITION\nDRAW';
                sound = '三次重复局面 和棋';
                duration = 3500;
                chineseEl.style.fontSize = '1.8rem';
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            case 'perpetual-check':
                const perpetualCheckWinner = data.winner === 'red' ? '红胜' : '黑胜';
                const perpetualCheckWinnerEn = data.winner === 'red' ? 'RED WINS' : 'BLACK WINS';
                icon = '♾️';
                chinese = `连续将军判负\n${perpetualCheckWinner}`;
                english = `PERPETUAL CHECK\n${perpetualCheckWinnerEn}`;
                sound = `连续将军判负 ${perpetualCheckWinner}`;
                duration = 5000; // Extended to 5 seconds to match image display
                chineseEl.style.fontSize = '1.8rem';
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            case 'perpetual-chase':
                const perpetualChaseWinner = data.winner === 'red' ? '红胜' : '黑胜';
                const perpetualChaseWinnerEn = data.winner === 'red' ? 'RED WINS' : 'BLACK WINS';
                icon = '♾️';
                chinese = `长捉判负\n${perpetualChaseWinner}`;
                english = `PERPETUAL CHASE\n${perpetualChaseWinnerEn}`;
                sound = `长捉判负 ${perpetualChaseWinner}`;
                duration = 5000; // Extended to 5 seconds to match image display
                chineseEl.style.fontSize = '1.8rem';
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            case 'resignation':
                const resignationWinner = data.winner === 'red' ? '红胜' : '黑胜';
                const resignationWinnerEn = data.winner === 'red' ? 'RED WINS' : 'BLACK WINS';
                icon = '🏳️';
                chinese = `对手认输\n${resignationWinner}`;
                english = `RESIGNATION\n${resignationWinnerEn}`;
                sound = `对手认输 ${resignationWinner}`;
                duration = 5000; // Extended to 5 seconds to match image display
                chineseEl.style.fontSize = '2rem';
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            case 'timeout':
                const timeoutWinner = data.winner === 'red' ? '红胜' : '黑胜';
                const timeoutWinnerEn = data.winner === 'red' ? 'RED WINS' : 'BLACK WINS';
                const timeoutLoser = data.loser === 'red' ? '红' : '黑';
                icon = '⏰';
                chinese = `${timeoutLoser}方超时\n${timeoutWinner}`;
                english = `TIME OUT!\n${timeoutWinnerEn}`;
                sound = `${timeoutLoser}方超时 ${timeoutWinner}`;
                duration = 5000;
                chineseEl.style.fontSize = '2rem';
                chineseEl.style.whiteSpace = 'pre-line';
                englishEl.style.whiteSpace = 'pre-line';
                break;
            default:
                return;
        }

        // Set content
        iconEl.innerText = icon;
        chineseEl.innerText = chinese;
        englishEl.innerText = english;

        // Show animation
        animationEl.style.display = 'block';

        // Play sound
        if (sound) {
            await this.playChineseTTS(sound);
        }

        // Hide after duration
        setTimeout(() => {
            animationEl.style.display = 'none';
            // Reset font sizes
            chineseEl.style.fontSize = '2.5rem';
            chineseEl.style.whiteSpace = 'normal';
            englishEl.style.whiteSpace = 'normal';
        }, duration);
    }

    /**
     * Show perpetual check warning banner (non-blocking, doesn't cover chess board)
     * @param {number} count - Current consecutive check count (3-6)
     * @param {string} checker - 'red' or 'black' - the player doing the checking
     */
    showPerpetualCheckWarning(count, checker) {
        const warningEl = document.getElementById('perpetual-check-warning');
        if (!warningEl) return;

        const remaining = 7 - count;
        const checkerName = checker === 'red' ? '红方' : '黑方';
        const checkerNameEn = checker === 'red' ? 'Red' : 'Black';

        // Determine if the current user is the one checking
        const iAmRed = this.table?.playerRed?.uid === this.user?.uid;
        const iAmBlack = this.table?.playerBlack?.uid === this.user?.uid;
        const myColor = iAmRed ? 'red' : (iAmBlack ? 'black' : null);
        const isMyWarning = myColor === checker;

        let message, messageEn;
        if (isMyWarning) {
            message = `⚠️ 你已连续将军 ${count} 次！再将 ${remaining} 次将判负！`;
            messageEn = `You've checked ${count} times! ${remaining} more = LOSS!`;
        } else {
            message = `⚠️ ${checkerName}已连续将军 ${count} 次 (${remaining} 次后判负)`;
            messageEn = `${checkerNameEn} checked ${count} times (${remaining} more = loss)`;
        }

        warningEl.innerHTML = `<div class="warning-text-cn">${message}</div><div class="warning-text-en">${messageEn}</div>`;
        warningEl.style.display = 'flex';

        // Color intensity based on count
        if (count >= 6) {
            warningEl.className = 'perpetual-check-warning warning-critical';
        } else if (count >= 5) {
            warningEl.className = 'perpetual-check-warning warning-high';
        } else {
            warningEl.className = 'perpetual-check-warning warning-medium';
        }

        console.log(`⚠️ Perpetual check warning: ${checker} has ${count} consecutive checks`);
    }

    /**
     * Hide perpetual check warning banner
     */
    hidePerpetualCheckWarning() {
        const warningEl = document.getElementById('perpetual-check-warning');
        if (warningEl) {
            warningEl.style.display = 'none';
        }
    }

    /**
     * Show game over image overlay on chess board
     * @param {string} winner - 'red' or 'black'
     */
    showGameOverImage(winner) {
        console.log('🎬 showGameOverImage called with winner:', winner);

        const overlayEl = document.getElementById('game-over-overlay');
        const imageEl = document.getElementById('game-over-image');

        console.log('🖼️ Overlay element:', overlayEl);
        console.log('🖼️ Image element:', imageEl);

        if (!overlayEl || !imageEl) {
            console.error('❌ Game over overlay elements not found!');
            console.error('   overlayEl:', overlayEl);
            console.error('   imageEl:', imageEl);
            return;
        }

        // Determine which image to show
        // If red wins, black loses (show Black_Lose.png)
        // If black wins, red loses (show Red_Lose.png)
        const imagePath = winner === 'red'
            ? '/pictures/Black_Lose.png'
            : '/pictures/Red_Lose.png';

        console.log('🖼️ Setting image path to:', imagePath);
        console.log('🖼️ Current overlay classes:', overlayEl.className);
        console.log('🖼️ Current overlay style.opacity:', overlayEl.style.opacity);
        console.log('🖼️ Current overlay style.visibility:', overlayEl.style.visibility);

        // Set image source and show overlay with class
        imageEl.src = imagePath;

        // Add show class
        overlayEl.classList.add('show');

        console.log('✅ Added "show" class to overlay');
        console.log('🖼️ Updated overlay classes:', overlayEl.className);
        console.log('🖼️ Computed opacity:', window.getComputedStyle(overlayEl).opacity);
        console.log('🖼️ Computed visibility:', window.getComputedStyle(overlayEl).visibility);

        // Transfer table ownership to winner
        this.transferOwnershipToWinner(winner);

        // Hide overlay after 10 seconds
        setTimeout(() => {
            overlayEl.classList.remove('show');
            console.log('🎬 Game over image hidden - removed "show" class');
        }, 10000);
    }

    async transferOwnershipToWinner(winner) {
        if (!this.table) return;

        const winnerPlayer = winner === 'red' ? this.table.playerRed : this.table.playerBlack;

        if (!winnerPlayer) {
            console.log('⚠️ Winner player not found, skipping ownership transfer');
            return;
        }

        console.log('👑 Transferring table ownership to winner:', winner, winnerPlayer.name);

        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            await setDoc(tRef, {
                tableOwner: {
                    uid: winnerPlayer.uid,
                    name: winnerPlayer.name,
                    since: Date.now()
                }
            }, { merge: true });

            // Show notification about new ownership
            const winnerName = winnerPlayer.name.toUpperCase();
            this.showStatus(`👑 ${winnerName} is now the Table Owner!`, "gold");
            console.log('✅ Table ownership transferred to winner');
        } catch (error) {
            console.error('❌ Failed to transfer ownership:', error);
        }
    }

    /**
     * Switch sidebar tab
     */
    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none';
        });
        document.querySelectorAll('.sidebar-tab').forEach(btn => {
            btn.classList.remove('active');
        });

        // Show selected tab
        const tabContent = document.getElementById(`tab-content-${tabName}`);
        const tabBtn = document.getElementById(`tab-btn-${tabName}`);

        if (tabContent) {
            tabContent.classList.add('active');
            tabContent.style.display = 'flex';
        }
        if (tabBtn) {
            tabBtn.classList.add('active');
        }

        // Update FEN and moves if switching to MOVES tab
        if (tabName === 'moves') {
            this.updateFENDisplay();
            this.updateMoveHistory();
        }

        // Update queue display if switching to QUEUE tab
        if (tabName === 'queue') {
            this.updateQueueDisplay();
        }
    }

    // ===== QUEUE SYSTEM =====

    /**
     * Join the game queue as an observer
     */
    async joinQueue() {
        if (!this.user) {
            this.showStatus('You must be logged in to join the queue', 'red');
            return;
        }

        // Check if already seated
        const isSeated = this.table?.playerRed?.uid === this.user.uid ||
                         this.table?.playerBlack?.uid === this.user.uid;
        if (isSeated) {
            this.showStatus('You are already seated!', 'red');
            return;
        }

        // Check if already in queue
        const queue = this.table?.queue || [];
        if (queue.some(q => q.uid === this.user.uid)) {
            this.showStatus('You are already in the queue!', 'red');
            return;
        }

        // If a seat is vacant, sit directly instead of queuing
        const redOpen = !this.table?.playerRed;
        const blackOpen = !this.table?.playerBlack;
        if (redOpen || blackOpen) {
            const side = redOpen ? 'red' : 'black';
            console.log(`🎫 Seat is open (${side}) — sitting directly instead of queuing`);
            this.sit(side);
            return;
        }

        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            const myName = this.profile?.playerName || this.user.displayName || this.user.email?.split('@')[0] || 'Anonymous';
            const myElo = this.profile?.elo || 1200;
            const myAvatar = this.profile?.avatarUrl || this.user.photoURL || '/lobby/1.JPG';

            await setDoc(tRef, {
                queue: arrayUnion({
                    uid: this.user.uid,
                    name: myName,
                    elo: myElo,
                    avatar: myAvatar,
                    joinedAt: Date.now()
                })
            }, { merge: true });

            console.log('🎫 Joined queue');
            this.showStatus('🎫 You joined the queue!', 'green');
        } catch (error) {
            console.error('❌ Failed to join queue:', error);
            this.showStatus('Failed to join queue', 'red');
        }
    }

    /**
     * Leave the game queue voluntarily
     */
    async leaveQueue() {
        if (!this.user) return;

        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();
            const queue = t?.queue || [];
            const updatedQueue = queue.filter(q => q.uid !== this.user.uid);

            await setDoc(tRef, { queue: updatedQueue }, { merge: true });

            console.log('❌ Left queue');
            this.showStatus('You left the queue', 'gold');
        } catch (error) {
            console.error('❌ Failed to leave queue:', error);
        }
    }

    /**
     * Remove a user from queue by uid (used internally)
     */
    async removeFromQueue(uid) {
        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();
            const queue = t?.queue || [];
            const updatedQueue = queue.filter(q => q.uid !== uid);

            await setDoc(tRef, { queue: updatedQueue }, { merge: true });
        } catch (error) {
            console.error('❌ Failed to remove from queue:', error);
        }
    }

    /**
     * Process queue after a game ends with a winner.
     * The loser is unseated and the first person in queue takes their seat.
     * @param {string} winner - 'red' or 'black'
     */
    async processQueueAfterGame(winner) {
        if (!winner || winner === 'draw') {
            console.log('🎫 Draw game — no queue processing, both players keep seats');
            return;
        }

        const loserSide = winner === 'red' ? 'black' : 'red';
        const loserKey = loserSide === 'red' ? 'playerRed' : 'playerBlack';

        try {
            const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
            const freshSnap = await getDoc(tRef);
            const t = freshSnap.data();
            const queue = t?.queue || [];

            if (queue.length === 0) {
                console.log('🎫 No one in queue — loser keeps seat');
                return;
            }

            // Sort queue by joinedAt to ensure proper order
            queue.sort((a, b) => a.joinedAt - b.joinedAt);

            // First person in queue takes the loser's seat
            const nextPlayer = queue[0];
            const remainingQueue = queue.slice(1);

            console.log(`🎫 Queue processing: ${nextPlayer.name} takes ${loserSide} seat`);

            // Unseat loser, seat next player, update queue
            const updates = {
                [loserKey]: {
                    uid: nextPlayer.uid,
                    name: nextPlayer.name,
                    avatar: nextPlayer.avatar || ''
                },
                queue: remainingQueue
            };

            await setDoc(tRef, updates, { merge: true });

            // Send system chat message
            const gRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
            await setDoc(gRef, {
                chat: arrayUnion({
                    user: 'SYSTEM',
                    text: `🎫 ${nextPlayer.name.toUpperCase()} enters from queue and takes the ${loserSide.toUpperCase()} seat!`,
                    ts: Date.now()
                })
            }, { merge: true });

            this.showStatus(`🎫 ${nextPlayer.name} takes ${loserSide} seat from queue!`, 'gold');

        } catch (error) {
            console.error('❌ Failed to process queue:', error);
        }
    }

    /**
     * Update queue display in the QUEUE tab
     */
    updateQueueDisplay() {
        const queue = this.table?.queue || [];
        // Sort by joinedAt
        const sortedQueue = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);

        // Update count
        const countEl = document.getElementById('queue-count');
        if (countEl) countEl.textContent = `${sortedQueue.length} waiting`;

        // Determine my state
        const isSeated = this.user && (
            this.table?.playerRed?.uid === this.user.uid ||
            this.table?.playerBlack?.uid === this.user.uid
        );
        const myQueueIdx = this.user ? sortedQueue.findIndex(q => q.uid === this.user.uid) : -1;
        const inQueue = myQueueIdx >= 0;

        // Show/hide buttons
        const joinBtn = document.getElementById('btn-join-queue');
        const leaveBtn = document.getElementById('btn-leave-queue');
        const myPosEl = document.getElementById('queue-my-position');
        const statusEl = document.getElementById('queue-status-msg');

        if (joinBtn) joinBtn.style.display = (!isSeated && !inQueue && this.user) ? 'block' : 'none';
        if (leaveBtn) leaveBtn.style.display = inQueue ? 'block' : 'none';

        if (myPosEl) {
            if (inQueue) {
                myPosEl.style.display = 'block';
                myPosEl.textContent = `🎫 Your position: #${myQueueIdx + 1} of ${sortedQueue.length}`;
            } else {
                myPosEl.style.display = 'none';
            }
        }

        if (statusEl) {
            if (isSeated) {
                statusEl.textContent = 'You are currently seated as a player.';
            } else if (!this.user) {
                statusEl.textContent = 'Log in to join the queue.';
            } else if (inQueue) {
                statusEl.textContent = myQueueIdx === 0
                    ? '⚡ You are NEXT to play!'
                    : `Waiting... ${myQueueIdx} player(s) ahead of you.`;
            } else {
                const bothSeated = this.table?.playerRed && this.table?.playerBlack;
                statusEl.textContent = bothSeated
                    ? 'Both seats taken. Join the queue to play next!'
                    : 'A seat is open — you can sit directly from the GAME tab.';
            }
        }

        // Render queue list
        const listEl = document.getElementById('queue-list');
        if (!listEl) return;

        if (sortedQueue.length === 0) {
            listEl.innerHTML = '<div class="queue-empty">No one in queue. Join to play next!</div>';
            return;
        }

        listEl.innerHTML = sortedQueue.map((q, i) => {
            const isMe = this.user && q.uid === this.user.uid;
            const timeAgo = this.formatQueueTime(q.joinedAt);
            return `<div class="queue-item ${isMe ? 'queue-item-me' : ''}">
                <div class="queue-num">${i + 1}</div>
                <div class="queue-item-info">
                    <div class="queue-item-name">${q.name || 'Anonymous'}${isMe ? ' (YOU)' : ''}</div>
                    <div class="queue-item-elo">⭐ ${q.elo || 1200}</div>
                </div>
                <div class="queue-item-time">${timeAgo}</div>
            </div>`;
        }).join('');
    }

    /**
     * Format queue join time as relative string
     */
    formatQueueTime(ts) {
        const secs = Math.floor((Date.now() - ts) / 1000);
        if (secs < 60) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        return `${hrs}h ago`;
    }

    /**
     * Update FEN display
     */
    updateFENDisplay() {
        const fenDisplay = document.getElementById('fen-display');
        if (!fenDisplay || !this.gameState?.board) return;

        const fen = this.engine.boardToFEN(this.gameState.board, this.gameState.turn);
        fenDisplay.textContent = fen;
    }

    /**
     * Update move history display
     */
    updateMoveHistory() {
        const historyList = document.getElementById('move-history-list');
        if (!historyList) return;

        const history = this.gameState?.history || [];

        if (history.length === 0) {
            historyList.innerHTML = '<div style="text-align: center; color: #666; padding: 40px 20px; font-size: 0.8rem;">No moves yet. Game will begin once both players are seated.</div>';
            return;
        }

        // Group moves by round (2 moves = 1 round)
        let html = '<div style="display: grid; grid-template-columns: 50px 1fr 1fr; gap: 8px; font-family: \'Courier New\', monospace; font-size: 0.75rem;">';
        html += '<div style="font-weight: 900; color: var(--gold); padding-bottom: 8px; border-bottom: 1px solid #333;">Round</div>';
        html += '<div style="font-weight: 900; color: var(--gold); padding-bottom: 8px; border-bottom: 1px solid #333;">Red</div>';
        html += '<div style="font-weight: 900; color: var(--gold); padding-bottom: 8px; border-bottom: 1px solid #333;">Black</div>';

        for (let i = 0; i < history.length; i += 2) {
            const round = Math.floor(i / 2) + 1;
            const redMove = history[i];
            const blackMove = history[i + 1];

            html += `<div style="color: #888; padding: 4px 0;">${round}</div>`;
            html += `<div style="color: #fff; padding: 4px 0;">${this.formatMoveNotation(redMove)}</div>`;
            html += `<div style="color: #fff; padding: 4px 0;">${blackMove ? this.formatMoveNotation(blackMove) : '...'}</div>`;
        }
        html += '</div>';

        historyList.innerHTML = html;
    }

    /**
     * Format a move as proper Chinese Xiangqi notation (e.g., 炮二平五, 马八进七).
     * Delegates to moveToChineseNotation which already handles all the rules.
     * No board state is passed here, so disambiguation (前/后) is skipped —
     * that is only needed at save time when we have the full running board.
     */
    formatMoveNotation(move) {
        if (!move || !move.from || !move.to) return '???';
        return this.moveToChineseNotation(move, null, null);
    }

    /**
     * Copy FEN to clipboard
     */
    copyFEN() {
        const fenDisplay = document.getElementById('fen-display');
        if (!fenDisplay) return;

        const fen = fenDisplay.textContent;
        navigator.clipboard.writeText(fen).then(() => {
            this.showStatus('FEN copied to clipboard!', '#27ae60');
        }).catch(err => {
            console.error('Failed to copy FEN:', err);
            this.showStatus('Failed to copy FEN', 'red');
        });
    }

    /**
     * Export game as PGN file
     */
    exportPGN() {
        const history = this.gameState?.history || [];
        if (history.length === 0) {
            this.showStatus('No moves to export!', 'red');
            return;
        }

        // Build PGN content
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
        const redPlayer = this.table?.playerRed?.name || 'Red Player';
        const blackPlayer = this.table?.playerBlack?.name || 'Black Player';

        let result = '*'; // Ongoing
        if (this.gameState.status === 'checkmate' || this.gameState.status === 'perpetual-check' || this.gameState.status === 'perpetual-chase') {
            result = this.gameState.winner === 'red' ? '1-0' : '0-1';
        } else if (this.gameState.status === 'draw' || this.gameState.status === 'stalemate') {
            result = '1/2-1/2';
        }

        let pgn = `[Event "SG Xiangqi Match"]\n`;
        pgn += `[Site "xiangqi-sq.web.app"]\n`;
        pgn += `[Date "${date}"]\n`;
        pgn += `[Round "1"]\n`;
        pgn += `[Red "${redPlayer}"]\n`;
        pgn += `[Black "${blackPlayer}"]\n`;
        pgn += `[Result "${result}"]\n\n`;

        // Add moves
        for (let i = 0; i < history.length; i += 2) {
            const round = Math.floor(i / 2) + 1;
            const redMove = this.formatMoveNotation(history[i]);
            const blackMove = history[i + 1] ? this.formatMoveNotation(history[i + 1]) : '';

            pgn += `${round}. ${redMove} ${blackMove}\n`;
        }

        pgn += `${result}\n`;

        // Download as file with unique timestamp
        const now = new Date();
        const time = now.toTimeString().split(' ')[0].substring(0, 5).replace(':', ''); // Format: HHMM
        const filename = `xiangqi-game-${date}-${time}.pgn`;

        const blob = new Blob([pgn], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showStatus('Game exported as PGN!', '#27ae60');

        // Auto-save to localStorage and Firestore if enabled
        if (this.settings.autosave) {
            this.saveGameToStorage(pgn);
        }
    }

    /**
     * Save game to LocalStorage and Firestore
     */
    async saveGameToStorage(pgn) {
        const gameId = this.tid;
        const timestamp = Date.now();
        const gameData = {
            id: gameId,
            pgn: pgn,
            timestamp: timestamp,
            redPlayer: this.table?.playerRed?.name || 'Red Player',
            blackPlayer: this.table?.playerBlack?.name || 'Black Player',
            result: this.gameState?.status || 'ongoing'
        };

        // Save to LocalStorage
        try {
            const savedGames = JSON.parse(localStorage.getItem('xq-saved-games') || '[]');
            savedGames.push(gameData);
            // Keep only last 50 games
            if (savedGames.length > 50) savedGames.shift();
            localStorage.setItem('xq-saved-games', JSON.stringify(savedGames));
            console.log('Game saved to LocalStorage');
        } catch (e) {
            console.error('Failed to save to LocalStorage:', e);
        }

        // Save to Firestore (user profile)
        if (this.user) {
            try {
                const userGamesRef = doc(this.db, 'artifacts', this.appId, 'users', this.user.uid, 'games', gameId);
                await setDoc(userGamesRef, gameData);
                console.log('Game saved to Firestore');
            } catch (e) {
                console.error('Failed to save to Firestore:', e);
            }
        }
    }

    /**
     * Initialize settings UI to match loaded settings
     */
    initializeSettingsUI() {
        console.log('⚙️ Initializing settings UI to match loaded settings...');

        // Update each setting toggle to match current state
        ['sound', 'animation', 'music', 'autosave', 'voiceChat'].forEach(settingName => {
            const value = this.settings[settingName];
            const onBtn = document.getElementById(`setting-${settingName}-on`);
            const offBtn = document.getElementById(`setting-${settingName}-off`);

            if (onBtn && offBtn) {
                if (value) {
                    onBtn.classList.add('active');
                    offBtn.classList.remove('active');
                } else {
                    onBtn.classList.remove('active');
                    offBtn.classList.add('active');
                }
                console.log(`  ${settingName}: ${value ? 'ON' : 'OFF'}`);
            }
        });

        // Initialize voice type selector
        document.querySelectorAll('.voice-type-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeVoiceBtn = document.getElementById(`voice-type-${this.settings.voiceType}`);
        if (activeVoiceBtn) activeVoiceBtn.classList.add('active');
        console.log(`  voiceType: ${this.settings.voiceType}`);

        console.log('✅ Settings UI initialized');
    }

    /**
     * Change setting
     */
    setSetting(settingName, value) {
        this.settings[settingName] = value;
        localStorage.setItem(`xq-setting-${settingName}`, value);

        console.log(`⚙️ Setting "${settingName}" changed to: ${value}`);

        // Update UI
        const onBtn = document.getElementById(`setting-${settingName}-on`);
        const offBtn = document.getElementById(`setting-${settingName}-off`);

        if (value) {
            onBtn?.classList.add('active');
            offBtn?.classList.remove('active');
        } else {
            onBtn?.classList.remove('active');
            offBtn?.classList.add('active');
        }

        this.showStatus(`${settingName.charAt(0).toUpperCase() + settingName.slice(1)} ${value ? 'enabled' : 'disabled'}`, value ? '#27ae60' : '#888');

        // If voiceChat toggled ON, reset ready time so new messages will be spoken
        if (settingName === 'voiceChat' && value) {
            this._voiceChatReadyTime = Date.now();
            this._spokenChatIds.clear();
            console.log('🔊 Voice Chat enabled — listening for new messages from now');
        }

        // If music setting changed, handle music accordingly
        if (settingName === 'music') {
            if (value && this.occupants && this.occupants.length > 0) {
                console.log('🔊 Music enabled, starting ambient music...');
                this.startAmbientMusic();
            } else if (!value) {
                console.log('🔇 Music disabled, stopping ambient music...');
                this.stopAmbientMusic();
            }
        }
    }

    /**
     * Set voice character type for Voice Chat TTS
     */
    setVoiceType(type) {
        if (!VOICE_PROFILES[type]) return;
        this.settings.voiceType = type;
        localStorage.setItem('xq-setting-voiceType', type);

        const profile = VOICE_PROFILES[type];
        console.log(`🔊 Voice type changed to: ${profile.emoji} ${profile.label}`);
        this.showStatus(`Voice: ${profile.emoji} ${profile.label}`, '#f1c40f');

        // Update UI - highlight selected button
        document.querySelectorAll('.voice-type-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.getElementById(`voice-type-${type}`);
        if (activeBtn) activeBtn.classList.add('active');
    }

    /**
     * Render chat text - highlights voice portions wrapped in () or （） with a speaker icon
     * Shows the voice character emoji if voiceType is available on the message
     */
    renderChatText(text, voiceType) {
        const profile = VOICE_PROFILES[voiceType] || VOICE_PROFILES['young-lady'];
        // Match both English () and Chinese （） brackets
        return text.replace(/(?:\(([^)]+)\)|（([^）]+)）)/g, (match, enInner, cnInner) => {
            const inner = enInner || cnInner;
            return `<span style="color:#f1c40f; font-style:italic;" title="Voice: ${profile.label}">${profile.emoji}🔊 ${inner}</span>`;
        });
    }

    /**
     * Get a voice for the given language and gender preference
     * @param {string} lang - e.g. 'zh-CN' or 'en-US'
     * @param {string} gender - 'male' or 'female'
     */
    _getVoice(lang, gender = 'female') {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return null;

        const langPrefix = lang.split('-')[0]; // 'zh' or 'en'

        // Filter voices matching the language
        const matching = voices.filter(v =>
            v.lang.startsWith(langPrefix) || v.lang.startsWith(lang)
        );

        const femaleKeywords = ['female', 'woman', 'zira', 'hazel', 'susan', 'samantha', 'karen', 'moira', 'fiona', 'tessa', 'victoria', 'huihui', 'yaoyao', 'lili', 'xiaoxiao', 'zhiyu'];
        const maleKeywords = ['male', 'man', 'david', 'mark', 'james', 'richard', 'george', 'kangkang', 'zhiwei', 'daniel'];

        const keywords = gender === 'male' ? maleKeywords : femaleKeywords;
        const found = matching.find(v => {
            const name = v.name.toLowerCase();
            return keywords.some(kw => name.includes(kw));
        });
        if (found) {
            console.log(`🔊 Selected ${gender} voice: ${found.name} (${found.lang})`);
            return found;
        }

        // Fallback: first matching voice
        if (matching.length) {
            console.log(`🔊 Fallback voice: ${matching[0].name} (${matching[0].lang})`);
            return matching[0];
        }

        return null;
    }

    /**
     * Voice Chat TTS - speaks text wrapped in parentheses () or （）
     * Auto-detects language: CJK characters → Mandarin, otherwise English
     * All users with Voice Chat ON will hear it when a new chat arrives via Firestore
     */
    speakVoiceChat(chatArray) {
        if (!this.settings.voiceChat) return;
        if (!chatArray || !chatArray.length) return;
        if (!window.speechSynthesis) return;

        // Only process recent messages
        const recent = chatArray.slice(-50);
        for (const m of recent) {
            // Skip messages from before page loaded (don't replay old chat)
            if (m.ts < this._voiceChatReadyTime) continue;

            // Create a unique ID for each message
            const msgId = `${m.user}_${m.ts}_${m.text}`;
            if (this._spokenChatIds.has(msgId)) continue;
            this._spokenChatIds.add(msgId);

            // Match both English () and Chinese （） brackets
            const voiceMatches = m.text.match(/(?:\(([^)]+)\)|（([^）]+)）)/g);
            if (!voiceMatches) continue;

            console.log(`🔊 Voice Chat detected from ${m.user}:`, voiceMatches);

            // Get voice profile from the message (speaker's chosen voice)
            const profile = VOICE_PROFILES[m.voiceType] || VOICE_PROFILES['young-lady'];

            for (const match of voiceMatches) {
                // Extract the inner text (remove the brackets - first/last char)
                const inner = match.slice(1, -1).trim();
                if (!inner) continue;

                // Detect if text contains CJK characters (Chinese/Japanese/Korean)
                const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(inner);
                const lang = hasCJK ? 'zh-CN' : 'en-US';

                const utterance = new SpeechSynthesisUtterance(inner);
                utterance.lang = lang;
                utterance.rate = profile.rate;
                utterance.pitch = profile.pitch;

                // Pick voice matching the profile's gender
                const voice = this._getVoice(lang, profile.gender);
                if (voice) utterance.voice = voice;

                utterance.volume = 1;

                console.log(`🔊 Speaking [${lang}] as ${profile.emoji} ${profile.label}: "${inner}" (from ${m.user}) voice: ${voice?.name || 'default'}`);
                window.speechSynthesis.speak(utterance);
            }
        }

        // Keep the spoken set from growing too large
        if (this._spokenChatIds.size > 200) {
            const arr = [...this._spokenChatIds];
            this._spokenChatIds = new Set(arr.slice(-100));
        }
    }

    /**
     * Ambient Music Control - Sequential Playback
     */
    startAmbientMusic() {
        // Don't start if music is disabled
        if (!this.settings.music) return;

        // Don't restart if already playing
        if (this.ambientMusic && !this.ambientMusic.paused) return;

        // Get current track
        const currentTrack = this.musicTracks[this.currentTrackIndex];

        // Create or reuse audio element
        if (!this.ambientMusic) {
            this.ambientMusic = new Audio(currentTrack);
            this.ambientMusic.volume = 0.3; // 30% volume for ambient background

            // When song ends, play next track
            this.ambientMusic.addEventListener('ended', () => {
                console.log('🎵 Song ended, playing next track...');
                this.playNextTrack();
            });
        } else {
            this.ambientMusic.src = currentTrack;
        }

        // Play music
        this.ambientMusic.play().catch(err => {
            console.log('🎵 Music autoplay blocked (browser policy):', err.message);
            // Add one-time click listener to start music on first user interaction
            if (!this.musicUnblockListenerAdded) {
                this.musicUnblockListenerAdded = true;
                const unblockMusic = () => {
                    console.log('🎵 User interaction detected, attempting to play music...');
                    if (this.ambientMusic && this.ambientMusic.paused && this.settings.music) {
                        this.ambientMusic.play().catch(e => console.log('🎵 Still blocked:', e.message));
                    }
                    document.removeEventListener('click', unblockMusic);
                    document.removeEventListener('keydown', unblockMusic);
                };
                document.addEventListener('click', unblockMusic);
                document.addEventListener('keydown', unblockMusic);
                console.log('🎵 Music will start on first click or keypress');
            }
        });

        console.log('🎵 Ambient music started:', currentTrack, `(Track ${this.currentTrackIndex + 1}/${this.musicTracks.length})`);
    }

    playNextTrack() {
        // Pick a random track (avoid repeating the same track)
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * this.musicTracks.length);
        } while (newIndex === this.currentTrackIndex && this.musicTracks.length > 1);

        this.currentTrackIndex = newIndex;

        const nextTrack = this.musicTracks[this.currentTrackIndex];
        console.log('🎵 Loading next track (random):', nextTrack, `(Track ${this.currentTrackIndex + 1}/${this.musicTracks.length})`);

        if (this.ambientMusic) {
            this.ambientMusic.src = nextTrack;
            this.ambientMusic.play().catch(err => {
                console.error('🎵 Error playing next track:', err);
            });
        }
    }

    stopAmbientMusic() {
        if (this.ambientMusic) {
            this.ambientMusic.pause();
            this.ambientMusic.currentTime = 0;
            console.log('🎵 Ambient music stopped');
        }
    }

    handleMusicOnOccupantsChange() {
        const occupantCount = this.occupants?.length || 0;

        console.log('🎵 Music check - Occupants:', occupantCount, 'Music enabled:', this.settings.music);

        if (occupantCount > 0 && this.settings.music) {
            // Room has people and music is on - start music
            this.startAmbientMusic();
        } else if (occupantCount === 0) {
            // Room is empty - stop music
            this.stopAmbientMusic();
        }
    }

    // === BUG REPORTING SYSTEM ===
    showBugReportDialog() {
        const dialog = document.getElementById('bug-report-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            document.getElementById('bug-description').value = '';
            document.getElementById('bug-description').focus();
        }
    }

    closeBugReportDialog() {
        const dialog = document.getElementById('bug-report-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    async submitBugReport() {
        try {
            const description = document.getElementById('bug-description').value.trim();
            if (!description) {
                alert('Please describe the issue before submitting.');
                return;
            }

            // Use the debug logger to submit report
            if (window.debugLogger) {
                const reportId = await window.debugLogger.submitBugReport(
                    description,
                    this.db,
                    this.appId
                );

                this.closeBugReportDialog();

                if (reportId) {
                    alert('Bug report submitted successfully! Thank you for helping improve the game.');
                } else {
                    alert('Bug report saved locally. It will be synced when connection is available.');
                }
            } else {
                alert('Debug logger not available. Please refresh the page and try again.');
            }
        } catch (e) {
            console.error('Error submitting bug report:', e);
            alert('Failed to submit bug report: ' + e.message);
        }
    }

    // === GAME HISTORY RECORDING SYSTEM ===

    /**
     * Convert ICCS move notation to Chinese Xiangqi notation
     * @param {object} move - Move data with from/to coordinates and piece
     * @param {number} moveIndex - Move number in the game
     * @returns {string} - Chinese notation (e.g., "炮二平五" or "C24")
     */
    moveToChineseNotation(move, moveIndex, board) {
        const { from, to, piece } = move;
        if (!piece || from == null || to == null) return '?';

        const isRed = piece === piece.toUpperCase();
        const pieceUpper = piece.toUpperCase();

        // Piece names differ by colour (N = Horse in engine init, same as H)
        const redNames   = { R:'车', H:'马', N:'马', E:'相', A:'仕', K:'帅', C:'炮', P:'兵' };
        const blackNames = { R:'车', H:'马', N:'马', E:'象', A:'士', K:'将', C:'炮', P:'卒' };
        const pieceName  = isRed ? (redNames[pieceUpper]   || piece)
                                 : (blackNames[pieceUpper] || piece);

        // File numbers from each player's perspective (1–9)
        // Red sits at bottom: files increase right-to-left  → file = 9 - col
        // Black sits at top:  files increase left-to-right  → file = col + 1
        const fileNum = col => isRed ? (9 - col) : (col + 1);

        const fromFile = fileNum(from.x);
        const toFile   = fileNum(to.x);

        // Determine direction and destination number
        let direction, distNum;

        const isOblique = (pieceUpper === 'H' || pieceUpper === 'N' || pieceUpper === 'E');

        if (isOblique || from.x !== to.x) {
            // Horse, Elephant, or any sideways move
            if (from.x === to.x) {
                // Purely vertical (shouldn't happen for H/E but guard it)
                const adv = isRed ? (to.y < from.y) : (to.y > from.y);
                direction = adv ? '进' : '退';
                distNum   = Math.abs(to.y - from.y);
            } else if (from.y === to.y) {
                // Purely horizontal (Rook, Cannon, Pawn)
                direction = '平';
                distNum   = toFile;
            } else {
                // Oblique (Horse / Elephant) or diagonal - use destination file
                const adv = isRed ? (to.y < from.y) : (to.y > from.y);
                direction = adv ? '进' : '退';
                distNum   = toFile;   // standard: destination file for H and E
            }
        } else {
            // Same column → vertical move
            const adv = isRed ? (to.y < from.y) : (to.y > from.y);
            direction = adv ? '进' : '退';
            distNum   = Math.abs(to.y - from.y);
        }

        // Chinese numeral lookup (indices 1–9)
        const chNums = ['','一','二','三','四','五','六','七','八','九'];

        // Disambiguation: if another piece of the same type sits on the same column,
        // replace the file-number prefix with 前 (front) or 后 (rear).
        let prefix = chNums[fromFile] || String(fromFile);
        if (board) {
            const twins = [];
            for (let row = 0; row < 10; row++) {
                const cell = board[row]?.[from.x];
                if (cell && cell === piece && row !== from.y) {
                    twins.push(row);
                }
            }
            if (twins.length > 0) {
                // 前 = the piece nearer the opponent's home rank
                // Red advances toward lower y → smaller y is "前"
                // Black advances toward higher y → larger y is "前"
                const otherRow = twins[0];
                const isFront  = isRed ? (from.y < otherRow) : (from.y > otherRow);
                prefix = isFront ? '前' : '后';
            }
        }

        // Convert destination number to Chinese numeral
        const distCn = chNums[distNum] || String(distNum);

        return `${pieceName}${prefix}${direction}${distCn}`;
    }

    /**
     * Convert move data to ICCS format (from-to squares)
     * @param {object} move - Move data with from/to coordinates
     * @returns {string} - ICCS notation (e.g., "h2e2")
     */
    moveToICCS(move) {
        const { from, to } = move;
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
        return `${files[from.x]}${9 - from.y}${files[to.x]}${9 - to.y}`;
    }

    /**
     * Manual save game - triggered by user clicking "Save Game" button
     * Determines winner based on current game state
     */
    async manualSaveGame() {
        try {
            console.log('💾 Manual save game triggered by user...');

            // Check if there's a game to save
            if (!this.gameState) {
                alert('⚠️ No game data to save!');
                return;
            }

            const history = this.gameState.history || [];
            if (history.length === 0) {
                alert('⚠️ No moves to save - play some moves first!');
                return;
            }

            // Determine winner and reason from game state
            let winner = this.gameState.winner || null;
            let reason = this.gameState.reason || this.gameState.status || 'manual-save';

            // If game is still playing, save as "in-progress"
            if (this.gameState.status === 'playing') {
                winner = 'in-progress';
                reason = 'manual-save';
            }

            // Reset the in-memory save flag and force override ALL duplicate checks
            const saveKey = `${this.tid}_histor_saved`;
            this[saveKey] = false;

            // Call with forceOverride=true — bypasses historySaved flag AND duplicate query
            await this.saveGameToHistory(winner, reason, true);

            // saveGameToHistory sets saveKey=true only after a successful write
            if (!this[saveKey]) {
                alert('⚠️ Manual save did not complete.\n\nCheck browser console (F12) for details.');
            }

        } catch (error) {
            console.error('❌ Manual save error:', error);
            this.showStatus("Failed to save game: " + error.message, "red");
        }
    }

    /**
     * Save completed game to players' history
     * Stores up to 500 games per player, auto-purging oldest games
     * @param {string} winner - 'red', 'black', or 'draw'
     * @param {string} reason - 'checkmate', 'resignation', 'draw', 'timeout', etc.
     */
    async saveGameToHistory(winner, reason, forceOverride = false) {
        const saveKey = `${this.tid}_histor_saved`;
        try {
            console.log('💾 Saving game to history...', { winner, reason, forceOverride });

            // ========== DUPLICATE CHECK: Firestore-based (survives page refresh, works across clients) ==========
            if (!forceOverride) {
                // Check game document for historySaved flag (source of truth)
                const gameRefCheck = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                const freshCheck = await getDoc(gameRefCheck);
                if (freshCheck.exists() && freshCheck.data()?.historySaved) {
                    console.log('✅ Game already saved (confirmed from Firestore historySaved flag)');
                    this[saveKey] = true;
                    this.showStatus("✅ Game already saved!", "gold");
                    return false;
                }
            }

            // Also check in-memory flag as fast guard (non-authoritative)
            if (this[saveKey] && !forceOverride) {
                console.log('⚠️ Game already saved to history (in-memory flag), skipping duplicate save');
                return false;
            }

            // Get player data - prefer cached data from game start (most reliable),
            // fall back to current table data
            let redPlayer = this._cachedPlayers?.red?.uid
                ? this._cachedPlayers.red
                : this.table?.playerRed;
            let blackPlayer = this._cachedPlayers?.black?.uid
                ? this._cachedPlayers.black
                : this.table?.playerBlack;

            // 3rd fallback: read player data from the game document itself
            // (stored there since engageBattle now saves playerRed/playerBlack to game doc)
            if (!redPlayer?.uid || !blackPlayer?.uid) {
                console.log('⚠️ Player data missing from cache and table, trying game document...');
                try {
                    const gameRefForPlayers = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                    const gameSnapForPlayers = await getDoc(gameRefForPlayers);
                    if (gameSnapForPlayers.exists()) {
                        const gd = gameSnapForPlayers.data();
                        if (!redPlayer?.uid && gd.playerRed?.uid) {
                            redPlayer = gd.playerRed;
                            console.log('✅ Got red player from game doc:', redPlayer.uid);
                        }
                        if (!blackPlayer?.uid && gd.playerBlack?.uid) {
                            blackPlayer = gd.playerBlack;
                            console.log('✅ Got black player from game doc:', blackPlayer.uid);
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Failed to read game doc for player data:', e.message);
                }
            }

            // 4th fallback: read player data from the table document in Firestore
            // (table doc may still have player data even if local this.table was cleared)
            if (!redPlayer?.uid || !blackPlayer?.uid) {
                console.log('⚠️ Still missing player data, trying table document...');
                try {
                    const tableRefForPlayers = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
                    const tableSnapForPlayers = await getDoc(tableRefForPlayers);
                    if (tableSnapForPlayers.exists()) {
                        const td = tableSnapForPlayers.data();
                        if (!redPlayer?.uid && td.playerRed?.uid) {
                            redPlayer = td.playerRed;
                            console.log('✅ Got red player from table doc:', redPlayer.uid);
                        }
                        if (!blackPlayer?.uid && td.playerBlack?.uid) {
                            blackPlayer = td.playerBlack;
                            console.log('✅ Got black player from table doc:', blackPlayer.uid);
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Failed to read table doc for player data:', e.message);
                }
            }

            // 5th fallback: use table occupants + usernames registry to identify players
            if (!redPlayer?.uid || !blackPlayer?.uid) {
                console.log('⚠️ Trying occupants + usernames registry fallback...');
                try {
                    // Get occupants from table
                    const tableRefOcc = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
                    const tableSnapOcc = await getDoc(tableRefOcc);
                    const tableDataOcc = tableSnapOcc.exists() ? tableSnapOcc.data() : {};
                    const occupants = tableDataOcc.occupants || [];

                    // Also check game chat for player UIDs/names
                    const gameRefChat = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                    const gameSnapChat = await getDoc(gameRefChat);
                    const gameDataChat = gameSnapChat.exists() ? gameSnapChat.data() : {};

                    // Collect all known UIDs from occupants
                    const knownUids = new Set();
                    occupants.forEach(o => {
                        if (typeof o === 'string') knownUids.add(o);
                        else if (o?.uid) knownUids.add(o.uid);
                    });

                    // If we have exactly 2 UIDs and need both players, look them up
                    if (knownUids.size >= 2) {
                        const uidArray = [...knownUids];
                        // Look up profiles for these UIDs
                        for (const uid of uidArray) {
                            try {
                                const profileRef = doc(this.db, 'artifacts', this.appId, 'users', uid, 'profile', 'data');
                                const profileSnap = await getDoc(profileRef);
                                if (profileSnap.exists()) {
                                    const profile = profileSnap.data();
                                    console.log(`  Found profile for ${uid}: ${profile.playerName}`);
                                }
                            } catch (e) { /* skip */ }
                        }
                        // We found UIDs but don't know who was red/black
                        // Check if the game doc has any hints (like who moved first)
                        console.log('  Found UIDs from occupants but cannot determine red/black assignment');
                    }
                } catch (e) {
                    console.log('⚠️ Occupants fallback failed:', e.message);
                }
            }

            if (!redPlayer?.uid || !blackPlayer?.uid) {
                console.log('⚠️ Cannot save game - missing player data after all fallbacks');
                console.log('  playerRed:', JSON.stringify(redPlayer));
                console.log('  playerBlack:', JSON.stringify(blackPlayer));
                console.log('  cachedPlayers:', JSON.stringify(this._cachedPlayers));
                this[saveKey] = false;
                alert('⚠️ Cannot save - player data missing.\n\nUse recover-game-v2.html to recover this game.');
                return;
            }

            console.log('📋 Using player data:', {
                red: redPlayer.name || redPlayer.uid,
                black: blackPlayer.name || blackPlayer.uid,
                source: this.table?.playerRed?.uid ? 'table' : 'cache'
            });

            // Get game data - retry up to 3 times with delay to handle Firestore latency
            const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
            let gameData = null;
            let history = [];

            for (let attempt = 1; attempt <= 3; attempt++) {
                const gameSnap = await getDoc(gameRef);

                if (!gameSnap.exists()) {
                    console.log(`⚠️ Game data not found (attempt ${attempt}/3)`);
                    if (attempt < 3) {
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    this[saveKey] = false;
                    alert('⚠️ Game data not found in Firestore - record not saved.');
                    return;
                }

                gameData = gameSnap.data();
                history = gameData.history || [];

                if (history.length > 0) break;

                // History might be empty due to Firestore latency after arrayUnion write
                console.log(`⚠️ History empty (attempt ${attempt}/3), retrying...`);
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            // If still no history after retries, try using local gameState as fallback
            if (history.length === 0 && this.gameState?.history?.length > 0) {
                console.log('📋 Using local gameState history as fallback');
                history = this.gameState.history;
            }

            if (history.length === 0) {
                console.log('⚠️ No moves to save - game has no history even after retries');
                this[saveKey] = false;
                alert('⚠️ No moves found in game history - record not saved.');
                return;
            }

            console.log(`📋 Got ${history.length} moves from history`);

            // Convert history to both ICCS and Chinese notation (with safety checks)
            // Maintain a running board so moveToChineseNotation can disambiguate pieces
            const movesICCS = [];
            const movesChinese = [];
            let runningBoard = this.engine.init(); // fresh starting position
            for (let i = 0; i < history.length; i++) {
                const move = history[i];
                try {
                    if (move?.from && move?.to) {
                        movesICCS.push(this.moveToICCS(move));
                        // Pass board state BEFORE this move for disambiguation
                        movesChinese.push(this.moveToChineseNotation(move, i, runningBoard));
                        // Advance the running board
                        runningBoard[move.to.y][move.to.x] = runningBoard[move.from.y][move.from.x];
                        runningBoard[move.from.y][move.from.x] = null;
                    } else {
                        console.warn(`⚠️ Skipping malformed move at index ${i}:`, move);
                        movesICCS.push(`?${i}`);
                        movesChinese.push(`?${i}`);
                    }
                } catch (moveErr) {
                    console.warn(`⚠️ Error converting move ${i}:`, moveErr);
                    movesICCS.push(`?${i}`);
                    movesChinese.push(`?${i}`);
                }
            }

            // Get initial FEN (standard starting position)
            const fenStart = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

            // Get final FEN from current board state
            let fenEnd = '';
            try {
                fenEnd = this.engine.boardToFEN(this.gameState.board, this.gameState.turn);
            } catch (fenErr) {
                console.warn('⚠️ Could not generate FEN:', fenErr);
                fenEnd = 'unknown';
            }

            // Calculate game duration (using timestamps if available)
            const gameStartTime = gameData.startedAt || Date.now();
            const gameEndTime = Date.now();
            const duration = gameEndTime - gameStartTime;

            // Determine source (PC or mobile)
            const isMobile = /Mobi|Android/i.test(navigator.userAgent);
            const source = isMobile ? 'mobile' : 'pc';

            // Generate unique game ID (table ID + timestamp to allow multiple games per table)
            const uniqueGameId = `${this.tid}_${gameEndTime}`;

            // Create game record
            const gameRecord = {
                gameId: uniqueGameId,
                tableId: this.tid,
                regionId: this.rid,
                playerRed: {
                    uid: redPlayer.uid,
                    playerName: redPlayer.playerName || redPlayer.name || 'Red Player',
                    email: redPlayer.email || ''
                },
                playerBlack: {
                    uid: blackPlayer.uid,
                    playerName: blackPlayer.playerName || blackPlayer.name || 'Black Player',
                    email: blackPlayer.email || ''
                },
                winner: winner, // 'red', 'black', or 'draw'
                reason: reason, // 'checkmate', 'resignation', 'draw', 'timeout', etc.
                completedAt: gameEndTime,
                movesICCS: movesICCS,
                movesChinese: movesChinese,
                fenStart: fenStart,
                fenEnd: fenEnd,
                totalMoves: history.length,
                duration: duration,
                source: source
            };

            console.log('📝 Game record prepared:', {
                gameId: uniqueGameId,
                players: `${redPlayer.playerName} vs ${blackPlayer.playerName}`,
                moves: history.length,
                winner: winner
            });

            // Only calculate ELO for completed games (not in-progress saves)
            const isCompletedGame = winner === 'red' || winner === 'black' || winner === 'draw';

            if (isCompletedGame) {
                try {
                    // Import ELO system
                    const { eloSystem } = await import('./elo-system.js');

                    // Load current ELO ratings and games played for both players
                    const redProfileRef = doc(this.db, 'artifacts', this.appId, 'users', redPlayer.uid, 'profile', 'data');
                    const blackProfileRef = doc(this.db, 'artifacts', this.appId, 'users', blackPlayer.uid, 'profile', 'data');

                    const [redProfileSnap, blackProfileSnap] = await Promise.all([
                        getDoc(redProfileRef),
                        getDoc(blackProfileRef)
                    ]);

                    // Get current ratings (default to starting ELO if not set)
                    const redProfile = redProfileSnap.exists() ? redProfileSnap.data() : {};
                    const blackProfile = blackProfileSnap.exists() ? blackProfileSnap.data() : {};

                    const redCurrentELO = redProfile.elo || eloSystem.STARTING_ELO;
                    const blackCurrentELO = blackProfile.elo || eloSystem.STARTING_ELO;
                    const redGamesPlayed = redProfile.gamesPlayed || 0;
                    const blackGamesPlayed = blackProfile.gamesPlayed || 0;

                    // Calculate ELO changes
                    const eloChanges = eloSystem.calculateGameRatings({
                        redPlayer: {
                            uid: redPlayer.uid,
                            elo: redCurrentELO,
                            gamesPlayed: redGamesPlayed
                        },
                        blackPlayer: {
                            uid: blackPlayer.uid,
                            elo: blackCurrentELO,
                            gamesPlayed: blackGamesPlayed
                        },
                        winner: winner
                    });

                    console.log('🎯 ELO Changes:', {
                        red: `${redCurrentELO} → ${eloChanges.red.newRating} (${eloSystem.formatELOChange(eloChanges.red.change)})`,
                        black: `${blackCurrentELO} → ${eloChanges.black.newRating} (${eloSystem.formatELOChange(eloChanges.black.change)})`
                    });

                    // Add ELO data to game record
                    gameRecord.eloChanges = {
                        red: {
                            oldRating: eloChanges.red.oldRating,
                            newRating: eloChanges.red.newRating,
                            change: eloChanges.red.change
                        },
                        black: {
                            oldRating: eloChanges.black.oldRating,
                            newRating: eloChanges.black.newRating,
                            change: eloChanges.black.change
                        }
                    };

                    // ========== ELO PROFILE WRITES — RED PLAYER ONLY ==========
                    // Only the RED player's browser writes ELO to both profiles.
                    // Reason: Firestore rule "request.auth.uid == userId" means BLACK's browser
                    // cannot write to RED's profile/data document (permission denied).
                    // RED's browser is always authenticated as the RED-seat user and can write
                    // to its own profile (redProfileRef). BLACK's profile (blackProfileRef) uses
                    // the same rule but with userId=blackPlayer.uid — RED's browser CAN write
                    // another user's profile only if the rule allowed it. Wait — RED also cannot
                    // write BLACK's profile by the same rule!
                    //
                    // SOLUTION: Each player writes only THEIR OWN profile.
                    // RED writes redProfileRef (their own). BLACK writes blackProfileRef (their own).
                    // Both calculations still happen for gameRecord.eloChanges display data.
                    const iAmRed = this.user?.uid === redPlayer?.uid;
                    const iAmBlack = this.user?.uid === blackPlayer?.uid;

                    // Update own profile with new ELO rating
                    if (iAmRed) {
                        await setDoc(redProfileRef, {
                            elo: eloChanges.red.newRating,
                            gamesPlayed: redGamesPlayed + 1,
                            lastGameAt: gameEndTime
                        }, { merge: true });
                        console.log('✅ RED profile updated with new ELO rating');
                    } else if (iAmBlack) {
                        await setDoc(blackProfileRef, {
                            elo: eloChanges.black.newRating,
                            gamesPlayed: blackGamesPlayed + 1,
                            lastGameAt: gameEndTime
                        }, { merge: true });
                        console.log('✅ BLACK profile updated with new ELO rating');
                    } else {
                        console.log('ℹ️ Observer — skipping own profile ELO write');
                    }

                    // ========== UPDATE LEADERBOARD & PLAYER-STATS — RED PLAYER ONLY ==========
                    // These shared documents only need one writer per game. RED's browser handles it.
                    if (iAmRed) {
                        // ========== UPDATE LEADERBOARD IMMEDIATELY ==========
                        try {
                            await this.updateLeaderboardAfterGame(
                                redPlayer, blackPlayer,
                                eloChanges, winner,
                                redGamesPlayed + 1, blackGamesPlayed + 1,
                                gameEndTime
                            );
                            console.log('✅ Leaderboard updated in real-time');
                        } catch (lbError) {
                            console.warn('⚠️ Leaderboard update failed (non-critical):', lbError);
                        }

                        // ========== UPDATE PLAYER-STATS SINGLE DOCUMENT ==========
                        // One document with all players' ELO, wins, losses, draws, gamesPlayed
                        try {
                            const statsRef = doc(this.db, 'artifacts', this.appId, 'player-stats', 'current');
                            const redWinDelta = winner === 'red' ? 1 : 0;
                            const redLossDelta = winner === 'black' ? 1 : 0;
                            const redDrawDelta = winner === 'draw' ? 1 : 0;
                            const blackWinDelta = winner === 'black' ? 1 : 0;
                            const blackLossDelta = winner === 'red' ? 1 : 0;
                            const blackDrawDelta = winner === 'draw' ? 1 : 0;

                            // Read current stats, update, write back
                            const statsSnap = await getDoc(statsRef);
                            const allStats = statsSnap.exists() ? statsSnap.data() : {};

                            allStats[redPlayer.uid] = {
                                playerName: redPlayer.playerName || redPlayer.name || 'Unknown',
                                elo: eloChanges.red.newRating,
                                gamesPlayed: (redGamesPlayed || 0) + 1,
                                wins: ((allStats[redPlayer.uid]?.wins) || 0) + redWinDelta,
                                losses: ((allStats[redPlayer.uid]?.losses) || 0) + redLossDelta,
                                draws: ((allStats[redPlayer.uid]?.draws) || 0) + redDrawDelta,
                                lastGameAt: gameEndTime
                            };

                            allStats[blackPlayer.uid] = {
                                playerName: blackPlayer.playerName || blackPlayer.name || 'Unknown',
                                elo: eloChanges.black.newRating,
                                gamesPlayed: (blackGamesPlayed || 0) + 1,
                                wins: ((allStats[blackPlayer.uid]?.wins) || 0) + blackWinDelta,
                                losses: ((allStats[blackPlayer.uid]?.losses) || 0) + blackLossDelta,
                                draws: ((allStats[blackPlayer.uid]?.draws) || 0) + blackDrawDelta,
                                lastGameAt: gameEndTime
                            };

                            allStats._updatedAt = Date.now();
                            await setDoc(statsRef, allStats);
                            console.log('✅ Player-stats single document updated');
                        } catch (statsErr) {
                            console.warn('⚠️ Player-stats update failed (non-critical):', statsErr);
                        }
                    } else {
                        console.log('ℹ️ Leaderboard/player-stats writes handled by RED player browser');
                    }
                } catch (eloError) {
                    // ELO failure should NOT prevent game record from being saved
                    console.error('⚠️ ELO calculation failed, saving game record without ELO:', eloError);
                    gameRecord.eloError = eloError.message;
                }
            } else {
                console.log('ℹ️ Skipping ELO update for in-progress game save');
            }

            // Import collection and query functions
            const { collection, query, where, orderBy, limit, getDocs, deleteDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');

            // NOTE: totalMoves duplicate check removed — it falsely blocked saves when two
            // consecutive games on the same table ended with the same move count.
            // The historySaved Firestore flag (checked at the top of this function) is the
            // correct deduplication mechanism. The uniqueGameId doc ID makes setDoc idempotent.

            // ========== CENTRALIZED SAVE (source of truth) ==========
            const centralRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'all-game-history', uniqueGameId);
            await setDoc(centralRef, gameRecord);
            this[saveKey] = true; // Mark as saved only after successful write
            console.log('✅ Game saved to CENTRALIZED all-game-history collection');

            // ========== PER-PLAYER SAVE (backward compatibility) ==========
            for (const player of [redPlayer, blackPlayer]) {
                try {
                    const historyRef = doc(this.db, 'artifacts', this.appId, 'users', player.uid, 'game-history', uniqueGameId);
                    await setDoc(historyRef, gameRecord);
                    console.log(`✅ Game saved to ${player.playerName}'s personal history`);

                    // Check if player has more than 500 games (non-blocking)
                    const playerHistoryRef = collection(this.db, 'artifacts', this.appId, 'users', player.uid, 'game-history');
                    const historyQuery = query(playerHistoryRef, orderBy('completedAt', 'desc'));
                    const historySnap = await getDocs(historyQuery);

                    if (historySnap.size > 500) {
                        const gamesToDelete = historySnap.size - 500;
                        console.log(`🗑️ Purging ${gamesToDelete} oldest games for ${player.playerName}`);

                        const allGames = historySnap.docs;
                        for (let i = 500; i < allGames.length; i++) {
                            await deleteDoc(allGames[i].ref);
                        }
                        console.log(`✅ Purged ${gamesToDelete} old games`);
                    }
                } catch (perPlayerErr) {
                    console.warn(`⚠️ Per-player save failed for ${player.playerName} (non-critical):`, perPlayerErr);
                }
            }

            console.log('✅ Game history saved successfully');

            // ========== MARK GAME AS SAVED IN FIRESTORE (source of truth) ==========
            // This flag tells ALL clients "this game has been saved, don't save again"
            try {
                const gameRefMark = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
                await setDoc(gameRefMark, { historySaved: true, historySavedAt: Date.now() }, { merge: true });
                console.log('✅ historySaved flag written to game document');
            } catch (markErr) {
                console.warn('⚠️ Could not write historySaved flag:', markErr);
            }

            this.showStatus("✅ Game record saved!", "gold");
            alert('✅ Game record saved successfully!');
            this.resetRoomActivity(); // Game ended resets room inactivity timer

        } catch (error) {
            console.error('❌ Error saving game to history:', error);
            console.error('❌ Error details:', error.message, error.stack);
            // Reset save flag so retry is possible
            this[saveKey] = false;
            // Show PERSISTENT error to user so they know the save failed
            alert('⚠️ Failed to save game record!\n\nError: ' + error.message + '\n\nPlease try clicking SAVE GAME TO HISTORY button.');
        }
    }

    /**
     * Update the centralized leaderboard document immediately after a game ends.
     * Reads the current leaderboard, updates both players' entries, and writes back.
     */
    async updateLeaderboardAfterGame(redPlayer, blackPlayer, eloChanges, winner, redGamesPlayed, blackGamesPlayed, gameEndTime) {
        const leaderboardRef = doc(this.db, 'artifacts', this.appId, 'leaderboard', 'rankings');
        const leaderboardSnap = await getDoc(leaderboardRef);

        let players = [];
        if (leaderboardSnap.exists()) {
            players = leaderboardSnap.data().players || [];
        }

        // Helper to determine win/loss/draw increments for a player
        const getResultDeltas = (playerColor) => {
            if (winner === 'draw') return { wins: 0, losses: 0, draws: 1 };
            if (winner === playerColor) return { wins: 1, losses: 0, draws: 0 };
            return { wins: 0, losses: 1, draws: 0 };
        };

        const redDeltas = getResultDeltas('red');
        const blackDeltas = getResultDeltas('black');

        // Update or insert Red player
        const redIdx = players.findIndex(p => p.uid === redPlayer.uid);
        if (redIdx >= 0) {
            players[redIdx].elo = eloChanges.red.newRating;
            players[redIdx].gamesPlayed = redGamesPlayed;
            players[redIdx].wins = (players[redIdx].wins || 0) + redDeltas.wins;
            players[redIdx].losses = (players[redIdx].losses || 0) + redDeltas.losses;
            players[redIdx].draws = (players[redIdx].draws || 0) + redDeltas.draws;
            players[redIdx].lastGameAt = gameEndTime;
        } else {
            players.push({
                uid: redPlayer.uid,
                playerName: redPlayer.playerName || redPlayer.name || 'Unknown',
                elo: eloChanges.red.newRating,
                gamesPlayed: redGamesPlayed,
                wins: redDeltas.wins,
                losses: redDeltas.losses,
                draws: redDeltas.draws,
                lastGameAt: gameEndTime
            });
        }

        // Update or insert Black player
        const blackIdx = players.findIndex(p => p.uid === blackPlayer.uid);
        if (blackIdx >= 0) {
            players[blackIdx].elo = eloChanges.black.newRating;
            players[blackIdx].gamesPlayed = blackGamesPlayed;
            players[blackIdx].wins = (players[blackIdx].wins || 0) + blackDeltas.wins;
            players[blackIdx].losses = (players[blackIdx].losses || 0) + blackDeltas.losses;
            players[blackIdx].draws = (players[blackIdx].draws || 0) + blackDeltas.draws;
            players[blackIdx].lastGameAt = gameEndTime;
        } else {
            players.push({
                uid: blackPlayer.uid,
                playerName: blackPlayer.playerName || blackPlayer.name || 'Unknown',
                elo: eloChanges.black.newRating,
                gamesPlayed: blackGamesPlayed,
                wins: blackDeltas.wins,
                losses: blackDeltas.losses,
                draws: blackDeltas.draws,
                lastGameAt: gameEndTime
            });
        }

        // Sort by ELO descending
        players.sort((a, b) => b.elo - a.elo);

        // Save updated leaderboard
        await setDoc(leaderboardRef, {
            players: players,
            updatedAt: Date.now(),
            totalPlayers: players.length
        });

        console.log(`🏆 Leaderboard updated: ${players.length} players, top player: ${players[0]?.playerName}`);
    }
}