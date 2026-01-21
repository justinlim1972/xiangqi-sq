/**
 * XQUI - Visual Rendering Component.
 */
export class XQUI {
    constructor() {
        // Piece style templates from settings page
        this.pieceTemplates = {
            ivory: (char, isRed) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#fdfaf0" stroke="#d4c9b0" stroke-width="2"/><text x="50" y="72" text-anchor="middle" font-size="60" font-family="serif" fill="${isRed ? '#cd3333' : '#222'}" font-weight="bold">${char}</text></svg>`,
            jade: (char, isRed) => `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-${char}-${isRed}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${isRed ? '#ff6666' : '#2d5a27'}" /><stop offset="100%" stop-color="${isRed ? '#800000' : '#0a1a08'}" /></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#g-${char}-${isRed})" stroke="#fff" stroke-width="3" opacity="0.9"/><text x="50" y="70" text-anchor="middle" font-size="55" font-family="sans-serif" fill="#fff" font-weight="900">${char}</text></svg>`,
            flat: (char, isRed) => `<svg viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="90" rx="18" fill="${isRed ? '#ef4444' : '#1e293b'}"/><text x="50" y="75" text-anchor="middle" font-size="65" font-family="Arial" fill="#fff" font-weight="bold">${char}</text></svg>`,
            wood: (char, isRed) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${isRed ? '#5a3a2a' : '#1e1e1e'}" stroke="${isRed ? '#2a1a10' : '#000'}" stroke-width="3"/><text x="50" y="72" text-anchor="middle" font-size="55" font-family="serif" fill="${isRed ? '#facc15' : '#cbd5e1'}" font-weight="bold">${char}</text></svg>`,
            bronze: (char, isRed) => `<svg viewBox="0 0 100 100"><defs><radialGradient id="bronze-${char}-${isRed}"><stop offset="0%" stop-color="${isRed ? '#cd7f32' : '#4a4a4a'}"/><stop offset="100%" stop-color="${isRed ? '#8b4513' : '#1a1a1a'}"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#bronze-${char}-${isRed})" stroke="${isRed ? '#5a3a1a' : '#000'}" stroke-width="3"/><text x="50" y="72" text-anchor="middle" font-size="55" font-family="serif" fill="#d4af37" font-weight="bold" style="text-shadow: 2px 2px 4px rgba(0,0,0,0.8)">${char}</text></svg>`,
            crystal: (char, isRed) => `<svg viewBox="0 0 100 100"><defs><linearGradient id="crystal-${char}-${isRed}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${isRed ? '#fef3c7' : '#bae6fd'}"/><stop offset="50%" stop-color="${isRed ? '#f59e0b' : '#0ea5e9'}"/><stop offset="100%" stop-color="${isRed ? '#b91c1c' : '#0369a1'}"/></linearGradient></defs><polygon points="50,5 90,35 90,65 50,95 10,65 10,35" fill="url(#crystal-${char}-${isRed})" stroke="${isRed ? '#dc2626' : '#0891b2'}" stroke-width="2" opacity="0.9"/><text x="50" y="70" text-anchor="middle" font-size="50" font-family="sans-serif" fill="#fff" font-weight="900" style="text-shadow: 0 0 10px rgba(255,255,255,0.8)">${char}</text></svg>`,
            neon: (char, isRed) => `<svg viewBox="0 0 100 100"><defs><filter id="glow-${char}-${isRed}"><feGaussianBlur stdDeviation="4" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="8" y="8" width="84" height="84" rx="12" fill="#0a0a0a" stroke="${isRed ? '#ff0080' : '#00ffff'}" stroke-width="3" filter="url(#glow-${char}-${isRed})"/><text x="50" y="72" text-anchor="middle" font-size="60" font-family="'Courier New', monospace" fill="${isRed ? '#ff0080' : '#00ffff'}" font-weight="900" filter="url(#glow-${char}-${isRed})">${char}</text></svg>`,
            gold: (char, isRed) => `<svg viewBox="0 0 100 100"><defs><radialGradient id="gold-${char}-${isRed}"><stop offset="0%" stop-color="${isRed ? '#ffd700' : '#2c2c2c'}"/><stop offset="50%" stop-color="${isRed ? '#ffed4e' : '#1a1a1a'}"/><stop offset="100%" stop-color="${isRed ? '#b8860b' : '#000'}"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#gold-${char}-${isRed})" stroke="${isRed ? '#8b6914' : '#d4af37'}" stroke-width="3"/><text x="50" y="72" text-anchor="middle" font-size="58" font-family="'Times New Roman', serif" fill="${isRed ? '#8b0000' : '#ffd700'}" font-weight="bold" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.5)">${char}</text></svg>`
        };
    }
    drawGrid(svgId, lineColor = "#5d2e0c") {
        const svg = document.getElementById(svgId);
        const s = lineColor; 
        const redNums = ['九','八','七','六','五','四','三','二','一'];
        let lines = "";
        
        // 1. CORE GRID LINES
        for(let i=0; i<9; i++) { 
            let x=10+i*10; 
            lines+=`<line x1="${x}" y1="10" x2="${x}" y2="50" stroke="${s}" stroke-width="0.4"/><line x1="${x}" y1="60" x2="${x}" y2="100" stroke="${s}" stroke-width="0.4"/>`; 
        }
        for(let i=0; i<10; i++) { let y=10+i*10; lines+=`<line x1="10" y1="${y}" x2="90" y2="${y}" stroke="${s}" stroke-width="0.4"/>`; }
        const palace = `<line x1="40" y1="10" x2="60" y2="30" stroke="${s}" stroke-width="0.4"/><line x1="60" y1="10" x2="40" y2="30" stroke="${s}" stroke-width="0.4"/><line x1="40" y1="80" x2="60" y2="100" stroke="${s}" stroke-width="0.4"/><line x1="60" y1="80" x2="40" y2="100" stroke="${s}" stroke-width="0.4"/>`;

        // 2. COORDINATION MARKERS
        let coords = "";
        for(let i=0; i<9; i++) {
            coords += `<text x="${10+i*10}" y="6.5" text-anchor="middle" font-size="3.5" fill="${s}" font-weight="bold">${i+1}</text>`;
            coords += `<text x="${10+i*10}" y="106.8" text-anchor="middle" font-size="3.8" fill="${s}" font-weight="bold">${redNums[i]}</text>`;
        }

        // 3. INTERSECTION MARKERS (The cross-hairs)
        // FIXED: Reduced l to 0.4 for SHORTER arms. stroke-width is kept at 0.4 for visibility.
        let markers = "";
        const drawMarker = (x, y, L, R) => {
            const px=10+x*10, py=10+y*10, g=0.6, l=0.4; let m="";
            if(!L){ 
                m+=`<line x1="${px-g-l}" y1="${py-g}" x2="${px-g}" y2="${py-g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px-g}" y1="${py-g-l}" x2="${px-g}" y2="${py-g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px-g-l}" y1="${py+g}" x2="${px-g}" y2="${py+g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px-g}" y1="${py+g}" x2="${px-g}" y2="${py+g+l}" stroke="${s}" stroke-width="0.4"/>`;
            }
            if(!R){
                m+=`<line x1="${px+g}" y1="${py-g}" x2="${px+g+l}" y2="${py-g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px+g}" y1="${py-g-l}" x2="${px+g}" y2="${py-g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px+g}" y1="${py+g}" x2="${px+g+l}" y2="${py+g}" stroke="${s}" stroke-width="0.4"/>`;
                m+=`<line x1="${px+g}" y1="${py+g}" x2="${px+g}" y2="${py+g+l}" stroke="${s}" stroke-width="0.4"/>`;
            }
            return m;
        };

        [0,2,4,6,8].forEach(x => [3,6].forEach(y => markers += drawMarker(x,y,x===0,x===8)));
        [1,7].forEach(x => [2,7].forEach(y => markers += drawMarker(x,y,false,false)));

        // 4. RIVER TEXT
        svg.innerHTML = `
            <rect x="10" y="10" width="80" height="90" fill="none" stroke="${s}" stroke-width="1.2"/>
            <text x="30" y="56.5" text-anchor="middle" font-size="4.5" fill="${s}" font-weight="900">楚 河</text>
            <text x="70" y="56.5" text-anchor="middle" font-size="4.5" fill="${s}" font-weight="900">漢 界</text>
            ${lines}${palace}${coords}${markers}
        `;
    }

