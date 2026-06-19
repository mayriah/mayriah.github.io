/* ==========================================================================
   FocusFlow - Pomodoro Timer Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Timer settings
  let focusDuration = parseInt(localStorage.getItem('focusflow-duration') || '25', 10) * 60;
  let timeRemaining = focusDuration;
  let timerInterval = null;
  let timerState = 'idle'; // idle, running, paused
  
  // Drift prevention variables
  let startTime = null;
  let timeLeftAtStart = focusDuration;

  // DOM Elements
  const timerDigits = document.getElementById('timer-digits');
  const timerStatusHint = document.getElementById('timer-status-hint');
  const modeLabel = document.getElementById('mode-label');
  const modePulse = document.getElementById('mode-status-pulse');
  const progressBar = document.getElementById('progress-bar');
  
  // Control Buttons
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const resetBtn = document.getElementById('reset-btn');
  
  // Duration Selector Elements
  const durationSelector = document.getElementById('duration-selector');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const customMinutesInput = document.getElementById('custom-minutes');
  
  // Settings & Status
  const sessionsCountLabel = document.getElementById('sessions-completed');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const sunIcon = document.getElementById('sun-icon');
  const moonIcon = document.getElementById('moon-icon');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundOnIcon = document.getElementById('sound-on-icon');
  const soundOffIcon = document.getElementById('sound-off-icon');
  const toast = document.getElementById('toast');

  // Web Audio Context for synthesized chime
  let audioCtx = null;
  let isSoundEnabled = localStorage.getItem('focusflow-sound') !== 'false';
  let completedSessions = parseInt(localStorage.getItem('focusflow-sessions') || '0', 10);

  // SVG Progress Ring Parameters
  // Circle radius r=100. Perimeter = 2 * PI * r = 628.318
  const RING_CIRCUMFERENCE = 628.318;
  progressBar.style.strokeDasharray = RING_CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = 0;

  // ==========================================================================
  // Initialization & Theme Handling
  // ==========================================================================

  // Initialize sound settings UI
  updateSoundIcon();

  // Initialize Sessions UI
  updateSessionsLabel();

  // Initialize Theme (Detect system default or storage)
  const savedTheme = localStorage.getItem('focusflow-theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  
  setTheme(initialTheme);

  // Theme Toggle Listener
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  });

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('focusflow-theme', theme);
    
    if (theme === 'dark') {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }

  // Sound Toggle Listener
  soundToggleBtn.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    localStorage.setItem('focusflow-sound', isSoundEnabled);
    updateSoundIcon();
    
    // Play a gentle feedback tone when enabling audio context
    if (isSoundEnabled) {
      initAudioContext();
      playGentleTone(440, 'sine', 0.08, 0.2); // Soft A4 tone
    }
  });

  function updateSoundIcon() {
    if (isSoundEnabled) {
      soundOnIcon.classList.remove('hidden');
      soundOffIcon.classList.add('hidden');
    } else {
      soundOnIcon.classList.add('hidden');
      soundOffIcon.classList.remove('hidden');
    }
  }

  function updateSessionsLabel() {
    sessionsCountLabel.textContent = `Sessions completed: ${completedSessions}`;
  }

  // ==========================================================================
  // Duration Selector Initialization & Event Handlers
  // ==========================================================================

  // Initialize Duration Selector UI
  initDurationUI();

  function initDurationUI() {
    const currentMinutes = focusDuration / 60;
    let isPresetFound = false;

    presetButtons.forEach(btn => {
      const minutesAttr = parseInt(btn.getAttribute('data-minutes'), 10);
      if (minutesAttr === currentMinutes) {
        btn.classList.add('active');
        isPresetFound = true;
      } else {
        btn.classList.remove('active');
      }
    });

    if (isPresetFound) {
      customMinutesInput.value = '';
      customMinutesInput.classList.remove('active');
    } else {
      customMinutesInput.value = currentMinutes;
      customMinutesInput.classList.add('active');
    }
  }

  // Preset Button Click Handlers
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (timerState !== 'idle') return;
      
      const minutes = parseInt(btn.getAttribute('data-minutes'), 10);
      focusDuration = minutes * 60;
      localStorage.setItem('focusflow-duration', minutes);
      
      initDurationUI();
      resetTimer();
    });
  });

  // Custom Minutes Input Handler
  customMinutesInput.addEventListener('input', (e) => {
    if (timerState !== 'idle') return;
    
    let minutesVal = parseInt(e.target.value, 10);
    
    if (isNaN(minutesVal) || minutesVal <= 0) {
      return; // Let user complete typing
    }
    
    if (minutesVal > 180) {
      minutesVal = 180;
      customMinutesInput.value = 180;
    }
    
    focusDuration = minutesVal * 60;
    localStorage.setItem('focusflow-duration', minutesVal);
    
    presetButtons.forEach(btn => btn.classList.remove('active'));
    customMinutesInput.classList.add('active');
    
    timeRemaining = focusDuration;
    updateDisplay();
  });

  // Clamp on blur to guarantee valid final number
  customMinutesInput.addEventListener('blur', (e) => {
    if (timerState !== 'idle') return;
    
    let minutesVal = parseInt(e.target.value, 10);
    if (isNaN(minutesVal) || minutesVal <= 0) {
      minutesVal = 25; // default fallback
    }
    
    focusDuration = minutesVal * 60;
    localStorage.setItem('focusflow-duration', minutesVal);
    initDurationUI();
    resetTimer();
  });

  // ==========================================================================
  // Web Audio Chime Synthesis
  // ==========================================================================

  function initAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Synthesize a calming bell-chime tone using simple oscillators and amplitude envelope
  function playGentleTone(frequency, type, volume, duration, startTimeOffset = 0) {
    if (!isSoundEnabled) return;
    
    initAudioContext();
    
    setTimeout(() => {
      try {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        
        // Envelope: Instant attack, exponential decay for a organic bell feel
        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch (e) {
        console.error('Audio synthesis failed:', e);
      }
    }, startTimeOffset * 1000);
  }

  // Calming double chime: chord C5 then E5
  function playSuccessChime() {
    // Tone 1: C5 (523.25 Hz)
    playGentleTone(523.25, 'sine', 0.15, 1.2, 0);
    // Tone 2: E5 (659.25 Hz) after 150ms
    playGentleTone(659.25, 'sine', 0.12, 1.5, 0.15);
  }

  // ==========================================================================
  // Timer State & Ticking Controls
  // ==========================================================================

  function updateDisplay() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');
    
    const timeString = `${formattedMinutes}:${formattedSeconds}`;
    
    // Update central text digits
    timerDigits.textContent = timeString;
    
    // Update HTML browser tab title to reflect timer in real time
    if (timerState === 'running') {
      document.title = `(${timeString}) FocusFlow`;
    } else if (timerState === 'paused') {
      document.title = `[Paused] FocusFlow`;
    } else {
      document.title = `FocusFlow | Calming Study Focus Timer`;
    }

    // Update Progress Ring
    const fraction = timeRemaining / focusDuration;
    // Offset calculation: full progress is offset = 0, empty is offset = RING_CIRCUMFERENCE
    progressBar.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
  }

  function tick() {
    if (timerState !== 'running') return;

    // Use absolute time delta to avoid background tab sleep drift
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    timeRemaining = Math.max(0, timeLeftAtStart - elapsedSeconds);

    updateDisplay();

    if (timeRemaining <= 0) {
      handleTimerComplete();
    }
  }

  function startTimer() {
    initAudioContext();
    timerState = 'running';
    
    // Set timing anchors for drift prevention
    startTime = Date.now();
    timeLeftAtStart = timeRemaining;

    // Set high frequency checking interval (runs 4 times a second for snappy UI responsiveness)
    timerInterval = setInterval(tick, 250);

    // Update controls buttons
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    durationSelector.classList.add('disabled');
    
    // Visual indicators
    timerDigits.classList.add('ticking');
    modePulse.classList.add('active');
    timerStatusHint.textContent = 'Stay focused...';
    
    updateDisplay();
  }

  function pauseTimer() {
    if (timerState !== 'running') return;
    
    timerState = 'paused';
    clearInterval(timerInterval);
    timerInterval = null;

    // Save current time for when we resume
    timeLeftAtStart = timeRemaining;

    // Update buttons
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.querySelector('span').textContent = 'Resume';
    
    // Visual indicators
    timerDigits.classList.remove('ticking');
    modePulse.classList.remove('active');
    timerStatusHint.textContent = 'Timer paused';
    
    updateDisplay();
  }

  function resetTimer() {
    timerState = 'idle';
    clearInterval(timerInterval);
    timerInterval = null;
    
    timeRemaining = focusDuration;
    
    // Update buttons
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.querySelector('span').textContent = 'Start';
    
    // Duration controls enabled
    durationSelector.classList.remove('disabled');
    
    // Visual indicators
    timerDigits.classList.remove('ticking');
    modePulse.classList.remove('active');
    timerStatusHint.textContent = 'Ready to focus';
    
    updateDisplay();
  }

  function handleTimerComplete() {
    timerState = 'idle';
    clearInterval(timerInterval);
    timerInterval = null;

    // Increment completed count
    completedSessions++;
    localStorage.setItem('focusflow-sessions', completedSessions);
    updateSessionsLabel();

    // Reset countdown variables
    timeRemaining = focusDuration;
    
    // Re-adjust controls
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    startBtn.querySelector('span').textContent = 'Start';
    durationSelector.classList.remove('disabled');
    
    timerDigits.classList.remove('ticking');
    modePulse.classList.remove('active');
    timerStatusHint.textContent = 'Focus session finished!';

    updateDisplay();

    // Trigger Audio Alert
    playSuccessChime();

    // Trigger Toast Notification Banner
    showToastNotification();
  }

  // ==========================================================================
  // Notifications / Toast
  // ==========================================================================

  function showToastNotification() {
    // Reset browser page visibility checks and display toast
    toast.classList.remove('hidden');
    
    // Send standard HTML5 desktop notification if permission exists
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Session Completed! 🌟', {
        body: 'Terrific job! Take a short break now.',
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23557a63" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      });
    }

    // Hide popup after 5 seconds
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 5000);
  }

  // Request browser Notification permissions early on user start interaction
  startBtn.addEventListener('click', () => {
    if (timerState !== 'running') {
      startTimer();
      
      // Prompt for notifications if supported and not yet decided
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  });

  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);

  // Initialize screen display with default settings
  updateDisplay();
});
