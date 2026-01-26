/**
 * ELO Rating System for Xiangqi
 *
 * Features:
 * - Adjusts for Red's first-move advantage
 * - K-factor varies by experience level
 * - Anti-sandbagging protection for large rating gaps
 * - Draw handling favors Black (compensates for Red advantage)
 */

export class ELOSystem {
    constructor() {
        this.STARTING_ELO = 1200;
        this.RATING_FLOOR = 400;
        this.RED_ADVANTAGE = 25; // ELO points representing Red's first-move advantage

        // K-factors based on games played
        this.K_FACTOR_NEW = 40;        // < 30 games
        this.K_FACTOR_INTERMEDIATE = 32; // 30-100 games
        this.K_FACTOR_EXPERIENCED = 24;  // > 100 games

        // Large gap threshold for anti-sandbagging
        this.LARGE_GAP_THRESHOLD = 400;
        this.LARGE_GAP_MULTIPLIER = 0.1; // Cap gains/losses at 10% for large gaps
    }

    /**
     * Get K-factor based on number of games played
     */
    getKFactor(gamesPlayed) {
        if (gamesPlayed < 30) return this.K_FACTOR_NEW;
        if (gamesPlayed < 100) return this.K_FACTOR_INTERMEDIATE;
        return this.K_FACTOR_EXPERIENCED;
    }

    /**
     * Calculate expected score for a player
     *
     * @param {number} playerRating - Player's current ELO
     * @param {number} opponentRating - Opponent's current ELO
     * @param {boolean} isRed - Whether the player is playing as Red
     * @returns {number} Expected score (0 to 1)
     */
    getExpectedScore(playerRating, opponentRating, isRed) {
        // Adjust for Red's first-move advantage
        const adjustedPlayerRating = isRed ? playerRating : playerRating + this.RED_ADVANTAGE;
        const adjustedOpponentRating = isRed ? opponentRating + this.RED_ADVANTAGE : opponentRating;

        const exponent = (adjustedOpponentRating - adjustedPlayerRating) / 400;
        return 1 / (1 + Math.pow(10, exponent));
    }

    /**
     * Get actual score based on game result
     *
     * @param {string} result - 'win', 'loss', or 'draw'
     * @param {boolean} isRed - Whether the player is Red
     * @returns {number} Actual score
     */
    getActualScore(result, isRed) {
        if (result === 'win') return 1.0;
        if (result === 'loss') return 0.0;

        // Draw handling: Red slightly penalized, Black slightly rewarded
        if (result === 'draw') {
            return isRed ? 0.45 : 0.55;
        }

        return 0.5; // Fallback
    }

    /**
     * Calculate rating change for a player
     *
     * @param {Object} params
     * @param {number} params.currentRating - Player's current ELO
     * @param {number} params.opponentRating - Opponent's current ELO
     * @param {number} params.gamesPlayed - Number of games player has played
     * @param {boolean} params.isRed - Whether player was Red
     * @param {string} params.result - 'win', 'loss', or 'draw'
     * @returns {Object} { oldRating, newRating, change, expectedScore, actualScore }
     */
    calculateRatingChange(params) {
        const { currentRating, opponentRating, gamesPlayed, isRed, result } = params;

        const kFactor = this.getKFactor(gamesPlayed);
        const expectedScore = this.getExpectedScore(currentRating, opponentRating, isRed);
        const actualScore = this.getActualScore(result, isRed);

        let ratingChange = kFactor * (actualScore - expectedScore);

        // Anti-sandbagging: limit gains/losses for large rating gaps
        const ratingGap = Math.abs(currentRating - opponentRating);
        if (ratingGap > this.LARGE_GAP_THRESHOLD) {
            const isHigherRated = currentRating > opponentRating;

            // Higher-rated player wins: minimal gain
            if (isHigherRated && result === 'win') {
                ratingChange = Math.min(ratingChange, kFactor * this.LARGE_GAP_MULTIPLIER);
            }
            // Lower-rated player loses: minimal loss
            else if (!isHigherRated && result === 'loss') {
                ratingChange = Math.max(ratingChange, -kFactor * this.LARGE_GAP_MULTIPLIER);
            }
            // Higher-rated player loses: full penalty (no cap)
            // Lower-rated player wins: full reward (no cap)
        }

        const newRating = Math.max(this.RATING_FLOOR, Math.round(currentRating + ratingChange));
        const actualChange = newRating - currentRating;

        return {
            oldRating: currentRating,
            newRating: newRating,
            change: actualChange,
            expectedScore: expectedScore,
            actualScore: actualScore,
            kFactor: kFactor
        };
    }

    /**
     * Calculate rating changes for both players in a game
     *
     * @param {Object} gameResult
     * @param {Object} gameResult.redPlayer - { uid, elo, gamesPlayed }
     * @param {Object} gameResult.blackPlayer - { uid, elo, gamesPlayed }
     * @param {string} gameResult.winner - 'red', 'black', or 'draw'
     * @returns {Object} { red: {...}, black: {...} }
     */
    calculateGameRatings(gameResult) {
        const { redPlayer, blackPlayer, winner } = gameResult;

        // Determine results for each player
        let redResult, blackResult;
        if (winner === 'draw') {
            redResult = 'draw';
            blackResult = 'draw';
        } else if (winner === 'red') {
            redResult = 'win';
            blackResult = 'loss';
        } else {
            redResult = 'loss';
            blackResult = 'win';
        }

        // Calculate rating changes
        const redChange = this.calculateRatingChange({
            currentRating: redPlayer.elo,
            opponentRating: blackPlayer.elo,
            gamesPlayed: redPlayer.gamesPlayed,
            isRed: true,
            result: redResult
        });

        const blackChange = this.calculateRatingChange({
            currentRating: blackPlayer.elo,
            opponentRating: redPlayer.elo,
            gamesPlayed: blackPlayer.gamesPlayed,
            isRed: false,
            result: blackResult
        });

        return {
            red: {
                uid: redPlayer.uid,
                ...redChange
            },
            black: {
                uid: blackPlayer.uid,
                ...blackChange
            }
        };
    }

    /**
     * Get rating category/title
     */
    getRatingCategory(elo) {
        if (elo < 1000) return 'Beginner';
        if (elo < 1400) return 'Intermediate';
        if (elo < 1800) return 'Advanced';
        if (elo < 2200) return 'Expert';
        return 'Master';
    }

    /**
     * Format ELO change for display
     */
    formatELOChange(change) {
        if (change > 0) return `+${change}`;
        return `${change}`;
    }

    /**
     * Check if player is provisional (fewer than 30 games)
     */
    isProvisional(gamesPlayed) {
        return gamesPlayed < 30;
    }
}

// Export singleton instance
export const eloSystem = new ELOSystem();
