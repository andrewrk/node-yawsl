var yawl = require('../');
var http = require('http');
var crypto = require('crypto');
var humanSize = require('human-size');

var ws;
try {
  ws = require('ws');
} catch (err) {}

var Faye;
try {
  Faye = require('faye-websocket');
} catch (err) {}

var deflate;
try {
  deflate = require('permessage-deflate');
} catch (err) {}

// generate a big file
var bigFileSize = 100 * 1024 * 1024;
var bigFileBuffer = crypto.pseudoRandomBytes(bigFileSize);

var smallBufCount = 10000 //100000;
var smallBufs = new Array(smallBufCount);
var totalSmallBufsSize = 0;
for (var i = 0; i < smallBufCount; i += 1) {
  var buf = crypto.pseudoRandomBytes(Math.floor(Math.random() * 1000 + 1));
  totalSmallBufsSize += buf.length;
  smallBufs[i] = buf;
}

var search = process.argv[2];

var tests = [
  {
    name: "big buffer echo (yawl)",
    fn: bigBufferYawl,
    req: noop,
    size: bigFileSize,
  },
  {
    name: "big buffer echo (ws)",
    fn: makeBigBufferWs(false),
    req: reqWs,
    size: bigFileSize,
  },
  {
    name: "big buffer echo (faye)",
    fn: makeBigBufferFaye(false),
    req: reqFaye,
    size: bigFileSize,
  },
  {
    name: "many small buffers (yawl)",
    fn: smallBufferYawl,
    req: noop,
    size: totalSmallBufsSize,
  },
  {
    name: "many small buffers (ws)",
    fn: makeSmallBufferWs(false),
    req: reqWs,
    size: totalSmallBufsSize,
  },
  {
    name: "many small buffers (faye)",
    fn: makeSmallBufferFaye(false),
    req: reqFaye,
    size: totalSmallBufsSize,
  },
  {
    name: "permessage-deflate big buffer echo (ws)",
    fn: makeBigBufferWs(true),
    req: reqWs,
    size: bigFileSize,
  },
  {
    name: "permessage-deflate many small buffers (ws)",
    fn: makeSmallBufferWs(true),
    req: reqWs,
    size: totalSmallBufsSize,
  },
  {
    name: "permessage-deflate big buffer echo (faye)",
    fn: makeBigBufferFaye(true),
    req: reqFayeAndDeflate,
    size: bigFileSize,
  },
  {
    name: "permessage-deflate many small buffers (faye)",
    fn: makeSmallBufferFaye(true),
    req: reqFayeAndDeflate,
    size: totalSmallBufsSize,
  },
];

var testIndex = 0;
doOneTest();

function doOneTest() {
  var test = tests[testIndex++];
  if (!test) {
    console.error("done");
    return;
  }
  if (search && test.name.indexOf(search) === -1) {
    doOneTest();
    return;
  }
  process.stderr.write(test.name + ": ");
  var r = test.req();
  if (r) {
    process.stderr.write(r + "\n");
    doOneTest();
    return;
  }
  var start = new Date();
  test.fn(function() {
    var end = new Date();
    var elapsed = (end - start) / 1000;
    var rate = test.size / elapsed;
    process.stderr.write(elapsed.toFixed(2) + "s  " + humanSize(rate) + "/s\n");
    doOneTest();
  });
}

function bigBufferYawl(cb) {
  var httpServer = http.createServer();
  var wss = yawl.createServer({
    server: httpServer,
    allowBinaryMessages: true,
    maxFrameSize: bigFileSize,
    origin: null,
  });
  wss.on('connection', function(ws) {
    ws.on('binaryMessage', function(buffer) {
      ws.sendBinary(buffer);
    });
  });
  httpServer.listen(function() {
    var options = {
      host: 'localhost',
      protocol: 'ws',
      port: httpServer.address().port,
      path: '/',
      allowBinaryMessages: true,
      maxFrameSize: bigFileSize,
    };
    var client = yawl.createClient(options);
    client.on('open', function() {
      client.sendBinary(bigFileBuffer);
    });
    client.on('binaryMessage', function(buffer) {
      client.close();
      httpServer.close(cb);
    });
  });
}

