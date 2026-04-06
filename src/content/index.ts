// Content script - runs in the context of web pages
// Executes actions on behalf of the agent

interface ActionPayload {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'press';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  target?: string;
}

// Track cursor position for overlay
let lastCursorX = 0;
let lastCursorY = 0;

// Track cursor movement
document.addEventListener('mousemove', (e) => {
  lastCursorX = e.clientX;
  lastCursorY = e.clientY;
});

console.log('[HandOff] Content script loaded');

// Listen for messages from background worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[HandOff] Content script received:', message.type);
  
  if (message.type === 'PING') {
    sendResponse({ success: true, loaded: true });
    return true;
  }

  if (message.type === 'EXECUTE_ACTION') {
    executeAction(message.payload as ActionPayload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => {
        console.error('[HandOff] Action error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_PAGE_INFO') {
    sendResponse({
      success: true,
      url: window.location.href,
      title: document.title,
      scrollPosition: { x: window.scrollX, y: window.scrollY },
    });
    return true;
  }

  if (message.type === 'GET_CURSOR_POSITION') {
    sendResponse({
      success: true,
      x: lastCursorX,
      y: lastCursorY,
    });
    return true;
  }

  if (message.type === 'GET_SALIENT_ELEMENTS') {
    const elements = findSalientElements();
    sendResponse({
      success: true,
      elements,
    });
    return true;
  }
});

// Find search bars, command inputs, and other important interactive elements
function findSalientElements(): Array<{type: string, rect: DOMRect, label: string}> {
  const salient: Array<{type: string, rect: DOMRect, label: string}> = [];
  
  // Google-specific search bar detection (handles dynamic DOM)
  const googleSearch = detectGoogleSearchBar();
  if (googleSearch) {
    salient.push(googleSearch);
  }
  
  // Search bars - multiple selectors for different sites
  const searchSelectors = [
    'input[type="search"]',
    'input[name="q"]',
    'textarea[name="q"]', // Google sometimes uses textarea
    'input[name="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="find" i]',
    'input[placeholder*="looking for" i]',
    'input[aria-label*="search" i]',
    'input[role="searchbox"]',
    'input[role="combobox"][aria-label*="search" i]',
    '[data-testid="SearchBox_Search_Input"]', // Twitter
    '.search-global-typeahead__input', // LinkedIn
    'input.gLFyf', // Google search input class
  ];
  
  for (const selector of searchSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10 && rect.top < window.innerHeight && rect.top > 0) {
          // Avoid duplicates
          const isDuplicate = salient.some(s => 
            Math.abs(s.rect.x - rect.x) < 10 && Math.abs(s.rect.y - rect.y) < 10
          );
          if (!isDuplicate) {
            salient.push({
              type: 'search',
              rect,
              label: (el as HTMLInputElement).placeholder || (el as HTMLInputElement).ariaLabel || 'Search bar',
            });
          }
        }
      });
    } catch (e) {
      // Selector might be invalid on some pages
    }
  }
  
  // Primary action buttons
  const buttonSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  
  for (const selector of buttonSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 20 && rect.height > 10 && rect.top < window.innerHeight) {
          salient.push({
            type: 'button',
            rect,
            label: (el as HTMLElement).textContent?.slice(0, 30) || 'Button',
          });
        }
      });
    } catch (e) {}
  }
  
  return salient;
}

// Google-specific search bar detection (handles shadow DOM and dynamic loading)
function detectGoogleSearchBar(): {type: string, rect: DOMRect, label: string} | null {
  // Try multiple selectors for Google's search bar
  const selectors = [
    'input[name="q"]',
    'textarea[name="q"]',
    'input.gLFyf',
    'textarea.gLFyf',
    '[aria-label="Search"]',
    '[aria-label="Google Search"]',
    'input[title="Search"]',
  ];
  
  for (const selector of selectors) {
    try {
      const input = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      if (input) {
        const rect = input.getBoundingClientRect();
        // Verify it's visible and reasonably sized
        if (rect.width > 100 && rect.height > 20 && rect.top > 0 && rect.top < window.innerHeight) {
          console.log('[HandOff] Found Google search bar:', selector, rect);
          return {
            type: 'search',
            rect,
            label: 'Google Search',
          };
        }
      }
    } catch (e) {}
  }
  
  return null;
}

