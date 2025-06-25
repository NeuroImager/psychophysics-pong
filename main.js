// ============================================================================
// PSYCHOPHYSICS PONG - VISUAL CONTRAST THRESHOLD MEASUREMENT
// ============================================================================
// This game uses a QUEST adaptive staircase method to measure luminance contrast
// thresholds. Players hit a ball with varying contrast levels using a paddle.
// The QUEST algorithm adaptively adjusts contrast based on player performance.

// ============================================================================
//  GAME CONFIGURATION
// ============================================================================
// Phaser.js game configuration object
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: 0x888888, // mid-gray background
    parent: 'game-container',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    }
};

// ============================================================================
//  GLOBAL VARIABLES
// ============================================================================
// Game objects
let paddle, ball, ringGraphics;
let cursors;
let ballContrast = 1.0; // 1.0 = max contrast, 0 = min
let scoreText;
let ringTimer = 0;
let ballReady = true;
let trialCount = 0; // Track number of trials
const MAX_TRIALS = 20; // Maximum number of trials
let gameCompleted = false; // Track if game is finished
let trialData = []; // Store trial data for results page

// QUEST algorithm variables
let quest;
let currentLogContrast = 0;
let gameStarted = false;
let countdownText;
let startText;

// ============================================================================
//  QUEST ALGORITHM FUNCTIONS
// ============================================================================
// Initialize the QUEST adaptive staircase algorithm
function setupQuest() {
    // Use log10 units for tGuess and tGuessSd
    const tGuess = Math.log10(0.1); // -1 (expected threshold)
    const tGuessSd = 0.5;           // reasonable uncertainty in log units
    const pThreshold = 0.82;
    const beta = 3.5;
    const delta = 0.01;
    const gamma = 0.5;
    const grain = 0.01;
    const range = 4;
    quest = jsQUEST.QuestCreate(tGuess, tGuessSd, pThreshold, beta, delta, gamma, grain, range);
}

// Get the next contrast level recommended by QUEST
function getNextContrast() {
    // Use QuestQuantile to get the recommended stimulus (log units)
    currentLogContrast = jsQUEST.QuestQuantile(quest);
    // Convert log contrast to linear for display
    return Math.pow(10, currentLogContrast);
}

// ============================================================================
//  VISUAL STIMULUS GENERATION
// ============================================================================
// Generate a proper Gaussian ball texture with specified contrast
function generateGaussianTexture(scene, key, size, contrast) {
    // Create a canvas texture
    const canvas = scene.textures.createCanvas(key, size, size);
    const ctx = canvas.getContext();
    const cx = size / 2;
    const cy = size / 2;
    const sigma = size / 6; // Controls spread; adjust as needed
    const imageData = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const r2 = dx * dx + dy * dy;
            // 2D Gaussian
            const gauss = Math.exp(-r2 / (2 * sigma * sigma));
            const idx = (y * size + x) * 4;
            imageData.data[idx + 0] = 255; // R (white)
            imageData.data[idx + 1] = 255; // G (white)
            imageData.data[idx + 2] = 255; // B (white)
            imageData.data[idx + 3] = Math.round(255 * gauss * contrast); // Alpha
        }
    }
    ctx.putImageData(imageData, 0, 0);
    canvas.refresh(); // Ensure Phaser updates the texture
}

// ============================================================================
//  PHASER LIFECYCLE FUNCTIONS
// ============================================================================
// Called once when the scene starts - load assets
function preload() {
    // Generate proper Gaussian ball texture for instructions screen
    this.textures.remove('ballTex');
    generateGaussianTexture(this, 'ballTex', 40, ballContrast);
}

