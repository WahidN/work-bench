// Minimal stand-in for the engine, on port 4174 so it can never collide with the real
// one on 4173. Prints on start so the launchd log proves the job ran rather than just
// that launchd claims it is loaded.
import { createServer } from 'node:http'

const PORT = 4174

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ standin: true, pid: process.pid }))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`standin listening on 127.0.0.1:${PORT} pid=${process.pid}`)
})

// The real engine's pnpm wrapper traps SIGTERM and exits 0, which is the whole reason
// EngineAgent.plist uses a blanket KeepAlive rather than SuccessfulExit:false. Nothing
// is trapped here: pnpm is still the supervised process, so the behaviour under test is
// the same.
process.on('SIGTERM', () => {
  console.log('standin received SIGTERM')
  process.exit(0)
})