async function executeAction(action: ActionPayload): Promise<void> {
  switch (action.type) {
    case 'click':
      await performClick(action.x!, action.y!);
      break;
    case 'type':
      await performType(action.text!);
      break;
    case 'scroll':
      await performScroll(action.direction || 'down');
      break;
    case 'press':
      await performKeyPress(action.key!);
      break;
    case 'wait':
      await sleep(1000);
      break;
    default:
      console.warn('[HandOff] Unknown action type:', action.type);
  }
}

async function performClick(x: number, y: number): Promise<void> {
  // Show visual cursor at click position
  showClickCursor(x, y);
  
  // Find element at coordinates
  let element = document.elementFromPoint(x, y) as HTMLElement;
  
  if (!element) {
    console.warn('[HandOff] No element found at coordinates:', x, y);
    throw new Error(`No element found at coordinates (${x}, ${y})`);
  }
  
  console.log('[HandOff] Found element at coords:', element.tagName, element.className);

  // Try to find clickable parent if we hit a non-interactive element
  const clickableElement = findClickableElement(element);
  if (clickableElement && clickableElement !== element) {
    console.log('[HandOff] Using clickable parent:', clickableElement.tagName);
    element = clickableElement;
  }

  console.log('[HandOff] Clicking element:', element.tagName, element.textContent?.slice(0, 50));

  // Highlight element briefly
  highlightElement(element);

  // Get center of element for accurate click
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  // Focus first if it's focusable
  if (element instanceof HTMLInputElement || 
      element instanceof HTMLTextAreaElement || 
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('role') === 'textbox' ||
      element.getAttribute('role') === 'searchbox') {
    element.focus();
    console.log('[HandOff] Focused element');
    await sleep(50);
  }

  // Dispatch pointer events (more modern, better compatibility)
  const pointerEvents = ['pointerdown', 'pointerup'];
  for (const eventType of pointerEvents) {
    const event = new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    });
    element.dispatchEvent(event);
    await sleep(10);
  }

  // Dispatch mouse events
  const mouseEvents = ['mousedown', 'mouseup', 'click'];
  for (const eventType of mouseEvents) {
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: eventType === 'mousedown' ? 1 : 0,
    });
    element.dispatchEvent(event);
    await sleep(10);
  }

  // Native click as fallback
  if (typeof element.click === 'function') {
    element.click();
  }

  console.log('[HandOff] Click completed on:', element.tagName);
}

function findClickableElement(element: HTMLElement): HTMLElement {
  // Walk up the DOM to find a clickable element
  let current: HTMLElement | null = element;
  const clickableTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'];
  const clickableRoles = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem'];
  
  while (current) {
    if (clickableTags.includes(current.tagName)) {
      return current;
    }
    const role = current.getAttribute('role');
    if (role && clickableRoles.includes(role)) {
      return current;
    }
    if (current.onclick || current.getAttribute('onclick')) {
      return current;
    }
    if (current.getAttribute('tabindex') === '0') {
      return current;
    }
    current = current.parentElement;
  }
  
  return element; // Return original if no better match
}

async function performType(text: string): Promise<void> {
  const activeElement = document.activeElement as HTMLElement;
  
  if (!activeElement) {
    console.warn('[HandOff] No active element to type into');
    return;
  }

  // Clear existing content if it's an input
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    activeElement.value = '';
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Type character by character for realistic input
  for (const char of text) {
    // KeyboardEvent
    const keydownEvent = new KeyboardEvent('keydown', {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    });
    activeElement.dispatchEvent(keydownEvent);

    // Input event
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      activeElement.value += char;
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (activeElement.isContentEditable) {
      document.execCommand('insertText', false, char);
    }

    const keyupEvent = new KeyboardEvent('keyup', {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    });
    activeElement.dispatchEvent(keyupEvent);

    await sleep(30 + Math.random() * 50); // Realistic typing speed
  }

  // Trigger change event
  activeElement.dispatchEvent(new Event('change', { bubbles: true }));
}

async function performScroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  const scrollAmount = 400;
  
  switch (direction) {
    case 'up':
      window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
      break;
    case 'down':
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      break;
    case 'left':
      window.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
      break;
    case 'right':
      window.scrollBy({ left: scrollAmount, behavior: 'smooth' });
      break;
  }
  
  await sleep(500); // Wait for scroll animation
}

