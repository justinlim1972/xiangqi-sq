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
}