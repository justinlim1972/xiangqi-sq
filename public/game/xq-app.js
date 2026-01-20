import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, getDoc, arrayUnion, arrayRemove, deleteField, increment, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { XQEngine } from "./xq-engine.js";
import { XQUI } from "./xq-ui.js";

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
            projectId: "xiangqi-sq", 
            storageBucket: "xiangqi-sq.firebasestorage.app", 
            messagingSenderId: "351923336298", 
            appId: "1:351923336298:web:e7278ea095ba085ac4935b" 
        };
        this.fb = initializeApp(config); 
        this.auth = getAuth(this.fb); 
        this.db = getFirestore(this.fb); 
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
        this.occupants = []; // Initialize as empty array
        this.lastButtonState = null; // Track button state to prevent unnecessary recreation
        this.myPieceStyle = 'ivory'; // Default piece style
        this.myBoardStyle = 'classic'; // Default board style
        this.myEnvironmentBg = 'forest'; // Default environment background

        // Sound system - using simple tone generation for now (can replace with real sounds later)
        this.sounds = {
            pickup: this.createToneSound(800, 0.05, 0.1),    // High short beep for pickup
            place: this.createToneSound(400, 0.05, 0.15),     // Lower beep for placement
            capture: null,  // Will use TTS for "吃"
            check: null,    // Will use TTS for "将军"
            victory: null   // Will use TTS for victory announcement
        };

        // Move selection state
        this.selectedPiece = null; // {x, y}
        this.validMoves = [];

        // Add sitting lock to prevent double-clicks
        this.isSitting = false;

        // Track last move timestamp to avoid duplicate animations
        this.lastMoveTimestamp = null;
        this.hasCompletedFirstSync = false; // Track if we've completed the initial page load sync
        this.lastResignationTimestamp = null; // Track resignation timestamp to avoid duplicate animations

        // Game timer properties (15 minutes per player)
        this.timerInterval = null;
        this.redTimeLeft = 15 * 60; // 15 minutes in seconds
        this.blackTimeLeft = 15 * 60;
        this.timeIncrement = 0; // Will be loaded from region data

        // Settings (load from localStorage and remember user's preference)
        // If value is null (never set), default to ON
        // If value is 'true', setting is ON
        // If value is 'false', setting is OFF (respect user's choice)
        const musicSetting = localStorage.getItem('xq-setting-music');
        const soundSetting = localStorage.getItem('xq-setting-sound');
        const animationSetting = localStorage.getItem('xq-setting-animation');
        const autosaveSetting = localStorage.getItem('xq-setting-autosave');

        this.settings = {
            sound: soundSetting !== 'false', // default ON if null, OFF if 'false'
            animation: animationSetting !== 'false', // default ON if null, OFF if 'false'
            autosave: autosaveSetting !== 'false', // default ON if null, OFF if 'false'
            music: musicSetting !== 'false' // default ON if null, OFF if 'false'
        };

        // Debug log to track settings state
        console.log('⚙️ Settings loaded from localStorage:', {
            sound: this.settings.sound + ' (localStorage: "' + soundSetting + '")',
            animation: this.settings.animation + ' (localStorage: "' + animationSetting + '")',
            autosave: this.settings.autosave + ' (localStorage: "' + autosaveSetting + '")',
            music: this.settings.music + ' (localStorage: "' + musicSetting + '")'
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

        // Timer sync optimization - LOCAL ONLY (no Firebase sync)
        this.timerTickCount = 0; // Track seconds elapsed for optimized syncing
        this.lastMoveTime = Date.now(); // Track when last move was made for time calculation
        this.turnStartTime = Date.now(); // Track when current turn started

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

        onAuthStateChanged(this.auth, async (u) => {
            console.log('🔐 AUTH STATE CHANGED - User:', u?.uid);
            console.log('  hasJoined flag:', this.hasJoined);

            if(!u) return window.location.href = '../index.html';
            this.user = u;

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
        const secs = seconds % 60;
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    updateTimerDisplay() {
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        const redCard = document.getElementById('player-card-red');
        const blackCard = document.getElementById('player-card-black');

        if (redTimerEl) redTimerEl.innerText = this.formatTime(this.redTimeLeft);
        if (blackTimerEl) blackTimerEl.innerText = this.formatTime(this.blackTimeLeft);

        // Add stress animation when time is running low (under 1 minute = 60 seconds)
        if (redCard) {
            if (this.redTimeLeft <= 60 && this.redTimeLeft > 0) {
                redCard.classList.add('time-stress');
            } else {
                redCard.classList.remove('time-stress');
            }
        }
        if (blackCard) {
            if (this.blackTimeLeft <= 60 && this.blackTimeLeft > 0) {
                blackCard.classList.add('time-stress');
            } else {
                blackCard.classList.remove('time-stress');
            }
        }
    }

    async startTimer() {
        // Stop any existing timer
        if (this.timerInterval) {
            console.warn('⚠️ Timer already running! Clearing old interval...');
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        console.log('⏱️ Starting timer...');

        // Show timer displays
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'block';
        if (blackTimerEl) blackTimerEl.style.display = 'block';

        // Get time control from region
        let baseTime = 15; // Default 15 minutes
        let increment = 0; // Default 0 seconds increment

        try {
            const regionRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid);
            const regionSnap = await getDoc(regionRef);
            if (regionSnap.exists()) {
                const regionData = regionSnap.data();
                baseTime = regionData.baseTime || 15;
                increment = regionData.increment || 0;
                console.log(`⏱️ Using time control from region: ${baseTime}m + ${increment}s increment`);
            } else {
                console.warn('⚠️ Region not found, using default time control: 15m + 0s');
            }
        } catch (error) {
            console.error('❌ Failed to fetch region time control:', error);
        }

        // Store increment for later use
        this.timeIncrement = increment;

        // Reset timers using region's time control
        this.redTimeLeft = baseTime * 60;
        this.blackTimeLeft = baseTime * 60;
        this.updateTimerDisplay();

        // Store turn start time for local calculation
        // IMPORTANT: Use game's lastMove timestamp if available, otherwise use current time
        if (this.gameState && this.gameState.lastMove && this.gameState.lastMove.ts) {
            this.turnStartTime = this.gameState.lastMove.ts;
            console.log(`⏱️ Initialized turnStartTime from lastMove: ${this.turnStartTime}`);
        } else {
            this.turnStartTime = Date.now();
            console.log(`⏱️ Initialized turnStartTime from Date.now(): ${this.turnStartTime}`);
        }

        // NO Firebase timer sync - timers are purely local now

        console.log(`⏱️ Starting LOCAL timer for ALL clients (no Firebase sync).`);

        // Reset tick counter when starting new timer
        this.timerTickCount = 0;

        // LOCAL TIMER: Runs on ALL clients independently (no Firebase sync!)
        this.timerInterval = setInterval(() => {
            if (!this.gameState || this.gameState.status !== 'playing') {
                this.stopTimer();
                return;
            }

            // Decrement the timer for whoever's turn it is
            if (this.gameState.turn === 'red') {
                this.redTimeLeft--;
                if (this.redTimeLeft <= 0) {
                    this.redTimeLeft = 0;
                    this.handleTimeout('red');
                    return;
                }
            } else {
                this.blackTimeLeft--;
                if (this.blackTimeLeft <= 0) {
                    this.blackTimeLeft = 0;
                    this.handleTimeout('black');
                    return;
                }
            }

            this.updateTimerDisplay();

            console.log(`⏱️ LOCAL timer tick: Red=${this.redTimeLeft}s, Black=${this.blackTimeLeft}s, Turn=${this.gameState.turn}`);
        }, 1000);
    }

    startTimerInterval() {
        // Start ONLY the interval, without initialization
        // This is called when turn changes
        console.log('⏱️ Starting LOCAL timer interval (no Firebase sync)...');

        // Stop any existing interval first
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Reset tick counter
        this.timerTickCount = 0;

        // LOCAL TIMER: Runs on ALL clients independently (no Firebase sync!)
        this.timerInterval = setInterval(() => {
            if (!this.gameState || this.gameState.status !== 'playing') {
                this.stopTimer();
                return;
            }

            // Decrement the timer for whoever's turn it is
            if (this.gameState.turn === 'red') {
                this.redTimeLeft--;
                if (this.redTimeLeft <= 0) {
                    this.redTimeLeft = 0;
                    this.handleTimeout('red');
                    return;
                }
            } else {
                this.blackTimeLeft--;
                if (this.blackTimeLeft <= 0) {
                    this.blackTimeLeft = 0;
                    this.handleTimeout('black');
                    return;
                }
            }

            this.updateTimerDisplay();

            console.log(`⏱️ LOCAL timer tick: Red=${this.redTimeLeft}s, Black=${this.blackTimeLeft}s, Turn=${this.gameState.turn}`);
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Reset tick counter
        this.timerTickCount = 0;

        // Hide timer displays
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'none';
        if (blackTimerEl) blackTimerEl.style.display = 'none';

        // Remove stress animation when game ends
        const redCard = document.getElementById('player-card-red');
        const blackCard = document.getElementById('player-card-black');
        if (redCard) redCard.classList.remove('time-stress');
        if (blackCard) blackCard.classList.remove('time-stress');
    }

    async handleTimeout(color) {
        this.stopTimer();
        const winner = color === 'red' ? 'black' : 'red';

        // Show timeout animation and sound
        this.showMoveAnimation('timeout', { winner: winner, loser: color });

        // Clear matchActive flag in table
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            matchActive: deleteField()
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

        this.showStatus(`${color.toUpperCase()} ran out of time!`, "red");
    }

    syncTable() {
        const tableRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        onSnapshot(tableRef, snap => {
            if(!snap.exists()) return;
            this.table = snap.data();

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
                    btnEngage.style.display = 'none';
                }
            }

            // Update in-game controls
            console.log('📞 Calling updateInGameControls from syncTable()');
            this.updateInGameControls();

            this.hideLoader();
        });
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

        if (gameIsPlaying && iAmSeated) {
            // Game is active - hide UNSEAT, show RESIGN and OFFER DRAW
            console.log('✅ Showing RESIGN and OFFER DRAW buttons');
            if (btnUnseat) btnUnseat.style.display = 'none';
            if (btnResign) btnResign.style.display = 'block';
            if (btnDraw) btnDraw.style.display = 'block';

            // Also ensure timers are visible during active game
            const redTimerEl = document.getElementById('red-timer');
            const blackTimerEl = document.getElementById('black-timer');
            if (redTimerEl) redTimerEl.style.display = 'block';
            if (blackTimerEl) blackTimerEl.style.display = 'block';
        } else {
            // Game not active - show UNSEAT (if seated), hide RESIGN and OFFER DRAW
            console.log('❌ Hiding RESIGN and OFFER DRAW buttons');
            if (btnResign) btnResign.style.display = 'none';
            if (btnDraw) btnDraw.style.display = 'none';
            // btnUnseat visibility is already controlled by updateSeatingButtons

            // Hide timers when game is not active
            const redTimerEl = document.getElementById('red-timer');
            const blackTimerEl = document.getElementById('black-timer');
            if (redTimerEl) redTimerEl.style.display = 'none';
            if (blackTimerEl) blackTimerEl.style.display = 'none';
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
                <div class="presence-item ${styleClass}">
                    <strong>${p.name}</strong>
                    <em>${roleText} • ELO: ${elo} • 🪙 ${coins}</em>
                </div>
            `;
        }).join('');

        console.log('✅ Setting HTML content, length:', htmlContent.length);
        listContainer.innerHTML = htmlContent;
        console.log('✅ Presence list updated successfully');
    }

    syncGame() {
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        onSnapshot(gameRef, snap => {
            const g = snap.data() || {};
            this.gameState = g;

            console.log('🎮 Game state updated:', {
                status: g.status,
                hasBoard: !!g.board,
                boardType: typeof g.board,
                timestamp: Date.now()
            });

            // Detect battle start: Show splash screen for EVERYONE when game status changes to 'playing'
            // IMPORTANT: Only show if previous status was explicitly NOT 'playing' (avoid showing on page load)
            const battleJustStarted = g.status === 'playing' && this.previousGameStatus !== null && this.previousGameStatus !== 'playing';
            if (battleJustStarted) {
                console.log('⚔️ Battle just started! Showing splash for everyone...');
                this.showBattleSplash();
                // Timer will start automatically after splash ends (in showBattleSplash)
            }

            // Update previous status for next comparison (set to null on first load if no previous status)
            if (this.previousGameStatus === null) {
                this.previousGameStatus = g.status; // Initialize without triggering splash
            } else {
                this.previousGameStatus = g.status;
            }

            // LOCAL TIMER SYNC: Use move timestamps to synchronize time
            // When a move happens, calculate time used by previous player
            const turnChanged = this.previousTurn !== null && this.previousTurn !== g.turn;

            if (turnChanged && g.lastMove && g.lastMove.ts) {
                console.log(`🔄 Turn changed from ${this.previousTurn} to ${g.turn}`);

                // FETCH INCREMENT FROM FIRESTORE DIRECTLY
                getDoc(doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid)).then(regionSnap => {
                    const regionData = regionSnap.data();
                    const increment = regionData?.increment || 0;
                    console.log(`⏱️ FETCHED increment from Firestore: ${increment}`);

                    // Calculate time used by previous player based on move timestamp
                    const moveTimestamp = g.lastMove.ts;
                    const timeElapsed = Math.floor((moveTimestamp - this.turnStartTime) / 1000);

                    console.log(`⏱️ Time calculation: Previous turn took ${timeElapsed}s (from ${this.turnStartTime} to ${moveTimestamp})`);

                    // Deduct time from the player who just moved
                    const previousPlayer = this.previousTurn;
                    if (previousPlayer === 'red') {
                        this.redTimeLeft = Math.max(0, this.redTimeLeft - timeElapsed);
                        console.log(`⏱️ Adjusted RED time: ${this.redTimeLeft}s (deducted ${timeElapsed}s)`);
                    } else if (previousPlayer === 'black') {
                        this.blackTimeLeft = Math.max(0, this.blackTimeLeft - timeElapsed);
                        console.log(`⏱️ Adjusted BLACK time: ${this.blackTimeLeft}s (deducted ${timeElapsed}s)`);
                    }

                    // Add time increment if configured
                    console.log(`🔍 DEBUG: increment = ${increment}, type = ${typeof increment}`);
                    if (increment && increment > 0) {
                        if (previousPlayer === 'red') {
                            this.redTimeLeft += increment;
                            console.log(`⏱️ Added ${increment}s increment to RED: ${this.redTimeLeft}s`);
                        } else if (previousPlayer === 'black') {
                            this.blackTimeLeft += increment;
                            console.log(`⏱️ Added ${increment}s increment to BLACK: ${this.blackTimeLeft}s`);
                        }
                    } else {
                        console.log(`⚠️ INCREMENT SKIPPED: increment = ${increment}`);
                    }

                    // Update turn start time for next calculation
                    this.turnStartTime = moveTimestamp;

                    // Update display
                    this.updateTimerDisplay();

                    // Ensure timer is running
                    if (!this.timerInterval) {
                        this.startTimerInterval();
                    }
                });
            }

            this.previousTurn = g.turn;

            // Update timer display and stress animation
            if (g.status === 'playing') {
                this.updateTimerDisplay();
            }

            // Update button visibility when game state changes
            console.log('📞 Calling updateInGameControls from syncGame()');
            this.updateInGameControls();

            // Update chat
            const log = document.getElementById('chat-log');
            if(log && g.chat) {
                log.innerHTML = g.chat.slice(-50).map(m =>
                    `<div class="chat-msg"><strong>${m.user}:</strong> ${m.text}</div>`
                ).join('');
                log.scrollTop = log.scrollHeight;
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

                    // Show animation for all clients (including the one who made the move)
                    setTimeout(() => {
                        // Check game status for special endings
                        if (g.status === 'draw') {
                            console.log('🔁 Showing 3-fold repetition draw animation');
                            this.showMoveAnimation('draw');
                        } else if (g.status === 'finished' && g.reason === 'resignation' && g.winner) {
                            console.log('🏳️ Showing resignation animation for winner:', g.winner);
                            this.showMoveAnimation('resignation', {winner: g.winner});
                        } else if (g.status === 'perpetual-check') {
                            console.log('♾️ Showing perpetual check animation, winner:', g.winner);
                            this.showMoveAnimation('perpetual-check', {winner: g.winner});
                        } else if (g.status === 'perpetual-chase') {
                            console.log('♾️ Showing perpetual chase animation, winner:', g.winner);
                            this.showMoveAnimation('perpetual-chase', {winner: g.winner});
                        } else if (g.lastMove && g.lastMove.isCheckmate) {
                            console.log('🏆 Showing checkmate animation for winner:', g.winner);
                            this.showMoveAnimation('checkmate', {winner: g.winner});
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
            }

            // Check for game-ending statuses that don't involve a move (like resignation)
            if (g.status === 'finished' && g.reason === 'resignation' && g.winner) {
                // Use finishedAt timestamp to track if we've already shown this resignation
                const resignationTimestamp = g.finishedAt || Date.now();

                if (resignationTimestamp !== this.lastResignationTimestamp) {
                    console.log('🏳️ Detected NEW resignation - showing animation for winner:', g.winner);
                    console.log('   Resignation timestamp:', resignationTimestamp);
                    console.log('   Last shown resignation:', this.lastResignationTimestamp);

                    this.lastResignationTimestamp = resignationTimestamp;
                    setTimeout(() => {
                        this.showMoveAnimation('resignation', {winner: g.winner});
                    }, 200);
                } else {
                    console.log('⏭️ Skipping resignation animation - already shown for this game ending');
                }
            }

            // Render pieces if game is active
            if (g.status === 'playing' && g.board) {
                console.log('♟️ Attempting to render pieces...');

                // Start timer if not already started (but not during battle start splash)
                // Timer will be started automatically after splash ends
                if (!this.timerInterval && !battleJustStarted) {
                    this.startTimer();
                }

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

                this.ui.renderPieces(displayBoard, this.engine.labels, (x, y) => this.handlePieceClick(x, y), this.myPieceStyle);
            } else {
                console.log('⏸️ Game not active, clearing board');
                const layer = document.getElementById('pieces-layer');
                if (layer) layer.innerHTML = "";
                const hintsLayer = document.getElementById('hints-layer');
                if (hintsLayer) hintsLayer.innerHTML = "";

                // Stop timer when game is not active
                this.stopTimer();

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
            console.log('✅ Showing BOOT option for:', opponentName);
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
            if (isRed) updates.playerRed = deleteField();
            if (isBlack) updates.playerBlack = deleteField();

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

            await setDoc(tRef, updates, { merge: true });
            
            console.log('✅ Successfully saved to Firestore!');
            this.showStatus(`You are now seated as ${side.toUpperCase()}`, "gold");
            
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
                    ts: Date.now()
                }) 
            }, { merge: true });
            el.value = "";
        } catch (e) { 
            console.error("Chat Error:", e);
            this.showStatus("Chat Failed", "red");
        }
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
        }
        
        await setDoc(tRef, updates, { merge: true });
        console.log('✅ Left room successfully');
        this.hasJoined = false;

        // Stop music when I leave (will be stopped by occupants change too, but this is immediate)
        this.stopAmbientMusic();
    }

    async handleExit() {
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
            battleRequest: battleRequestData
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

    showBattleSplash() {
        console.log('🎬 Showing battle splash screen...');

        const splash = document.getElementById('battle-splash');
        if (!splash) return;

        // Show splash screen
        splash.classList.add('active');

        // Play Chinese voice using Web Speech API with intense tone
        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance('即分高下，也决生死！');
            utterance.lang = 'zh-CN'; // Chinese (Simplified)
            utterance.rate = 0.9; // Slightly slower for dramatic effect
            utterance.pitch = 0.8; // Lower pitch for intensity
            utterance.volume = 1.0; // Maximum volume

            // Try to find a male Chinese voice
            const voices = window.speechSynthesis.getVoices();
            const chineseVoice = voices.find(voice =>
                voice.lang.startsWith('zh') && voice.name.toLowerCase().includes('male')
            ) || voices.find(voice => voice.lang.startsWith('zh'));

            if (chineseVoice) {
                utterance.voice = chineseVoice;
                console.log('🎤 Using voice:', chineseVoice.name);
            }

            window.speechSynthesis.speak(utterance);
        }

        // Hide splash after 5 seconds
        setTimeout(() => {
            splash.classList.remove('active');
            console.log('🎬 Battle splash hidden');

            // Start timer after splash ends
            if (!this.timerInterval && this.gameState?.status === 'playing') {
                console.log('⏱️ Starting timer after splash screen...');
                this.startTimer();
            }
        }, 5000);
    }

    async engageBattle() {
        console.log('⚔️ Engaging battle...');

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
            await setDoc(gameRef, {
                board: flatBoard,
                status: 'playing',
                turn: 'red',
                history: [],
                moveHistory: [], // Clear move history for repetition detection
                chat: arrayUnion({
                    user: 'SYSTEM',
                    text: '⚔️ Battle has begun! Red moves first.',
                    ts: Date.now()
                })
            }, { merge: true });

            console.log('✅ Game state saved to Firestore');

            await setDoc(doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid), {
                matchActive: true
            }, { merge: true });

            console.log('✅ Match marked as active');
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

        // If clicking own piece - select it
        if (piece) {
            const isRed = piece === piece.toUpperCase();
            const pieceColor = isRed ? 'red' : 'black';

            if (pieceColor === myColor) {
                this.selectPiece(actualX, actualY);
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
    }

    async executeMove(toX, toY) {
        if (!this.selectedPiece) return;

        // These are already actual board coordinates
        const fromX = this.selectedPiece.x;
        const fromY = this.selectedPiece.y;

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
            // NOTE: Don't show animation here - Firebase sync will trigger it for ALL clients
        } else if (isRepetition) {
            newStatus = 'draw';
            winner = null;
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

        const updateData = {
            board: flatBoard,
            turn: nextTurn,
            lastMove: moveData,
            history: arrayUnion(moveData),
            moveHistory: arrayUnion(moveRecord) // Track board positions for repetition detection
        };

        if (newStatus !== 'playing') {
            updateData.status = newStatus;
            if (winner) updateData.winner = winner;
        }

        // NO TIMER SYNC - timers are purely local now
        // Time increments are handled locally via move timestamps

        await setDoc(gameRef, updateData, { merge: true });

        // Clear selection
        this.selectedPiece = null;
        this.validMoves = [];
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) hintsLayer.innerHTML = "";
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

        // Clear matchActive flag in table
        const tRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'regions', this.rid, 'tables', this.tid);
        await setDoc(tRef, {
            matchActive: deleteField()
        }, { merge: true });

        // Update game status
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        const resignationTime = Date.now();
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

        // Only show if I'm receiving the offer (not the one who sent it)
        const iAmReceiver = drawOffer && drawOffer.from !== this.user?.uid;

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

        // Only show if I'm receiving the request (not the one who sent it)
        const iAmReceiver = battleRequest && battleRequest.from !== this.user?.uid;

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
                // Auto-reject
                this.rejectBattleRequest();
                clearInterval(this.battleRequestCountdownTimer);
                this.battleRequestCountdownTimer = null;
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

        // Using a simple approach - you already have TTS in victory_clip.html
        // For now, let's use the browser's built-in speech synthesis as a fallback
        try {
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

        // Show game-over image even if animations are disabled (for all game-ending results)
        if ((type === 'checkmate' || type === 'perpetual-check' || type === 'perpetual-chase' || type === 'resignation' || type === 'timeout') && data.winner) {
            this.showGameOverImage(data.winner);
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
     * Format move to algebraic notation (e.g., C25, H8+7, R9-1)
     * Format: [Piece][SourceFile][Direction][Steps/TargetFile]
     * - Lateral: C25 = Cannon from file 2 to file 5
     * - Forward: H8+7 = Horse at file 8 moves forward 7 steps
     * - Backward: R9-1 = Rook at file 9 moves backward 1 step
     *
     * IMPORTANT: File numbering in Xiangqi is right-to-left from each player's perspective
     * - Red: file 1 is on the right (x=8), file 9 is on the left (x=0)
     * - Black: file 1 is on the right (x=0), file 9 is on the left (x=8)
     */
    formatMoveNotation(move) {
        if (!move || !move.from || !move.to) return '???';

        const fx = move.from.x;
        const fy = move.from.y;
        const tx = move.to.x;
        const ty = move.to.y;

        // Get piece letter from the move data
        let pieceLetter = '';
        let isRed = true; // Default to red if we can't determine

        if (move.piece) {
            const pieceMap = {
                'r': 'R', 'n': 'H', 'e': 'E', 'a': 'A', 'k': 'K', 'c': 'C', 'p': 'P',
                'R': 'R', 'N': 'H', 'E': 'E', 'A': 'A', 'K': 'K', 'C': 'C', 'P': 'P'
            };
            pieceLetter = pieceMap[move.piece] || '';
            // Determine if piece is red or black from the piece character
            isRed = move.piece === move.piece.toUpperCase();
        } else {
            // Old move without piece data - infer from starting position
            // Red starts from bottom (y >= 7), Black starts from top (y <= 2)
            // For moves in between, we need to guess from the move pattern
            if (fy >= 7) {
                isRed = true;
            } else if (fy <= 2) {
                isRed = false;
            } else {
                // For middle positions, check if moving forward (toward opponent)
                // Red moves up (y decreases), Black moves down (y increases)
                isRed = ty < fy; // If y decreased, likely Red moving forward
            }
        }

        // Convert coordinates to file numbers (1-9)
        // Red counts right-to-left: x=8 is file 1, x=0 is file 9
        // Black counts right-to-left from their side: x=0 is file 1, x=8 is file 9
        let sourceFile, targetFile;
        if (isRed) {
            sourceFile = 9 - fx; // x=8 -> file 1, x=0 -> file 9
            targetFile = 9 - tx;
        } else {
            sourceFile = fx + 1; // x=0 -> file 1, x=8 -> file 9
            targetFile = tx + 1;
        }

        let notation = '';

        // Determine direction based on color
        // Red moves from bottom to top (y decreases)
        // Black moves from top to bottom (y increases)

        // For Horse (H), Elephant (E), Advisor (A): always show target file with +/-
        // For Rook (R), Cannon (C): show steps for vertical, target file for lateral
        // For Pawn (P): show steps for vertical (never -), target file for lateral
        const piecesWithTargetFile = ['H', 'E', 'A'];
        const usesTargetFile = piecesWithTargetFile.includes(pieceLetter);

        // Check for vertical movement first (takes priority)
        if (ty !== fy) {
            // Has vertical component
            if (isRed) {
                if (ty < fy) {
                    // Forward (toward black side, y decreases)
                    const suffix = usesTargetFile ? targetFile : Math.abs(ty - fy);
                    notation = `${pieceLetter}${sourceFile}+${suffix}`;
                } else {
                    // Backward (toward own side, y increases)
                    const suffix = usesTargetFile ? targetFile : Math.abs(ty - fy);
                    notation = `${pieceLetter}${sourceFile}-${suffix}`;
                }
            } else {
                // Black
                if (ty > fy) {
                    // Forward (toward red side, y increases)
                    const suffix = usesTargetFile ? targetFile : Math.abs(ty - fy);
                    notation = `${pieceLetter}${sourceFile}+${suffix}`;
                } else {
                    // Backward (toward own side, y decreases)
                    const suffix = usesTargetFile ? targetFile : Math.abs(ty - fy);
                    notation = `${pieceLetter}${sourceFile}-${suffix}`;
                }
            }
        } else if (tx !== fx) {
            // Pure lateral move (no vertical component)
            notation = `${pieceLetter}${sourceFile}${targetFile}`;
        } else {
            // No movement? Should not happen
            notation = `${pieceLetter}${sourceFile}`;
        }

        return notation;
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
        ['sound', 'animation', 'music', 'autosave'].forEach(settingName => {
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
}