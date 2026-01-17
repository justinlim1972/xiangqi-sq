/**
 * XQEngine - Pure Asian Chess Logic.
 * Handles movement rules, validations, and board initialization.
 */
export class XQEngine {
    constructor() {
        this.labels = { 
            'r':'车','n':'马','e':'象','a':'士','k':'将','c':'炮','p':'卒',
            'R':'车','N':'马','E':'相','A':'仕','K':'帅','C':'炮','P':'兵' 
        };
    }

    init() {
        return [
            ['r','n','e','a','k','a','e','n','r'],
            [null,null,null,null,null,null,null,null,null],
            [null,'c',null,null,null,null,null,'c',null],
            ['p',null,'p',null,'p',null,'p',null,'p'],
            [null,null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null,null],
            ['P',null,'P',null,'P',null,'P',null,'P'],
            [null,'C',null,null,null,null,null,'C',null],
            [null,null,null,null,null,null,null,null,null],
            ['R','N','E','A','K','A','E','N','R']
        ];
    }

    getValidMoves(board, x, y) {
        const piece = board[y][x]; if(!piece) return [];
        const isRed = piece === piece.toUpperCase();
        const moves = [];
        const onB = (nx, ny) => nx >= 0 && nx < 9 && ny >= 0 && ny < 10;
        const isE = (nx, ny) => board[ny][nx] && (board[ny][nx] === board[ny][nx].toUpperCase()) !== isRed;
        const add = (nx, ny) => { if(onB(nx,ny) && (!board[ny][nx] || isE(nx,ny))) moves.push({x:nx, y:ny}); };

        switch(piece.toLowerCase()) {
            case 'r': [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => { for(let i=1;i<10;i++){ let nx=x+dx*i,ny=y+dy*i; if(!onB(nx,ny))break; add(nx,ny); if(board[ny][nx])break; } }); break;
            case 'n': [[1,2],[1,-2],[-1,2],[-1,-2],[2,1],[2,-1],[-2,1],[-2,-1]].forEach(([dx,dy]) => { let lx=(Math.abs(dx)===2)?x+dx/2:x, ly=(Math.abs(dy)===2)?y+dy/2:y; if(onB(lx,ly) && !board[ly][lx]) add(x+dx,y+dy); }); break;
            case 'c': [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => { let j=false; for(let i=1;i<10;i++){ let nx=x+dx*i,ny=y+dy*i; if(!onB(nx,ny))break; if(!j){ if(!board[ny][nx])moves.push({x:nx,y:ny}); else j=true; } else if(board[ny][nx]){ if(isE(nx,ny))moves.push({x:nx,y:ny}); break; } } }); break;
            case 'p': let f=isRed?-1:1; add(x,y+f); if(isRed?y<=4:y>=5){ add(x+1,y); add(x-1,y); } break;
            case 'k': [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => { let nx=x+dx,ny=y+dy; if(nx>=3&&nx<=5&&(isRed?ny>=7:ny<=2)) add(nx,ny); }); break;
            case 'a': [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy]) => { let nx=x+dx,ny=y+dy; if(nx>=3&&nx<=5&&(isRed?ny>=7:ny<=2)) add(nx,ny); }); break;
            case 'e': [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(([dx,dy]) => { let mx=x+dx/2,my=y+dy/2; if(onB(x+dx,y+dy)&&!board[my][mx]&&(isRed?y+dy>=5:y+dy<=4)) add(x+dx,y+dy); }); break;
        }