    renderPieces(board, labels, clickFn, pieceStyle = 'ivory', lastMove = null, selectedPiece = null) {
        const layer = document.getElementById('pieces-layer');
        if (!layer) {
            console.error('❌ pieces-layer element not found!');
            return;
        }

        if (!board || !Array.isArray(board)) {
            console.error('❌ Board is not an array!', typeof board, board);
            return;
        }

        const template = this.pieceTemplates[pieceStyle] || this.pieceTemplates.ivory;
        console.log('🎨 Rendering pieces with style:', pieceStyle, 'lastMove:', lastMove, 'selectedPiece:', selectedPiece);

        layer.innerHTML = "";
        board.forEach((row, y) => {
            if (!Array.isArray(row)) {
                console.error(`❌ Row ${y} is not an array!`, typeof row, row);
                return;
            }
            row.forEach((p, x) => {
                if(!p) return;
                const el = document.createElement('div');
                el.className = 'piece';
                el.setAttribute('data-x', x);
                el.setAttribute('data-y', y);

                // Add 'piece-selected' class if this is the currently selected piece
                if (selectedPiece && selectedPiece.x === x && selectedPiece.y === y) {
                    el.classList.add('piece-selected');
                    console.log(`🟡 Highlighting selected piece at (${x}, ${y})`);
                }

                // Add 'last-moved' class if this is the piece that was just moved
                if (lastMove && lastMove.to) {
                    console.log(`🔍 Piece at (${x}, ${y}) vs lastMove.to (${lastMove.to.x}, ${lastMove.to.y})`);
                    if (lastMove.to.x === x && lastMove.to.y === y) {
                        el.classList.add('last-moved');
                        console.log(`✅ ✨ APPLIED last-moved to piece at (${x}, ${y})!`);
                    }
                }

                el.style.left = `${10+x*10}%`;
                el.style.top = `${((10+y*10)/110)*100}%`;
                const isRed = p === p.toUpperCase();
                const char = labels[p];
                el.innerHTML = template(char, isRed);
                el.onclick = () => clickFn(x, y);
                layer.appendChild(el);
            });
        });
    }
}