// Called once when the scene starts - create game objects
function create() {
    setupQuest();
    // Paddle (bottom, horizontal)
    paddle = this.add.rectangle(400, 570, 120, 20, 0xffffff);
    this.physics.add.existing(paddle, true);

    // Ball as a physics image with Gaussian texture
    ball = this.physics.add.image(400, 300, 'ballTex');
    ball.setDisplaySize(40, 40);
    ball.setOrigin(0.5, 0.5);
    ball.setBounce(1, 1);
    ball.setCollideWorldBounds(true);
    ball.body.onWorldBounds = true;
    ball.body.setCircle(20, 0, 0); // No offset
    ball.setVisible(false); // Hide ball during instructions and countdown
    paddle.visible = false;

    // Start text
    startText = this.add.text(400, 300, 'Press S to Start', {
        fontFamily: 'VT323',
        fontSize: '48px',
        color: '#fff',
        align: 'center',
        stroke: '#0f0',
        strokeThickness: 2,
        shadow: { offsetX: 2, offsetY: 2, color: '#0f0', blur: 2, fill: true }
    }).setOrigin(0.5);

    // Countdown text (hidden initially)
    countdownText = this.add.text(400, 300, '', {
        fontFamily: 'VT323',
        fontSize: '48px',
        color: '#fff',
        align: 'center',
        stroke: '#0f0',
        strokeThickness: 2,
        shadow: { offsetX: 2, offsetY: 2, color: '#0f0', blur: 2, fill: true }
    }).setOrigin(0.5);
    countdownText.setVisible(false);

    // Ring graphics (for cue)
    ringGraphics = this.add.graphics();
    ringGraphics.setDepth(1);
    ringGraphics.visible = false;

    // Input
    cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-S', () => {
        if (!gameStarted) {
            startText.setVisible(false);
            startCountdown(this);
        }
    });

    // Collisions
    this.physics.add.collider(ball, paddle, () => {
        if (!ballReady || gameCompleted) return;
        trialCount++;
        quest = jsQUEST.QuestUpdate(quest, currentLogContrast, 1);
        // Store trial data
        trialData.push({
            trial: trialCount,
            contrast: ballContrast,
            response: 1 // Hit
        });
        updateBallAppearance(this);
        playBip(880);
        ball.setVelocityY(-Math.abs(ball.body.velocity.y));
        
        if (trialCount >= MAX_TRIALS) {
            endGame(this);
        }
    });

    // Listen for world bounds collision
    this.physics.world.on('worldbounds', (body, up, down, left, right) => {
        if (body.gameObject === ball && down) {
            if (ballReady && !gameCompleted) {
                trialCount++;
                quest = jsQUEST.QuestUpdate(quest, currentLogContrast, 0);
                // Store trial data
                trialData.push({
                    trial: trialCount,
                    contrast: ballContrast,
                    response: 0 // Miss
                });
                updateBallAppearance(this);
                playBip(220);
                ballReady = false;
                ball.setVelocity(0, 0); // Stop the ball
                ball.setPosition(400, 300); // Center the ball
                ball.body.enable = false; // Freeze physics
                showRingCue();
                ball.setVisible(true); // Ensure ball is visible in the ring
                this.time.delayedCall(1000, () => {
                    if (!gameCompleted) {
                        ringGraphics.clear();
                        ringGraphics.visible = false;
                        ball.body.enable = true; // Unfreeze physics
                        serveBall(this, true); // Set velocity
                        ballReady = true;
                    }
                });
                
                if (trialCount >= MAX_TRIALS) {
                    endGame(this);
                }
            }
        }
    }, this);

    // Score/contrast display
    scoreText = this.add.text(20, 20, 'Trial: ' + trialCount + '/' + MAX_TRIALS + ' | Contrast: ' + (typeof ballContrast === 'number' && !isNaN(ballContrast) ? ballContrast.toFixed(2) : 'N/A'), { fontSize: '12px', fill: '#fff' });
    scoreText.setVisible(false);
}

// Called every frame - handle game logic
function update(time, delta) {
    if (!gameStarted || gameCompleted) return;
    if (cursors.left.isDown) {
        paddle.x -= 7;
    } else if (cursors.right.isDown) {
        paddle.x += 7;
    }
    paddle.x = Phaser.Math.Clamp(paddle.x, 60, 800 - 60);
    paddle.body.updateFromGameObject();
    scoreText.setText('Trial: ' + trialCount + '/' + MAX_TRIALS + ' | Contrast: ' + (typeof ballContrast === 'number' && !isNaN(ballContrast) ? ballContrast.toFixed(2) : 'N/A'));
}

// ============================================================================
//  GAME FLOW FUNCTIONS
// ============================================================================
// Start the countdown sequence before game begins
function startCountdown(scene) {
    let count = 3;
    countdownText.setText(count);
    countdownText.setVisible(true);
    let timer = scene.time.addEvent({
        delay: 1000,
        repeat: 2,
        callback: () => {
            count--;
            if (count > 0) {
                countdownText.setText(count);
            } else if (count === 0) {
                countdownText.setText('GO!');
                // After a short delay, hide the text and start the game
                scene.time.delayedCall(700, () => {
                    countdownText.setVisible(false);
                    gameStarted = true;
                    ball.setVisible(true);
                    paddle.visible = true;
                    scoreText.setVisible(true);
                    serveBall(scene);
                });
            }
        }
    });
}

// Serve the ball with new contrast level
function serveBall(scene, onlySetVelocity = false) {
    if (!gameStarted) return;
    if (!onlySetVelocity) {
        ballContrast = getNextContrast();
        updateBallAppearance(scene);
        ball.setPosition(400, 300);
        ball.setVisible(true);
    }
    const baseVx = 260;
    const baseVy = -200;
    const speedFactor = 1.5;
    let vx = (Phaser.Math.Between(0, 1) === 0 ? 1 : -1) * baseVx * speedFactor;
    let vy = baseVy * speedFactor;
    ball.setVelocity(vx, vy);
    ballReady = true;
}

