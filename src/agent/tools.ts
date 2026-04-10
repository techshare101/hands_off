// 🤖 AGENT RUNTIME AGENT — Tool Registry for Hashbrown-style agent
// Each tool is a discrete capability the agent can invoke

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    console.log(`[HandOff] Registered tool: ${tool.name}`);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }
    try {
      return await tool.execute(params);
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Tool execution failed' 
      };
    }
  }
}

// Robust content script handshake with retries
async function waitForContentScript(tabId: number, maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (response?.success || response?.ok) {
        console.log(`[Tools] Content script ready (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // Not ready yet
    }
    
    // Wait before retry
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

// Helper to ensure content script is loaded
async function ensureContentScript(tabId: number): Promise<boolean> {
  // First try ping with retries
  if (await waitForContentScript(tabId, 2)) {
    return true;
  }

  // Content script not loaded, inject it
  console.log('[Tools] Injecting content script into tab', tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/index.js'],
    });
    
    // Wait for script to initialize and verify with retries
    await new Promise(resolve => setTimeout(resolve, 300));
    return await waitForContentScript(tabId, 3);
  } catch (error) {
    console.error('[Tools] Failed to inject content script:', error);
    return false;
  }
}

// Send message to content script with timeout
async function sendToContentScript(tabId: number, message: unknown, timeoutMs = 10000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Content script timeout - page may still be loading'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message)
      .then(response => {
        clearTimeout(timeout);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

// Burn cursor and salient element overlays into screenshot using fetch + createImageBitmap (works in service workers)
async function burnOverlaysIntoScreenshot(
  dataUrl: string, 
  cursorPos: {x: number, y: number}, 
  salientElements: Array<{type: string, rect: {x: number, y: number, width: number, height: number}, label: string}>
): Promise<string> {
  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Create image bitmap (works in service workers)
    const imageBitmap = await createImageBitmap(blob);
    
    // Create canvas
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return dataUrl;
    }

    // Draw original screenshot
    ctx.drawImage(imageBitmap, 0, 0);

    // Draw salient elements (gold outline for search bars)
    for (const element of salientElements) {
      const { rect, label, type } = element;
      
      // Gold outline for search bars, blue for buttons
      ctx.strokeStyle = type === 'search' ? 'rgba(255, 215, 0, 0.9)' : 'rgba(59, 130, 246, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      
      // Label above element
      ctx.font = 'bold 12px monospace';
      const labelText = type === 'search' ? `SEARCH: ${label}` : label;
      
      // Background for label
      const textMetrics = ctx.measureText(labelText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(rect.x, rect.y - 18, textMetrics.width + 8, 16);
      
      ctx.fillStyle = type === 'search' ? '#FFD700' : '#3B82F6';
      ctx.fillText(labelText, rect.x + 4, rect.y - 6);
    }

    // Draw cursor (cyan circle with crosshair)
    if (cursorPos.x > 0 || cursorPos.y > 0) {
      // Outer glow
      ctx.beginPath();
      ctx.arc(cursorPos.x, cursorPos.y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
      ctx.fill();
      
      // Inner circle
      ctx.beginPath();
      ctx.arc(cursorPos.x, cursorPos.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0, 255, 255, 0.9)';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Crosshair
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorPos.x - 15, cursorPos.y);
      ctx.lineTo(cursorPos.x + 15, cursorPos.y);
      ctx.moveTo(cursorPos.x, cursorPos.y - 15);
      ctx.lineTo(cursorPos.x, cursorPos.y + 15);
      ctx.stroke();
      
      // Cursor label
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(cursorPos.x + 10, cursorPos.y - 20, 60, 14);
      ctx.fillStyle = '#00FFFF';
      ctx.fillText('CURSOR', cursorPos.x + 14, cursorPos.y - 9);
    }

    // Convert back to data URL
    const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(dataUrl);
      reader.readAsDataURL(outputBlob);
    });
  } catch (error) {
    console.error('[Tools] Failed to burn overlays:', error);
    return dataUrl; // Return original on error
  }
}

// Default tools for computer use
export function createDefaultTools(tabId: number): ToolRegistry {
  const registry = new ToolRegistry();

  // 👁️ SEE SCREEN - Capture screenshot and detect salient elements
  registry.register({
    name: 'seeScreen',
    description: 'Capture a screenshot and detect interactive elements',
    execute: async () => {
      try {
        // Capture raw screenshot first - this is the critical path
        const dataUrl = await chrome.tabs.captureVisibleTab({
          format: 'jpeg',
          quality: 70,
        });

        // Get salient elements from content script (with short timeout, non-blocking)
        let salientElements: Array<{type: string, rect: {x: number, y: number, width: number, height: number}, label: string}> = [];
        
        try {
          const contentScriptReady = await ensureContentScript(tabId);
          if (contentScriptReady) {
            const salientResponse = await sendToContentScript(tabId, { type: 'GET_SALIENT_ELEMENTS' }, 1500) as {success: boolean, elements: typeof salientElements};
            if (salientResponse?.success && salientResponse.elements) {
              salientElements = salientResponse.elements;
            }
          }
        } catch (e) {
          // Non-critical - continue without salient elements
          console.log('[Tools] Salient element detection skipped:', e);
        }

        // Return screenshot with element metadata (no overlay burning - too slow)
        return { 
          success: true, 
          data: { 
            screenshot: dataUrl,
            salientElements: salientElements.map(e => ({
              type: e.type,
              label: e.label,
              x: Math.round(e.rect.x + e.rect.width / 2),
              y: Math.round(e.rect.y + e.rect.height / 2),
            })),
          } 
        };
      } catch (error) {
        console.error('[Tools] Screenshot error:', error);
        return { success: false, error: 'Failed to capture screenshot' };
      }
    },
  });

  // 🖱️ CLICK
  registry.register({
    name: 'click',
    description: 'Click at specific coordinates',
    execute: async (params) => {
      const { x, y, target } = params as { x: number; y: number; target?: string };
      
      // Check if we're on a restricted page (only chrome:// and about: pages)
      let currentUrl = '';
      try {
        const tab = await chrome.tabs.get(tabId);
        currentUrl = tab.url || '';
        console.log('[Tools] Click on URL:', currentUrl);
        
        // Only block truly restricted pages - NOT regular websites
        if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://') || currentUrl.startsWith('about:')) {
          return { 
            success: false, 
            error: `Cannot click on browser page (${currentUrl}). Navigate to a website first.` 
          };
        }
        
        // Empty URL means new tab - also restricted
        if (!currentUrl || currentUrl === '') {
          return { 
            success: false, 
            error: 'Cannot click on empty tab. Navigate to a website first.' 
          };
        }
      } catch (e) {
        console.error('[Tools] Could not get tab info:', e);
        // Don't block - try to click anyway
      }

      try {
        // Ensure content script is loaded with retries
        let scriptReady = await ensureContentScript(tabId);
        if (!scriptReady) {
          // Retry once after a short delay
          await new Promise(r => setTimeout(r, 500));
          scriptReady = await ensureContentScript(tabId);
        }
        
        if (scriptReady) {
          // Try via content script first
          try {
            const response = await sendToContentScript(tabId, {
              type: 'EXECUTE_ACTION',
              payload: { type: 'click', x, y, target },
            }, 5000) as { success: boolean; error?: string };
            
            if (response?.success) {
              return { success: true, data: { clicked: { x, y, target } } };
            }
          } catch (e) {
            console.log('[Tools] Content script click failed, trying direct injection');
          }
        }
        
        // Fallback: Direct script injection for click with proper mouse events
        console.log('[Tools] Using direct script injection for click at', x, y);
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (clickX: number, clickY: number, targetHint: string | undefined) => {
            console.log('[HandOff Direct] Click at', clickX, clickY, 'target hint:', targetHint);
            
            // First, try to find element at coordinates
            let el = document.elementFromPoint(clickX, clickY) as HTMLElement;
            
            // If we have a target hint, try to find a better match nearby
            if (targetHint && el) {
              // Look for clickable parent (link or button)
              let clickableParent = el.closest('a, button, [role="button"], [onclick]') as HTMLElement;
              if (clickableParent) {
                el = clickableParent;
                console.log('[HandOff Direct] Found clickable parent:', el.tagName, el.textContent?.slice(0, 50));
              }
              
              // If target hint mentions a link text, try to find it
              const targetLower = targetHint.toLowerCase();
              // Extract keywords from target hint
              const keywords = targetLower.split(/[\s,]+/).filter(w => w.length > 2);
              
              const links = document.querySelectorAll('a[href]');
              let bestMatch: HTMLAnchorElement | null = null;
              let bestDistance = Infinity;
              
              for (const link of links) {
                const linkEl = link as HTMLAnchorElement;
                const text = linkEl.textContent?.toLowerCase() || '';
                const href = linkEl.href?.toLowerCase() || '';
                
                // Check if any keyword matches
                const matches = keywords.some(kw => text.includes(kw) || href.includes(kw));
                if (matches) {
                  const rect = linkEl.getBoundingClientRect();
                  // Skip if not visible
                  if (rect.width === 0 || rect.height === 0) continue;
                  
                  const distance = Math.sqrt(
                    Math.pow(clickX - (rect.left + rect.width/2), 2) + 
                    Math.pow(clickY - (rect.top + rect.height/2), 2)
                  );
                  
                  // Find the closest matching link within 300px
                  if (distance < 300 && distance < bestDistance) {
                    bestMatch = linkEl;
                    bestDistance = distance;
                    console.log('[HandOff Direct] Found candidate link:', linkEl.href, 'distance:', distance);
                  }
                }
              }
              
              if (bestMatch) {
                el = bestMatch;
                console.log('[HandOff Direct] Using best matching link:', bestMatch.href);
              }
            }
            
            console.log('[HandOff Direct] Final click target:', el?.tagName, el?.className);
            
            if (el) {
              // For links, navigate directly to avoid click interception
              if (el.tagName === 'A') {
                const href = (el as HTMLAnchorElement).href;
                console.log('[HandOff Direct] Navigating to link:', href);
                // Use location.href for reliable navigation
                if (href && !href.startsWith('javascript:')) {
                  window.location.href = href;
                  return { success: true, element: 'A', href, navigated: true };
                }
                // Fallback to click
                el.click();
                return { success: true, element: 'A', href };
              }
              
              // Dispatch proper mouse events sequence
              const rect = el.getBoundingClientRect();
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              
              const eventOptions = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY,
                screenX: centerX,
                screenY: centerY,
              };
              
              el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
              el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
              el.dispatchEvent(new MouseEvent('click', eventOptions));
              
              // Focus for input elements
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable')) {
                (el as HTMLElement).focus();
              }
              
              return { success: true, element: el.tagName, className: el.className };
            }
            return { success: false, reason: 'No element at coordinates' };
          },
          args: [x, y, target],
        });
        
        console.log('[Tools] Direct click result:', result);
        return { success: true, data: { clicked: { x, y, target }, method: 'direct', result: result?.[0]?.result } };
      } catch (error) {
        console.error('[Tools] Click error:', error);
        return { success: false, error: 'Click failed - ' + (error instanceof Error ? error.message : 'unknown error') };
      }
    },
  });

  // ⌨️ TYPE
  registry.register({
    name: 'type',
    description: 'Type text into the focused element',
    execute: async (params) => {
      const { text } = params as { text: string };
      try {
        // Try content script first
        const scriptReady = await ensureContentScript(tabId);
        if (scriptReady) {
          try {
            const response = await sendToContentScript(tabId, {
              type: 'EXECUTE_ACTION',
              payload: { type: 'type', text },
            }, 5000) as { success: boolean; error?: string };
            if (response?.success) {
              return { success: true, data: { typed: text } };
            }
          } catch (e) {
            console.log('[Tools] Content script type failed, trying direct injection');
          }
        }
        
        // Fallback: Direct script injection for typing using execCommand and InputEvent
        console.log('[Tools] Using direct script injection for type:', text);
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (inputText: string) => {
            console.log('[HandOff Direct] Typing:', inputText);
            
            // Find the target element
            let targetEl: HTMLInputElement | HTMLTextAreaElement | null = null;
            
            // First try: active element if it's an input
            const activeEl = document.activeElement as HTMLElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
              targetEl = activeEl as HTMLInputElement | HTMLTextAreaElement;
            }
            
            // Second try: Google search bar
            if (!targetEl) {
              targetEl = document.querySelector('textarea[name="q"], input[name="q"], textarea.gLFyf, input.gLFyf') as HTMLInputElement | HTMLTextAreaElement;
            }
            
            // Third try: any search input
            if (!targetEl) {
              targetEl = document.querySelector('input[type="search"], input[type="text"]') as HTMLInputElement;
            }
            
            if (!targetEl) {
              console.log('[HandOff Direct] No input element found');
              return { success: false, reason: 'No input element found' };
            }
            
            console.log('[HandOff Direct] Found element:', targetEl.tagName, targetEl.className);
            
            // Focus the element
            targetEl.focus();
            targetEl.click();
            
            // Clear existing content
            targetEl.value = '';
            
            // Use execCommand for better compatibility with React/modern frameworks
            // This simulates actual user typing
            document.execCommand('insertText', false, inputText);
            
            // If execCommand didn't work, fall back to direct value + InputEvent
            if (!targetEl.value || targetEl.value !== inputText) {
              console.log('[HandOff Direct] execCommand failed, using InputEvent');
              targetEl.value = inputText;
              
              // Dispatch InputEvent which React listens to
              const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: inputText,
              });
              targetEl.dispatchEvent(inputEvent);
            }
            
            console.log('[HandOff Direct] Final value:', targetEl.value);
            return { success: true, element: targetEl.tagName, value: targetEl.value };
          },
          args: [text],
        });
        
        console.log('[Tools] Direct type result:', result);
        return { success: true, data: { typed: text, method: 'direct', result: result?.[0]?.result } };
      } catch (error) {
        console.error('[Tools] Type error:', error);
        return { success: false, error: 'Type failed - ' + (error instanceof Error ? error.message : 'unknown error') };
      }
    },
  });

  // 📜 SCROLL
  registry.register({
    name: 'scroll',
    description: 'Scroll the page in a direction',
    execute: async (params) => {
      const { direction } = params as { direction: 'up' | 'down' | 'left' | 'right' };
      try {
        const scriptReady = await ensureContentScript(tabId);
        if (!scriptReady) {
          return { success: false, error: 'Scroll failed - could not load content script' };
        }
        await sendToContentScript(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { type: 'scroll', direction },
        });
        return { success: true, data: { scrolled: direction } };
      } catch (error) {
        return { success: false, error: 'Scroll failed' };
      }
    },
  });

  // ⌨️ PRESS KEY
  registry.register({
    name: 'press',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc)',
    execute: async (params) => {
      const { key } = params as { key: string };
      try {
        const scriptReady = await ensureContentScript(tabId);
        if (!scriptReady) {
          return { success: false, error: 'Press key failed - could not load content script' };
        }
        const response = await sendToContentScript(tabId, {
          type: 'EXECUTE_ACTION',
          payload: { type: 'press', key },
        }) as { success: boolean; error?: string };
        if (!response || !response.success) {
          return { success: false, error: response?.error || 'Press key failed' };
        }
        return { success: true, data: { pressed: key } };
      } catch (error) {
        return { success: false, error: 'Press key failed - content script not responding' };
      }
    },
  });

  // ⏳ WAIT
  registry.register({
    name: 'wait',
    description: 'Wait for page to update',
    execute: async (params) => {
      const { ms = 1000 } = params as { ms?: number };
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { success: true, data: { waited: ms } };
    },
  });

  // 📋 GET PAGE INFO
  registry.register({
    name: 'getPageInfo',
    description: 'Get current page URL, title, and viewport info',
    execute: async () => {
      try {
        const response = await sendToContentScript(tabId, {
          type: 'GET_PAGE_INFO',
        });
        return { success: true, data: response };
      } catch (error) {
        return { success: false, error: 'Failed to get page info' };
      }
    },
  });

  // 🌐 NAVIGATE - Go to a URL directly
  registry.register({
    name: 'navigate',
    description: 'Navigate to a URL',
    execute: async (params) => {
      const { url } = params as { url: string };
      try {
        await chrome.tabs.update(tabId, { url });
        // Wait for page to start loading
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: true, data: { navigated: url } };
      } catch (error) {
        return { success: false, error: 'Navigation failed' };
      }
    },
  });

  return registry;
}