        // Filter out moves that would leave king in check
        const legalMoves = moves.filter(move => {
            const wouldBeCheck = this.wouldBeInCheck(board, x, y, move.x, move.y, isRed);
            if(wouldBeCheck) {
                console.log(`🚫 Illegal move blocked: ${piece} from (${x},${y}) to (${move.x},${move.y}) - would leave king in check`);
            }
            return !wouldBeCheck;
        });
        console.log(`♟️ Valid moves for ${piece} at (${x},${y}):`, legalMoves.length, 'out of', moves.length);
        return legalMoves;
    }

    findKing(board, isRed) {
        const kingPiece = isRed ? 'K' : 'k';
        for(let y = 0; y < 10; y++) {
            for(let x = 0; x < 9; x++) {
                if(board[y][x] === kingPiece) {
                    return {x, y};
                }
            }
        }
        return null;
    }

    wouldBeInCheck(board, fromX, fromY, toX, toY, isRed) {
        // Create a temporary board with the move applied
        const testBoard = board.map(row => [...row]);
        testBoard[toY][toX] = testBoard[fromY][fromX];
        testBoard[fromY][fromX] = null;

        // Find king position (might have moved if we're moving the king)
        const kingPiece = isRed ? 'K' : 'k';
        let kingPos = this.findKing(testBoard, isRed);
        if(!kingPos) return true; // King not found = invalid

        // Check if any opponent piece can attack the king
        for(let y = 0; y < 10; y++) {
            for(let x = 0; x < 9; x++) {
                const piece = testBoard[y][x];
                if(!piece) continue;

                const pieceIsRed = piece === piece.toUpperCase();
                if(pieceIsRed === isRed) continue; // Same color, skip

                // Check if this opponent piece can attack our king
                if(this.canAttack(testBoard, x, y, kingPos.x, kingPos.y)) {
                    return true; // Would be in check
                }
            }
        }

        return false; // Safe move
    }

    canAttack(board, fromX, fromY, toX, toY) {
        const piece = board[fromY][fromX];
        if(!piece) return false;

        const isRed = piece === piece.toUpperCase();
        const target = board[toY][toX];
        if(!target) return false;

        const targetIsRed = target === target.toUpperCase();
        if(isRed === targetIsRed) return false; // Same color

        const dx = toX - fromX;
        const dy = toY - fromY;
        const onB = (nx, ny) => nx >= 0 && nx < 9 && ny >= 0 && ny < 10;

        switch(piece.toLowerCase()) {
            case 'r': // Chariot - straight lines
                if(dx !== 0 && dy !== 0) return false;
                if(dx === 0) {
                    const step = dy > 0 ? 1 : -1;
                    for(let y = fromY + step; y !== toY; y += step) {
                        if(board[y][fromX]) return false;
                    }
                    return true;
                } else {
                    const step = dx > 0 ? 1 : -1;
                    for(let x = fromX + step; x !== toX; x += step) {
                        if(board[fromY][x]) return false;
                    }
                    return true;
                }

            case 'n': // Horse - L-shape
                if((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)) {
                    const legX = Math.abs(dx) === 2 ? fromX + dx/2 : fromX;
                    const legY = Math.abs(dy) === 2 ? fromY + dy/2 : fromY;
                    return onB(legX, legY) && !board[legY][legX];
                }
                return false;

            case 'c': // Cannon - must jump exactly one piece
                if(dx !== 0 && dy !== 0) return false;
                let jumped = 0;
                if(dx === 0) {
                    const step = dy > 0 ? 1 : -1;
                    for(let y = fromY + step; y !== toY; y += step) {
                        if(board[y][fromX]) jumped++;
                    }
                } else {
                    const step = dx > 0 ? 1 : -1;
                    for(let x = fromX + step; x !== toX; x += step) {
                        if(board[fromY][x]) jumped++;
                    }
                }
                return jumped === 1;

            case 'p': // Pawn
                const forward = isRed ? -1 : 1;
                if(dy === forward && dx === 0) return true;
                if((isRed ? fromY <= 4 : fromY >= 5) && dy === 0 && Math.abs(dx) === 1) return true;
                return false;

            case 'k': // King - flying king rule (kings cannot face each other)
                if(dx === 0 && piece.toLowerCase() === target.toLowerCase()) {
                    for(let y = Math.min(fromY, toY) + 1; y < Math.max(fromY, toY); y++) {
                        if(board[y][fromX]) return false;
                    }
                    return true;
                }
                // Normal king movement
                return Math.abs(dx) + Math.abs(dy) === 1;

            case 'a': // Advisor
                return Math.abs(dx) === 1 && Math.abs(dy) === 1;

            case 'e': // Elephant
                if(Math.abs(dx) === 2 && Math.abs(dy) === 2) {
                    const midX = fromX + dx/2;
                    const midY = fromY + dy/2;
                    return !board[midY][midX];
                }
                return false;
        }
        return false;
    }

    /**
     * Check if a king is currently in check
     */
    isInCheck(board, isRed) {
        const kingPos = this.findKing(board, isRed);
        if (!kingPos) return false;

        // Check if any opponent piece can attack the king
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
                const piece = board[y][x];
                if (!piece) continue;

                const pieceIsRed = piece === piece.toUpperCase();
                if (pieceIsRed === isRed) continue; // Same color, skip

                if (this.canAttack(board, x, y, kingPos.x, kingPos.y)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get all legal moves for a color
     */
    getAllLegalMoves(board, isRed) {
        const allMoves = [];

        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 9; x++) {
                const piece = board[y][x];
                if (!piece) continue;

                const pieceIsRed = piece === piece.toUpperCase();
                if (pieceIsRed !== isRed) continue; // Different color, skip

                const moves = this.getValidMoves(board, x, y);
                if (moves.length > 0) {
                    allMoves.push({from: {x, y}, moves});
                }
            }
        }

        return allMoves;
    }

    /**
     * Check if it's checkmate
     */
    isCheckmate(board, isRed) {
        // Must be in check AND have no legal moves
        if (!this.isInCheck(board, isRed)) return false;

        const legalMoves = this.getAllLegalMoves(board, isRed);
        return legalMoves.length === 0;
    }

    /**
     * Check if it's stalemate (not in check but no legal moves)
     */
    isStalemate(board, isRed) {
        // Must NOT be in check AND have no legal moves
        if (this.isInCheck(board, isRed)) return false;

        const legalMoves = this.getAllLegalMoves(board, isRed);
        return legalMoves.length === 0;
    }

    /**
     * Generate a hash string for a board position
     * Used for detecting position repetitions
     */
    getBoardHash(board) {
        return board.map(row =>
            row.map(cell => cell || '_').join('')
        ).join('|');
    }

    /**
     * Convert board to FEN notation
     * @param {Array} board - 2D array representing the board
     * @param {string} turn - 'red' or 'black'
     * @returns {string} - FEN string
     */
    boardToFEN(board, turn) {
        let fen = '';

        // Part 1: Board position (top to bottom)
        for (let y = 0; y < 10; y++) {
            let emptyCount = 0;
            for (let x = 0; x < 9; x++) {
                const piece = board[y][x];
                if (!piece) {
                    emptyCount++;
                } else {
                    if (emptyCount > 0) {
                        fen += emptyCount;
                        emptyCount = 0;
                    }
                    fen += piece;
                }
            }
            if (emptyCount > 0) {
                fen += emptyCount;
            }
            if (y < 9) {
                fen += '/';
            }
        }

        // Part 2: Active color
        fen += turn === 'red' ? ' w' : ' b';

        // Part 3 & 4: Move counters (simplified)
        fen += ' - - 0 1';

        return fen;
    }

    /**
     * Check if a position has been repeated 6 times (6-fold repetition = draw in Xiangqi)
     * @param {Array} moveHistory - Array of board hashes from previous moves
     * @param {string} currentHash - Hash of the current board position
     * @returns {boolean} - True if this position has occurred 6 times
     */
    isThreefoldRepetition(moveHistory, currentHash) {
        if (!moveHistory || moveHistory.length < 5) return false;

        // Count how many times the current position has appeared
        let count = 1; // Current position counts as 1
        for (const hash of moveHistory) {
            if (hash === currentHash) {
                count++;
            }
        }

        return count >= 6;
    }

    /**
     * Detect perpetual check (连续将军判负)
     * If the same player keeps checking the opponent king repeatedly, they lose
     * @param {Array} moveHistory - Array of recent board hashes with check status
     * @returns {object|null} - {loser: 'red'|'black'} if perpetual check detected, null otherwise
     */
    isPerpetualCheck(moveHistory) {
        // Need at least 6 moves to detect perpetual check (3 consecutive checks)
        if (!moveHistory || moveHistory.length < 6) return null;

        // Look at the last 6 moves
        const recent = moveHistory.slice(-6);

        // Check if all 6 moves involved the same player giving check
        const checksBy = recent.filter(m => m.isCheck);
        if (checksBy.length < 3) return null;

        // If the last 3 moves all gave check and came from the same player
        const lastThree = moveHistory.slice(-3);
        const allChecks = lastThree.every(m => m.isCheck);

        if (allChecks) {
            // The player giving check loses
            // Last move was by the checking player
            const loser = lastThree[lastThree.length - 1].movedBy;
            console.log('🚫 Perpetual check detected! Checking player loses:', loser);
            return { loser };
        }

        return null;
    }

    /**
     * Detect perpetual chase (长捉判负)
     * If a player keeps chasing the same piece without capturing, they lose
     * This is a simplified version - full implementation would track specific piece threats
     * @param {Array} moveHistory - Array of recent moves with positions
     * @returns {object|null} - {loser: 'red'|'black'} if perpetual chase detected, null otherwise
     */
    isPerpetualChase(moveHistory) {
        // This is a simplified implementation
        // A full implementation would need to track:
        // 1. Which piece is being "chased" (threatened but not captured)
        // 2. Whether the same piece is under threat repeatedly
        // 3. Whether the chasing player has other options

        // For now, we'll detect if the same 2 board positions alternate 3+ times
        // (indicating a repetitive chase pattern)
        if (!moveHistory || moveHistory.length < 8) return null;

        const recent = moveHistory.slice(-8);
        const hashes = recent.map(m => m.boardHash);

        // Check for ABAB pattern (position A, then B, then A, then B)
        let patternCount = 0;
        for (let i = 0; i < hashes.length - 3; i += 2) {
            if (hashes[i] === hashes[i + 2] && hashes[i + 1] === hashes[i + 3]) {
                patternCount++;
            }
        }

        // If we see the ABAB pattern 2+ times, it's likely perpetual chase
        if (patternCount >= 2) {
            // The player who keeps repeating loses
            const loser = recent[recent.length - 1].movedBy;
            console.log('🚫 Perpetual chase detected! Chasing player loses:', loser);
            return { loser };
        }

        return null;
    }
}