import { spawn } from 'child_process';
import os from 'os';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = os.tmpdir() + '/chrome-diag-' + Date.now();
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--user-data-dir=' + profileDir,
  '--disable-gpu',
  'http://localhost:3000'
]);

async function run() {
  await new Promise(r => setTimeout(r, 1500));
  try {
    const listRes = await fetch('http://127.0.0.1:9222/json');
    const tabs = await listRes.json();
    const page = tabs.find(t => t.url.includes('localhost:3000'));
    if (!page) {
      console.log('No page found for localhost:3000. Tabs:', tabs);
      chrome.kill();
      return;
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
      ws.send(JSON.stringify({ id: 20, method: 'Network.enable' }));
      ws.send(JSON.stringify({ id: 21, method: 'Page.enable' }));
      ws.send(JSON.stringify({ id: 22, method: 'Page.reload' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Network.loadingFailed') {
        console.error('[NETWORK FAILED]', data.params);
      } else if (data.method === 'Network.responseReceived') {
        console.log('[NETWORK RESPONSE]', data.params.response.url, data.params.response.status, data.params.response.mimeType);
      } else if (data.method === 'Runtime.consoleAPICalled') {
        console.log('[BROWSER CONSOLE]', data.params.type, data.params.args.map(a => a.value || a.description));
      } else if (data.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', JSON.stringify(data.params.exceptionDetails, null, 2));
      } else if (data.id >= 3) {
        console.log(`[EVAL id=${data.id}] Result:`, data.result?.result?.value);
      }
    };

    setTimeout(() => {
      console.log('--- Clicking startGameBtn ---');
      ws.send(JSON.stringify({
        id: 10,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const btn = document.getElementById("startGameBtn");
            if (!btn) return "btn not found";
            btn.click();
            return "clicked startGameBtn";
          })()`
        }
      }));

      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 11,
          method: 'Runtime.evaluate',
          params: { expression: 'document.getElementById("gameFocusOverlay")?.className' }
        }));

        setTimeout(() => {
          chrome.kill();
          process.exit(0);
        }, 800);
      }, 500);
    }, 2000);

  } catch (err) {
    console.error('Diagnostic error:', err);
    chrome.kill();
  }
}

run();