function makeBigBufferWs(perMessageDeflate) {
  return function (cb) {
    var httpServer = http.createServer();
    var wss = new ws.Server({
      server: httpServer,
      perMessageDeflate: perMessageDeflate,
    });
    wss.on('connection', function(ws) {
      ws.on('message', function(buffer) {
        ws.send(buffer);
      });
    });
    httpServer.listen(function() {
      var client = new ws('ws://localhost:' + httpServer.address().port + '/');
      client.on('open', function() {
        client.send(bigFileBuffer);
      });
      client.on('message', function(buffer) {
        client.close();
        httpServer.close(cb);
      });
    });
  };
}

function makeBigBufferFaye(perMessageDeflate) {
  return function (cb) {
    var httpServer = http.createServer();
    var extensions = [];
    if (perMessageDeflate) extensions.push(deflate);
    httpServer.on('upgrade', function(req, socket, head) {
      var ws = new Faye(req, socket, head, null, {
        extensions: extensions,
        maxLength: Infinity
      });
      ws.on('open', function() {
        ws.on('message', function(buffer) {
          ws.send(buffer);
        });
      });
    });
    httpServer.listen(function() {
      var client = new Faye.Client(
        'ws://localhost:' + httpServer.address().port + '/',
        null,
        { extensions: extensions, maxLength: Infinity }
      );
      client.on('open', function() {
        client.send(bigFileBuffer);
      });
      client.on('message', function(buffer) {
        client.close();
        httpServer.close(cb);
      });
    });
  };
}

function smallBufferYawl(cb) {
  var httpServer = http.createServer();
  var wss = yawl.createServer({
    server: httpServer,
    allowBinaryMessages: true,
    origin: null,
  });
  wss.on('connection', function(ws) {
    ws.on('binaryMessage', function(buffer) {
      ws.sendBinary(buffer);
    });
  });
  httpServer.listen(function() {
    var options = {
      host: 'localhost',
      protocol: 'ws',
      port: httpServer.address().port,
      path: '/',
      allowBinaryMessages: true,
      maxFrameSize: bigFileSize,
    };
    var client = yawl.createClient(options);
    client.on('open', function() {
      smallBufs.forEach(function(buf) {
        client.sendBinary(buf);
      });
    });
    var count = 0;
    client.on('binaryMessage', function(buffer) {
      count += 1;
      if (count === smallBufCount) {
        client.close();
        httpServer.close(cb);
      }
    });
  });
}

function makeSmallBufferWs(perMessageDeflate) {
  return function (cb) {
    var httpServer = http.createServer();
    var wss = new ws.Server({
      server: httpServer,
      perMessageDeflate: perMessageDeflate,
    });
    wss.on('connection', function(ws) {
      ws.on('message', function(buffer) {
        ws.send(buffer);
      });
    });
    httpServer.listen(function() {
      var client = new ws('ws://localhost:' + httpServer.address().port + '/');
      client.on('open', function() {
        smallBufs.forEach(function(buf) {
          client.send(buf);
        });
      });
      var count = 0;
      client.on('message', function(buffer) {
        count += 1;
        if (count === smallBufCount) {
          client.close();
          httpServer.close(cb);
        }
      });
    });
  };
}

function makeSmallBufferFaye(perMessageDeflate) {
  return function (cb) {
    var httpServer = http.createServer();
    var extensions = [];
    if (perMessageDeflate) extensions.push(deflate);
    httpServer.on('upgrade', function(req, socket, head) {
      var ws = new Faye(req, socket, head, null, { extensions: extensions });
      ws.on('open', function() {
        ws.on('message', function(buffer) {
          ws.send(buffer);
        });
      });
    });
    httpServer.listen(function() {
      var client = new Faye.Client(
        'ws://localhost:' + httpServer.address().port + '/',
        null,
        { extensions: extensions }
      );
      client.on('open', function() {
        smallBufs.forEach(function(buf) {
          client.send(buf);
        });
      });
      var count = 0;
      client.on('message', function(buffer) {
        count += 1;
        if (count === smallBufCount) {
          client.close();
          httpServer.close(cb);
        }
      });
    });
  };
}

function noop() { }

function reqWs() {
  return ws ? null : 'npm install ws';
}

function reqFaye() {
  return Faye ? null : 'npm install faye-websocket';
}

function reqFayeAndDeflate() {
  return Faye && deflate ? null : 'npm install faye-websocket permessage-deflate';
}
