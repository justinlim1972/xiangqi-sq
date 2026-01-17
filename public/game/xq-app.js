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
        this.occupants = []; // Initialize as empty array
        this.lastButtonState = null; // Track button state to prevent unnecessary recreation
        this.myPieceStyle = 'ivory'; // Default piece style
        this.myBoardStyle = 'classic'; // Default board style
        this.myEnvironmentBg = 'forest'; // Default environment background

        // Move selection state
        this.selectedPiece = null; // {x, y}
        this.validMoves = [];

        // Add sitting lock to prevent double-clicks
        this.isSitting = false;

        // Game timer properties (15 minutes per player)
        this.timerInterval = null;
        this.redTimeLeft = 15 * 60; // 15 minutes in seconds
        this.blackTimeLeft = 15 * 60;

        this.hasJoined = false;
        window.addEventListener('beforeunload', () => this.leaveRoom());
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
                    console.log('🎨 Loaded piece style:', this.myPieceStyle);
                }

                // Load player's preferred board style
                if (this.profile && this.profile.boardSet) {
                    this.myBoardStyle = this.profile.boardSet;
                    console.log('🎨 Loaded board style:', this.myBoardStyle);
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
            mahogany: { bg: '#2a1817', lineColor: '#facc15', borderColor: '#1a0f0e' }
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

        if (redTimerEl) redTimerEl.innerText = this.formatTime(this.redTimeLeft);
        if (blackTimerEl) blackTimerEl.innerText = this.formatTime(this.blackTimeLeft);
    }

    startTimer() {
        // Stop any existing timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        // Show timer displays
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'block';
        if (blackTimerEl) blackTimerEl.style.display = 'block';

        // Reset timers to 15 minutes
        this.redTimeLeft = 15 * 60;
        this.blackTimeLeft = 15 * 60;
        this.updateTimerDisplay();

        // Start countdown
        this.timerInterval = setInterval(() => {
            if (!this.gameState || this.gameState.status !== 'playing') {
                this.stopTimer();
                return;
            }

            // Decrement the current player's timer
            if (this.gameState.turn === 'red') {
                this.redTimeLeft--;
                if (this.redTimeLeft <= 0) {
                    this.redTimeLeft = 0;
                    this.handleTimeout('red');
                }
            } else {
                this.blackTimeLeft--;
                if (this.blackTimeLeft <= 0) {
                    this.blackTimeLeft = 0;
                    this.handleTimeout('black');
                }
            }

            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Hide timer displays
        const redTimerEl = document.getElementById('red-timer');
        const blackTimerEl = document.getElementById('black-timer');
        if (redTimerEl) redTimerEl.style.display = 'none';
        if (blackTimerEl) blackTimerEl.style.display = 'none';
    }

    async handleTimeout(color) {
        this.stopTimer();
        const winner = color === 'red' ? 'black' : 'red';

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

            // Update player displays
            document.getElementById('name-red').innerText = this.table.playerRed?.name || 'Empty Slot';
            document.getElementById('name-black').innerText = this.table.playerBlack?.name || 'Empty Slot';

            const redImg = document.getElementById('avatar-red');
            const blackImg = document.getElementById('avatar-black');
            if (redImg) redImg.src = this.table.playerRed?.avatar || '/lobby/1.JPG';
            if (blackImg) blackImg.src = this.table.playerBlack?.avatar || '/lobby/1.JPG';

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

            // Render pieces if game is active
            if (g.status === 'playing' && g.board) {
                console.log('♟️ Attempting to render pieces...');

                // Start timer if not already started
                if (!this.timerInterval) {
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
        const bothSeated = this.table?.playerRed && this.table?.playerBlack;
        const battleRequested = this.table?.battleRequest;
        const gameActive = this.gameState?.status === 'playing';

        // Observer clicking empty slot
        if (!iAmSeated && !isOccupied) {
            actions.push({ label: '🪑 SIT HERE', action: () => this.sit(side), color: '#3498db' });
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
            
            await setDoc(tRef, updates, { merge: true });
            console.log('✅ Unseated successfully');
            this.showStatus("You've left your seat", "gold");
        } catch (error) {
            console.error('❌ Unseat error:', error);
            this.showStatus("Failed to unseat: " + error.message, "red");
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

            await setDoc(tRef, { 
                [seatKey]: { 
                    uid: this.user.uid, 
                    name: myName, 
                    avatar: myAvatar 
                } 
            }, { merge: true });
            
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
                turn: 'red'
            }, { merge: true });
            updates.matchActive = false;
        }
        
        await setDoc(tRef, updates, { merge: true });
        console.log('✅ Left room successfully');
        this.hasJoined = false;
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

    async engageBattle() {
        console.log('⚔️ Engaging battle...');

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

        // Update board
        const newBoard = this.gameState.board.map(row => [...row]);
        newBoard[toY][toX] = newBoard[fromY][fromX];
        newBoard[fromY][fromX] = null;

        // Switch turn
        const nextTurn = this.gameState.turn === 'red' ? 'black' : 'red';

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

        // Save to Firebase
        const gameRef = doc(this.db, 'artifacts', this.appId, 'public', 'data', 'games', this.tid);
        await setDoc(gameRef, {
            board: flatBoard,
            turn: nextTurn,
            history: arrayUnion({
                from: {x: fromX, y: fromY},
                to: {x: toX, y: toY},
                ts: Date.now()
            })
        }, { merge: true });
        
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
        await setDoc(gameRef, {
            status: 'finished',
            winner: winner,
            reason: 'resignation',
            chat: arrayUnion({
                user: 'SYSTEM',
                text: `🏳️ ${myName} (${myColor.toUpperCase()}) has resigned. ${winner.toUpperCase()} wins!`,
                ts: Date.now()
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
}