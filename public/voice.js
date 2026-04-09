// Voice Input Script for HandOff
const micBtn = document.getElementById('micBtn');
const micIcon = document.getElementById('micIcon');
const status = document.getElementById('status');
const transcript = document.getElementById('transcript');
const sendBtn = document.getElementById('sendBtn');
const cancelBtn = document.getElementById('cancelBtn');

let recognition = null;
let isListening = false;
let finalTranscript = '';

// Check for Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  status.textContent = 'Speech recognition not supported';
  micBtn.disabled = true;
} else {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    status.textContent = '🎙️ Listening... Speak now';
    micIcon.innerHTML = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>';
  };
  
  recognition.onresult = (event) => {
    let interimTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript + ' ';
      } else {
        interimTranscript += result[0].transcript;
      }
    }
    
    const displayText = finalTranscript + interimTranscript;
    if (displayText.trim()) {
      transcript.textContent = displayText;
      transcript.classList.remove('empty');
      sendBtn.disabled = false;
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Speech error:', event.error);
    if (event.error === 'not-allowed') {
      status.textContent = '❌ Microphone access denied';
    } else {
      status.textContent = 'Error: ' + event.error;
    }
    stopListening();
  };
  
  recognition.onend = () => {
    if (isListening) {
      // Auto-restart if still in listening mode
      try {
        recognition.start();
      } catch (e) {
        stopListening();
      }
    }
  };
}

function startListening() {
  finalTranscript = '';
  transcript.textContent = 'Your speech will appear here...';
  transcript.classList.add('empty');
  sendBtn.disabled = true;
  
  try {
    recognition.start();
    console.log('Recognition started');
  } catch (e) {
    console.error('Failed to start:', e);
    status.textContent = 'Error: ' + e.message;
  }
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove('listening');
  status.textContent = 'Click the mic to start speaking';
  micIcon.innerHTML = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V19h4v2H8v-2h4v-3.07z"/>';
  
  try {
    recognition.stop();
  } catch (e) {}
}

micBtn.addEventListener('click', async () => {
  console.log('Mic button clicked, isListening:', isListening);
  
  if (isListening) {
    stopListening();
  } else {
    // Request mic permission first if needed
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Got mic stream:', stream);
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
      startListening();
    } catch (err) {
      console.error('Mic permission error:', err);
      status.textContent = '❌ Microphone access denied. Please allow in browser settings.';
    }
  }
});

sendBtn.addEventListener('click', async () => {
  const text = finalTranscript.trim() || transcript.textContent.trim();
  if (text && text !== 'Your speech will appear here...') {
    // Stop recognition first so it doesn't interfere
    if (isListening) stopListening();

    // Send to parent extension — await to ensure delivery before closing
    try {
      await chrome.runtime.sendMessage({ 
        type: 'VOICE_INPUT', 
        payload: { text } 
      });
    } catch (e) {
      console.warn('Send message error (non-critical):', e);
    }
    // Small delay to ensure sidepanel receives and processes the message
    setTimeout(() => window.close(), 150);
  }
});

cancelBtn.addEventListener('click', () => {
  window.close();
});

// Request mic permission on load
if (recognition) {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      console.log('Mic permission granted');
      stream.getTracks().forEach(track => track.stop());
      status.textContent = 'Mic ready - click to start';
      // Auto-start after permission
      setTimeout(() => {
        if (!isListening) {
          startListening();
        }
      }, 300);
    })
    .catch((err) => {
      console.error('Mic permission error:', err);
      status.textContent = '❌ Please allow microphone access';
    });
}
