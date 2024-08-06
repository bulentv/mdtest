import WebSocket from 'ws';

const args = process.argv.slice(2);

// defaults
let engineIP = 'localhost';
let enginePort = 30030;
let delay = 1000;

let arg;

while (arg = args.shift()) {
  switch (arg) {
    case '-h':
    case '--help': {
      console.log('Usage: node index.js --ip <engine-ip> --port <engine-port> --delay <ms>');
      process.exit(0);
    }

    case '--ip': {
      engineIP = args.shift();
      break;
    }

    case '--port': {
      enginePort = Number(args.shift());
      break;
    }

    case '--delay': {
      delay = Number(args.shift());
      break;
    }
  }
}
    
const senderId = 'E56E345DE28A44BFBFBE218AB6AEE3EF';
const requests = new Map();

let recipientId = null;
let requestId = 1;

console.info(`Connecting to ws://${engineIP}:${enginePort}...`);
const ws = new WebSocket(`ws://${engineIP}:${enginePort}`);

ws.onopen = async () => {
  try {
    
    // send ping message and wait (throw otherwise)
    await sendMessage('/Script/AvalancheMediaEditor.AvaRundownPing', { bAuto: false });

    const { Message: { text }} = await sendMessage('/Script/AvalancheMediaEditor.AvaRundownLoadRundown', { rundown: '/Game/test.test' });
    console.log(text);

    // get pages
    const { Message: { pages }} = await sendMessage('/Script/AvalancheMediaEditor.AvaRundownGetPages');
    const pageIds = pages.filter(({ isTemplate }) => !isTemplate).map(({ pageId }) => pageId);
    pageIds.sort((a, b) => a - b);

    console.info(`Sending Play commands to ${pageIds.length} pages with ${delay}ms delay...`);

    for (const pageId of pageIds) {
      const { Message: { text } } = await sendMessage('/Script/AvalancheMediaEditor.AvaRundownPageAction', { pageId, action: 'Play' });
      console.info(`pageId: ${pageId} - ${text}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

  } catch (ex) {
    console.trace(ex);
  }
}

ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);

  switch (message.MessageType) {
    case '/Script/AvalancheMedia.AvaRundownPong': {
      recipientId = message.Sender;
      const request = [...requests.values()].find(({ message }) => message.MessageType === '/Script/AvalancheMediaEditor.AvaRundownPing');
      
      if (request) {
        const { resolve } = request;
        requests.delete(request.message.Message.requestId);
        resolve(message);
        return;
      }
      
      break;
    }

    default: {
      const request = requests.get(message.Message.requestId);

      if (!request) {
        // console.warn(`Unhandled message type: ${message.MessageType}`);
        return;
      }

      requests.delete(message.Message.requestId);
      request.resolve(message);
    }
  }

  const now = Date.now();
  const nowInSeconds = Math.floor(now / 1000);

  for (const [requestId, { message, resolve, reject }] of requests) {
    if (message.Expiration <= nowInSeconds) {
      requests.delete(requestId);
      
      reject(`TIMEOUT: ${message.MessageType}`);
    }
  }
}

function sendMessage(messageType, payload) {
  const now = Date.now();
  const nowInSeconds = Math.floor(now / 1000);

  const message = {
    Sender: senderId,
    Recipients: recipientId ? [recipientId] : [],
    MessageType: messageType,
    Scope: 'Network',
    Expiration: nowInSeconds + 3,
    TimeSent: nowInSeconds,
    Message: {
      RequestId: requestId++,
      ...payload,
    },
  };
  
  // console.log(JSON.stringify(message, null, 2));
  ws.send(JSON.stringify(message, null, 2));

  return new Promise((resolve, reject) => {
    requests.set(message.Message.RequestId, { message, resolve, reject });
  });
}

ws.onclose = () => {
  console.info('WebSocket connection closed');
}

ws.onerror = (error) =>{
  console.error(error.message);
}
