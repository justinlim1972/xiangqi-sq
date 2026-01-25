// Debug Logger - Safe, non-invasive logging system
// Can be disabled by setting DEBUG_ENABLED = false

const DEBUG_ENABLED = true; // Set to false to disable all logging

class DebugLogger {
    constructor() {
        this.sessionLogs = [];
        this.maxLogs = 100; // Keep last 100 events
        this.gameId = null;
        this.userId = null;
    }

    init(gameId, userId) {
        this.gameId = gameId;
        this.userId = userId;
        this.log('SESSION_START', { gameId, userId });
    }

    log(eventType, data) {
        if (!DEBUG_ENABLED) return;

        try {
            const entry = {
                timestamp: Date.now(),
                eventType,
                data: JSON.parse(JSON.stringify(data)), // Deep clone to avoid reference issues
                url: window.location.href,
                userAgent: navigator.userAgent
            };

            this.sessionLogs.push(entry);

            // Keep only last maxLogs entries
            if (this.sessionLogs.length > this.maxLogs) {
                this.sessionLogs.shift();
            }

            // Also log to console for immediate visibility
            console.log(`[DEBUG ${eventType}]`, data);
        } catch (e) {
            console.error('Debug logger failed (non-critical):', e);
        }
    }

    logMove(move) {
        this.log('MOVE', {
            from: move.from,
            to: move.to,
            piece: move.piece,
            captured: move.captured,
            turn: move.turn,
            moveNumber: move.moveNumber,
            timestamp: move.timestamp
        });
    }

    logBoardState(board, description = '') {
        this.log('BOARD_STATE', {
            description,
            board: board,
            pieceCount: this.countPieces(board)
        });
    }

    logError(error, context = {}) {
        this.log('ERROR', {
            message: error.message || String(error),
            stack: error.stack,
            context
        });
    }

    logWarning(message, data = {}) {
        this.log('WARNING', { message, ...data });
    }

    countPieces(board) {
        if (!board) return null;
        const count = {};
        for (let row of board) {
            for (let cell of row) {
                if (cell) {
                    const key = cell.color + '_' + cell.type;
                    count[key] = (count[key] || 0) + 1;
                }
            }
        }
        return count;
    }

    getLogs() {
        return this.sessionLogs;
    }

    exportReport() {
        return {
            gameId: this.gameId,
            userId: this.userId,
            timestamp: Date.now(),
            logs: this.sessionLogs,
            userAgent: navigator.userAgent,
            screenSize: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            url: window.location.href
        };
    }

    async submitBugReport(description, db, appId) {
        if (!DEBUG_ENABLED) {
            console.log('Debug logging is disabled');
            return null;
        }

        try {
            const report = this.exportReport();
            report.userDescription = description;
            report.reportedAt = Date.now();

            // Save to Firebase
            const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
            const bugReportsRef = collection(db, 'artifacts', appId, 'bug-reports');
            const docRef = await addDoc(bugReportsRef, report);

            console.log('Bug report submitted:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.error('Failed to submit bug report (non-critical):', e);
            // Fallback: save to localStorage
            try {
                const localReports = JSON.parse(localStorage.getItem('bugReports') || '[]');
                localReports.push(this.exportReport());
                localStorage.setItem('bugReports', JSON.stringify(localReports.slice(-10))); // Keep last 10
                console.log('Bug report saved to localStorage as fallback');
            } catch (e2) {
                console.error('All bug report methods failed:', e2);
            }
            return null;
        }
    }
}

// Export singleton instance
window.debugLogger = new DebugLogger();
