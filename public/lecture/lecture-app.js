import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, updateDoc, getDoc, setDoc, arrayUnion, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { XQUI } from '../game/xq-ui.js';
import { XQEngine } from '../game/xq-engine.js';

const firebaseConfig = {
    apiKey: "AIzaSyDq_LECOrc4SY90SyDsBQGmwl-YnUNFIj8",
    authDomain: "xiangqi-sq.firebaseapp.com",
    projectId: "xiangqi-sq",
    storageBucket: "xiangqi-sq.firebasestorage.app",
    messagingSenderId: "351923336298",
    appId: "1:351923336298:web:e7278ea095ba085ac4935b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "sg-xiangqi";

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const tableId = params.get('id');
const regionId = params.get('rid');

if (!tableId || !regionId) {
    alert('Invalid lecture link');
    window.location.href = '/lobby/lobby.html';
}

class LectureApp {
    constructor() {
        this.user = null;
        this.isLecturer = false;
        this.selectedPiece = null;
        this.validMoves = [];
        this.ui = new XQUI();
        this.engine = new XQEngine();
        this.board = this.engine.init();

        this.regionData = null;
        this.tableData = null;

        this.passwordVerified = false;

        // User preferences
        this.pieceStyle = 'ivory';
        this.boardColor = '#5d2e0c';

        // Move history
        this.moveHistory = [];
        this.currentStep = -1;
    }

    async init() {
        // Wait for auth
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = '/index.html';
                return;
            }

            this.user = user;

            // Get user profile and preferences
            const profileSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'));
            if (profileSnap.exists()) {
                const profile = profileSnap.data();
                document.getElementById('user-name').textContent = profile.playerName || user.email;

                // Load preferences
                this.pieceStyle = profile.pieceStyle || 'ivory';
                this.boardColor = profile.boardColor || '#5d2e0c';
            }

            // Show password modal
            this.showPasswordModal();
        });
    }

    showPasswordModal() {
        document.getElementById('password-modal').style.display = 'flex';
    }

    async verifyPassword(inputPassword) {
        // Get region data to check password
        const regionSnap = await getDoc(doc(db, "artifacts", appId, "public", "data", "regions", regionId));

        if (!regionSnap.exists()) {
            alert('Region not found');
            return false;
        }

        this.regionData = regionSnap.data();

        if (!inputPassword || inputPassword === '') {
            // Join as student
            this.isLecturer = false;
            return true;
        }

        // Check password (simple base64 comparison)
        const expectedHash = this.regionData.passwordHash;
        const inputHash = btoa(inputPassword);

        if (inputHash === expectedHash) {
            this.isLecturer = true;
            return true;
        } else {
            alert('Incorrect password. Joining as student.');
            this.isLecturer = false;
            return true; // Still allow to join as student
        }
    }

    async joinAsLecturer() {
        // Update table with lecturer info
        await updateDoc(doc(db, "artifacts", appId, "public", "data", "regions", regionId, "tables", tableId), {
            lecturer: {
                uid: this.user.uid,
                name: document.getElementById('user-name').textContent,
                avatar: '/lobby/1.JPG'
            }
        });

        // Show lecturer controls
        document.getElementById('lecturer-controls').style.display = 'block';
        document.getElementById('role-badge').textContent = 'Lecturer';
        document.getElementById('role-badge').className = 'role-badge lecturer';
    }

    async joinAsStudent() {
        try {
            // Increment student count
            const tableRef = doc(db, "artifacts", appId, "public", "data", "regions", regionId, "tables", tableId);
            const tableSnap = await getDoc(tableRef);

            if (tableSnap.exists()) {
                const currentCount = tableSnap.data().students || 0;
                await updateDoc(tableRef, {
                    students: currentCount + 1
                });
            }
        } catch (error) {
            console.error('Error joining as student:', error);
        }
    }

    async startLecture() {
        document.getElementById('password-modal').style.display = 'none';

        // Join as lecturer or student
        if (this.isLecturer) {
            await this.joinAsLecturer();
        } else {
            await this.joinAsStudent();
        }

        // Initialize board with user preferences
        this.ui.drawGrid('board-grid', this.boardColor);
        this.renderBoard();

        // Add click handler to board grid for empty squares (lecturer only)
        if (this.isLecturer) {
            this.setupBoardClickHandler();
        }

        // Listen to table data
        this.listenToTable();

        // Listen to game state (for board updates)
        this.listenToGameState();
    }

    setupBoardClickHandler() {
        const grid = document.getElementById('board-grid');
        if (!grid) return;

        grid.style.cursor = 'pointer';
        grid.addEventListener('click', (e) => {
            // Only handle clicks on the SVG grid, not on pieces
            if (e.target.tagName === 'svg' || e.target.tagName === 'line' || e.target.tagName === 'text') {
                // Get click position relative to the wrapper
                const wrapper = document.getElementById('chess-board-wrapper');
                const rect = wrapper.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;

                // Convert to board coordinates (0-8 for x, 0-9 for y)
                // The grid has 10% padding on all sides
                const x = Math.round((clickX / rect.width - 0.1) / 0.8 * 8);
                const y = Math.round((clickY / rect.height - 0.1) / 0.8 * 9);

                // Check if coordinates are valid
                if (x >= 0 && x <= 8 && y >= 0 && y <= 9) {
                    this.handleLecturerClick(x, y);
                }
            }
        });
    }

    listenToTable() {
        const tableRef = doc(db, "artifacts", appId, "public", "data", "regions", regionId, "tables", tableId);

        onSnapshot(tableRef, (snap) => {
            if (!snap.exists()) return;

            this.tableData = snap.data();

            // Update title
            document.getElementById('table-title').textContent = `🎓 ${this.tableData.tableName || 'Lecture Hall'}`;

            // Update announcement
            if (this.tableData.announcement) {
                document.getElementById('announcement-container').innerHTML = `
                    <div class="announcement-banner">
                        <h4>📢 Announcement</h4>
                        <p>${this.tableData.announcement}</p>
                    </div>
                `;
            }

            // Update student count
            document.getElementById('student-count').textContent = this.tableData.students || 0;

            // Update students list
            this.updateStudentsList();
        });
    }

    listenToGameState() {
        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);

        onSnapshot(gameRef, (snap) => {
            if (!snap.exists()) {
                // Initialize game if doesn't exist
                this.initializeGame();
                return;
            }

            const gameData = snap.data();

            // Update board from Firestore
            if (gameData.board) {
                console.log('📥 Received board from Firestore, type:', Array.isArray(gameData.board) ? 'array' : typeof gameData.board, 'length:', gameData.board.length);

                // Check if it's already a 2D array (old format) or flat array (new format)
                if (gameData.board.length === 90) {
                    // It's a flat array - unflatten it
                    console.log('🔧 Unflattening board from flat format');
                    const flatBoard = gameData.board;
                    this.board = [];
                    for (let i = 0; i < 10; i++) {
                        this.board.push(flatBoard.slice(i * 9, (i + 1) * 9));
                    }
                } else if (gameData.board.length === 10 && Array.isArray(gameData.board[0])) {
                    // It's already a 2D array (old format) - use directly but log warning
                    console.warn('⚠️ Board is in old 2D format - this should not happen!');
                    this.board = gameData.board;
                } else {
                    console.error('❌ Invalid board format!', gameData.board);
                    return;
                }

                console.log('✅ Board ready, rendering...');
                this.renderBoard();
            }

            // Update chat
            if (gameData.chat) {
                this.updateChat(gameData.chat);
            }
        });
    }

    async initializeGame() {
        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);
        // Flatten the board for Firestore
        const flatBoard = this.board.flat();

        console.log('🔧 Initializing game with flat board, length:', flatBoard.length);

        // IMPORTANT: Use setDoc WITHOUT merge to completely replace the document
        // This ensures we don't have any old nested array data lingering
        await setDoc(gameRef, {
            board: flatBoard,
            turn: 'red',
            history: [],
            status: 'lecture',
            chat: [],
            lastMoveTime: serverTimestamp()
        }).catch((error) => {
            console.error('Error initializing game:', error);
        });
    }

    updateStudentsList() {
        const listEl = document.getElementById('students-list');

        if (!this.tableData.students || this.tableData.students === 0) {
            listEl.innerHTML = '<p style="color: #94a3b8; text-align: center; font-size: 0.75rem;">No students yet</p>';
            return;
        }

        // For now, just show count (in future, we'll track individual students)
        listEl.innerHTML = `<p style="color: #64748b; font-size: 0.8rem; text-align: center;">${this.tableData.students} student${this.tableData.students > 1 ? 's' : ''} watching</p>`;
    }

    updateChat(messages) {
        const chatEl = document.getElementById('chat-messages');
        chatEl.innerHTML = '';

        messages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message';
            msgDiv.innerHTML = `<span class="sender">${msg.sender}:</span> ${msg.text}`;
            chatEl.appendChild(msgDiv);
        });

        // Scroll to bottom
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    renderBoard() {
        this.ui.renderPieces(this.board, this.engine.labels, (x, y) => {
            if (this.isLecturer) {
                this.handleLecturerClick(x, y);
            }
        }, this.pieceStyle);
    }

    handleLecturerClick(x, y) {
        const piece = this.board[y][x];

        // If clicking a piece, select it
        if (piece) {
            this.selectPiece(x, y);
        }
    }

    selectPiece(x, y) {
        this.selectedPiece = { x, y };

        // Get valid moves
        this.validMoves = this.engine.getValidMoves(this.board, x, y);

        // Render move hints
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) {
            hintsLayer.innerHTML = this.validMoves.map(move => {
                const hintX = 10 + move.x * 10;
                const hintY = ((10 + move.y * 10) / 110) * 100;
                return `<div class="move-hint" style="left:${hintX}%; top:${hintY}%;" onclick="app_instance.executeMove(${move.x}, ${move.y})"></div>`;
            }).join('');
        }

        // Re-render board to show selection
        this.renderBoard();
    }

    async executeMove(toX, toY) {
        if (!this.selectedPiece) return;

        const fromX = this.selectedPiece.x;
        const fromY = this.selectedPiece.y;

        // Execute move on local board
        const capturedPiece = this.board[toY][toX];
        this.board[toY][toX] = this.board[fromY][fromX];
        this.board[fromY][fromX] = null;

        // Add to move history
        const move = {
            from: [fromX, fromY],
            to: [toX, toY],
            piece: this.board[toY][toX],
            captured: capturedPiece,
            boardState: this.board.map(row => [...row])
        };

        // If we're not at the end of history, truncate future moves
        if (this.currentStep < this.moveHistory.length - 1) {
            this.moveHistory = this.moveHistory.slice(0, this.currentStep + 1);
        }

        this.moveHistory.push(move);
        this.currentStep = this.moveHistory.length - 1;

        // Update Firestore
        await this.syncBoardToFirestore();

        // Clear selection and hints
        this.selectedPiece = null;
        this.validMoves = [];
        const hintsLayer = document.getElementById('hints-layer');
        if (hintsLayer) hintsLayer.innerHTML = '';

        // Re-render
        this.renderBoard();
        this.updateMoveHistory();
    }

    async syncBoardToFirestore() {
        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);
        // Flatten the board - Firestore doesn't support nested arrays
        const flatBoard = this.board.flat();
        await setDoc(gameRef, {
            board: flatBoard,
            lastMoveTime: serverTimestamp()
        }, { merge: true }).catch((error) => {
            console.error('Error syncing board:', error);
        });
    }

    async sendChatMessage(text) {
        if (!text.trim()) return;

        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);
        const sender = this.isLecturer ? '👨‍🏫 Lecturer' : document.getElementById('user-name').textContent;

        // Get current chat array and append new message
        const gameSnap = await getDoc(gameRef);
        const currentChat = gameSnap.exists() ? (gameSnap.data().chat || []) : [];

        currentChat.push({
            sender: sender,
            text: text.trim(),
            timestamp: Date.now()
        });

        await setDoc(gameRef, {
            chat: currentChat
        }, { merge: true }).catch((error) => {
            console.error('Error sending message:', error);
        });

        document.getElementById('chat-input').value = '';
    }

    updateMoveHistory() {
        const historyEl = document.getElementById('move-history');
        if (!historyEl) return;

        if (this.moveHistory.length === 0) {
            historyEl.innerHTML = '<div style="text-align: center; color: #666; padding: 40px 20px; font-size: 0.8rem;">No moves yet</div>';
            return;
        }

        historyEl.innerHTML = '';
        this.moveHistory.forEach((move, index) => {
            const [fx, fy] = move.from;
            const [tx, ty] = move.to;
            const moveNum = Math.floor(index / 2) + 1;
            const isRed = move.piece === move.piece.toUpperCase();
            const color = isRed ? 'Red' : 'Black';
            const pieceChar = this.engine.labels[move.piece];

            const moveDiv = document.createElement('div');
            moveDiv.className = `move-item${index === this.currentStep ? ' active' : ''}`;
            moveDiv.textContent = `${moveNum}. ${color} ${pieceChar}: ${fx},${fy} → ${tx},${ty}`;
            moveDiv.onclick = () => this.goToStep(index);
            historyEl.appendChild(moveDiv);
        });

        // Scroll to active move
        const activeMove = historyEl.querySelector('.active');
        if (activeMove) {
            activeMove.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    goToStep(step) {
        if (step < -1 || step >= this.moveHistory.length) return;

        this.currentStep = step;
        if (step === -1) {
            this.board = this.engine.init();
        } else {
            this.board = this.moveHistory[step].boardState.map(row => [...row]);
        }

        this.selectedPiece = null;
        this.renderBoard();
        this.updateMoveHistory();
    }

    firstStep() {
        this.goToStep(-1);
    }

    previousStep() {
        if (this.currentStep > -1) {
            this.goToStep(this.currentStep - 1);
        }
    }

    nextStep() {
        if (this.currentStep < this.moveHistory.length - 1) {
            this.goToStep(this.currentStep + 1);
        }
    }

    lastStep() {
        this.goToStep(this.moveHistory.length - 1);
    }
}

// Global instance
const app_instance = new LectureApp();
app_instance.init();

// Global functions
window.joinLecture = async function() {
    try {
        console.log('Join button clicked');
        const password = document.getElementById('password-input').value;
        console.log('Password entered:', password ? '***' : '(empty - joining as student)');

        const verified = await app_instance.verifyPassword(password);
        console.log('Password verified:', verified);

        if (verified) {
            console.log('Starting lecture...');
            await app_instance.startLecture();
            console.log('Lecture started successfully');
        } else {
            alert('Failed to verify password');
        }
    } catch (error) {
        console.error('Error in joinLecture:', error);
        alert('Error joining lecture: ' + error.message);
    }
};

window.exitLecture = async function() {
    if (!confirm('Are you sure you want to exit the lecture?')) {
        return;
    }

    try {
        const tableRef = doc(db, "artifacts", appId, "public", "data", "regions", regionId, "tables", tableId);
        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);

        if (app_instance.isLecturer) {
            // Lecturer is exiting - reset the board and clear the game
            console.log('Lecturer exiting - resetting board and clearing game...');
            const initialBoard = app_instance.engine.init();
            const flatBoard = initialBoard.flat();

            // Reset the game state
            await setDoc(gameRef, {
                board: flatBoard,
                chat: [],
                lastMoveTime: serverTimestamp()
            });

            // Reset student count and clear lecturer info
            await updateDoc(tableRef, {
                students: 0,
                lecturer: deleteField()  // Remove lecturer field completely
            });
        } else {
            // Student is exiting - decrement student count
            const tableSnap = await getDoc(tableRef);
            if (tableSnap.exists()) {
                const currentCount = tableSnap.data().students || 0;
                const newCount = Math.max(0, currentCount - 1);
                await updateDoc(tableRef, {
                    students: newCount
                });
            }
        }

        window.location.href = '/lobby/lobby.html';
    } catch (error) {
        console.error('Error exiting lecture:', error);
        window.location.href = '/lobby/lobby.html';
    }
};

window.sendMessage = function() {
    const input = document.getElementById('chat-input');
    app_instance.sendChatMessage(input.value);
};

window.resetBoard = async function() {
    if (!app_instance.isLecturer) return;

    if (confirm('Reset the board to starting position?')) {
        // Reset board to initial position
        app_instance.board = app_instance.engine.init();

        // Clear move history
        app_instance.moveHistory = [];
        app_instance.currentStep = -1;

        // Sync to Firestore (use gameRef not tableRef)
        const gameRef = doc(db, "artifacts", appId, "public", "data", "games", tableId);
        const flatBoard = app_instance.board.flat();
        await setDoc(gameRef, {
            board: flatBoard,
            chat: [],
            lastMoveTime: serverTimestamp()
        });

        // Update UI
        app_instance.renderBoard();
        app_instance.updateMoveHistory();
    }
};

window.undoMove = function() {
    if (!app_instance.isLecturer) return;
    app_instance.previousStep();
};

// Navigation controls
window.firstStep = function() {
    app_instance.firstStep();
};

window.previousStep = function() {
    app_instance.previousStep();
};

window.nextStep = function() {
    app_instance.nextStep();
};

window.lastStep = function() {
    app_instance.lastStep();
};