// Update ball appearance with new contrast level
function updateBallAppearance(scene) {
    // Get next contrast from QUEST
    ballContrast = getNextContrast();
    // Redraw ball with new contrast
    scene.textures.remove('ballTex');
    generateGaussianTexture(scene, 'ballTex', 40, ballContrast);
    ball.setTexture('ballTex');
}

// Show visual cue ring around ball position
function showRingCue() {
    ringGraphics.clear();
    ringGraphics.lineStyle(1, 0x000000, 1);
    ringGraphics.strokeCircle(400, 300, 24);
    ringGraphics.visible = true;
}

// ============================================================================
//  UTILITY FUNCTIONS
// ============================================================================
// Play audio feedback (high frequency for hits, low for misses)
function playBip(frequency) {
    // Use Web Audio API for simple beep
    const ctx = window.audioCtx || (window.audioCtx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = frequency;
    g.gain.value = 0.1;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
}

// ============================================================================
//  GAME END & DATA HANDLING
// ============================================================================
// Handle game completion and results display
function endGame(scene) {
    gameCompleted = true;
    ball.setVisible(false);
    paddle.visible = false;
    ringGraphics.visible = false;
    
    const finalThreshold = Math.pow(10, jsQUEST.QuestMean(quest)).toFixed(5);
    const threshSD = jsQUEST.QuestSd(quest).toFixed(5);
    const hits = trialData.filter(trial => trial.response === 1).length;
    const hitRate = ((hits / trialData.length) * 100).toFixed(1);
    
    // Prepare data for Google Forms
    const dataToSend = {
        finalThreshold: finalThreshold,
        thresholdSD: threshSD,
        totalTrials: trialData.length,
        hitRate: hitRate,
        trialData: trialData
    };
    
    // Send data to Google Forms
    sendDataToGoogleForms(dataToSend);
    
    const completionText = scene.add.text(400, 300, 'Game Complete!\n\nFinal threshold estimate:\n' + finalThreshold + ' ± ' + threshSD, {
        fontFamily: 'VT323',
        fontSize: '32px',
        color: '#fff',
        align: 'center',
        stroke: '#0f0',
        strokeThickness: 2,
        shadow: { offsetX: 2, offsetY: 2, color: '#0f0', blur: 2, fill: true }
    }).setOrigin(0.5);
    
    // Add button to view results
    const resultsButton = scene.add.text(400, 400, 'View Results', {
        fontFamily: 'VT323',
        fontSize: '24px',
        color: '#0f0',
        align: 'center',
        stroke: '#fff',
        strokeThickness: 2,
        backgroundColor: '#333',
        padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive();
    
    resultsButton.on('pointerdown', () => {
        // Pass data via URL parameters
        const dataParam = encodeURIComponent(JSON.stringify(dataToSend));
        window.open('results.html?data=' + dataParam, '_blank');
    });
    
    scoreText.setVisible(false);
}

// Send experimental data to Google Forms for data collection
function sendDataToGoogleForms(data) {
    // Use the form submission URL (not the viewform URL)
    const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSemIGiEwVexGMI-77KgCMupXNKlPdr3evuPOcApQe93Fqjv8Q/formResponse';
    
    // Replace these with your actual Google Form field IDs (after removing timestamp field)
    const FIELD_IDS = {
        finalThreshold: 'entry.1091417814', // Replace with actual ID
        thresholdSD: 'entry.1415284933',    // Replace with actual ID
        totalTrials: 'entry.1267844442',    // Replace with actual ID
        hitRate: 'entry.1230961981',        // Replace with actual ID
        trialData: 'entry.1381897488'       // Replace with actual ID
        // Removed timestamp - Google Forms adds this automatically
    };
    
    // Create form data
    const formData = new FormData();
    formData.append(FIELD_IDS.finalThreshold, data.finalThreshold);
    formData.append(FIELD_IDS.thresholdSD, data.thresholdSD);
    formData.append(FIELD_IDS.totalTrials, data.totalTrials.toString());
    formData.append(FIELD_IDS.hitRate, data.hitRate + '%');
    formData.append(FIELD_IDS.trialData, JSON.stringify(data.trialData));
    // Removed timestamp - Google Forms adds this automatically
    
    // Submit to Google Forms
    fetch(GOOGLE_FORM_URL, {
        method: 'POST',
        body: formData,
        mode: 'no-cors' // This is important for Google Forms
    })
    .then(response => {
        console.log('Data sent to Google Forms successfully');
    })
    .catch(error => {
        console.error('Error sending data to Google Forms:', error);
        // No fallback needed - if Google Forms fails, we lose the data
        // The results page still works via URL parameters
    });
}

// ============================================================================
//  GAME INITIALIZATION
// ============================================================================
// Start the Phaser game
const game = new Phaser.Game(config);