function highlightElement(element: HTMLElement): void {
  const originalOutline = element.style.outline;
  const originalTransition = element.style.transition;
  const originalBoxShadow = element.style.boxShadow;
  
  element.style.transition = 'all 0.2s ease';
  element.style.outline = '3px solid #a855f7';
  element.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.6)';
  
  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.boxShadow = originalBoxShadow;
    element.style.transition = originalTransition;
  }, 800);
}

// Show visual cursor at click position
function showClickCursor(x: number, y: number): void {
  // Remove existing cursor if any
  const existing = document.getElementById('handoff-cursor');
  if (existing) existing.remove();

  const cursor = document.createElement('div');
  cursor.id = 'handoff-cursor';
  cursor.style.cssText = `
    position: fixed;
    left: ${x - 15}px;
    top: ${y - 15}px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(168, 85, 247, 0.8) 0%, rgba(168, 85, 247, 0) 70%);
    border: 2px solid #a855f7;
    pointer-events: none;
    z-index: 999999;
    animation: handoff-pulse 0.6s ease-out forwards;
  `;
  
  // Add animation style if not exists
  if (!document.getElementById('handoff-cursor-style')) {
    const style = document.createElement('style');
    style.id = 'handoff-cursor-style';
    style.textContent = `
      @keyframes handoff-pulse {
        0% { transform: scale(0.5); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.8; }
        100% { transform: scale(1); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(cursor);
  
  setTimeout(() => cursor.remove(), 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performKeyPress(key: string): Promise<void> {
  const activeElement = document.activeElement as HTMLElement || document.body;
  
  console.log('[HandOff] Pressing key:', key, 'on element:', activeElement.tagName);

  // Map common key names to KeyboardEvent key values
  const keyMap: Record<string, { key: string; code: string }> = {
    'enter': { key: 'Enter', code: 'Enter' },
    'tab': { key: 'Tab', code: 'Tab' },
    'escape': { key: 'Escape', code: 'Escape' },
    'esc': { key: 'Escape', code: 'Escape' },
    'backspace': { key: 'Backspace', code: 'Backspace' },
    'delete': { key: 'Delete', code: 'Delete' },
    'arrowup': { key: 'ArrowUp', code: 'ArrowUp' },
    'arrowdown': { key: 'ArrowDown', code: 'ArrowDown' },
    'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft' },
    'arrowright': { key: 'ArrowRight', code: 'ArrowRight' },
    'space': { key: ' ', code: 'Space' },
  };

  const normalizedKey = key.toLowerCase();
  const keyInfo = keyMap[normalizedKey] || { key: key, code: `Key${key.toUpperCase()}` };

  // Dispatch keydown
  const keydownEvent = new KeyboardEvent('keydown', {
    key: keyInfo.key,
    code: keyInfo.code,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  activeElement.dispatchEvent(keydownEvent);

  await sleep(50);

  // Dispatch keypress (for Enter specifically, some sites need this)
  if (keyInfo.key === 'Enter') {
    const keypressEvent = new KeyboardEvent('keypress', {
      key: keyInfo.key,
      code: keyInfo.code,
      bubbles: true,
      cancelable: true,
      view: window,
    });
    activeElement.dispatchEvent(keypressEvent);
    await sleep(50);
  }

  // Dispatch keyup
  const keyupEvent = new KeyboardEvent('keyup', {
    key: keyInfo.key,
    code: keyInfo.code,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  activeElement.dispatchEvent(keyupEvent);

  // For Enter on forms, also try to submit the form
  if (keyInfo.key === 'Enter') {
    const form = activeElement.closest('form');
    if (form) {
      console.log('[HandOff] Submitting form via Enter');
      // Try to find and click a submit button first
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
      if (submitBtn) {
        submitBtn.click();
      } else {
        // Fallback to form submit
        if (form.requestSubmit) {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }
    }
  }

  console.log('[HandOff] Key press completed:', key);
}

// Expose utilities for debugging
(window as unknown as { handoff: object }).handoff = {
  click: performClick,
  type: performType,
  scroll: performScroll,
};
