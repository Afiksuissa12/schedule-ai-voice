# Schedule AI Voice - hosted web demo

A minimal browser front end (`src/web/`) over the **real** runtime: the same composition root as
`npm run demo:local`, the real local model (`qwen2.5:7b-instruct` via Ollama, `num_ctx` 16384), the
real `ToolDispatcher` validation, the real claim gate (both layers), real SQLite persistence and the
real follow-up engine. The page shows what the application **persisted**, read back from the
database, and the audit trail of each turn.

## Architecture

```
Visitor's browser
   | HTTPS
   v
Cloudflare Quick Tunnel (trycloudflare.com)      <- public URL, no account, no open inbound port
   | outbound-only connection from the tunnel container
   v
container sav-tunnel (cloudflare/cloudflared)    --\
                                                     }  private Docker network "sav-demo-net"
container sav-web-demo (this image), port 8080   --/   (no host ports published)
   | http://host.docker.internal:11434
   v
Ollama on the host (bound to 127.0.0.1 only)     <- never exposed to the internet
```

Each browser session gets its own throwaway SQLite file seeded with one demo world (the visitor
plays the demo contact). Telephony, calendar and availability are the deterministic in-process
providers: nothing can dial a phone, send a message, or touch a real calendar.

## Run it

```bash
docker build -f deploy/web-demo/Dockerfile -t schedule-ai-voice-web-demo:local .
docker network create sav-demo-net
docker run -d --name sav-web-demo --network sav-demo-net --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,size=256m --cap-drop ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 256 schedule-ai-voice-web-demo:local
docker run -d --name sav-tunnel --network sav-demo-net --restart unless-stopped \
  --cap-drop ALL --security-opt no-new-privileges --memory 256m \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://sav-web-demo:8080
docker logs sav-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

Requirements on the host: Docker Desktop, and Ollama running with `qwen2.5:7b-instruct` pulled.

## Public surface

| Route | Purpose |
|---|---|
| `GET /`, `/app.js`, `/style.css` | the page |
| `GET /healthz` | liveness |
| `POST /api/session` | start a demo conversation (new throwaway database) |
| `GET /api/session?id=` | restore a conversation after a refresh |
| `POST /api/message` | one contact message -> one real agent turn |
| `POST /api/followup` | move the demo clock to the promised time and run the follow-up engine |

Everything else is 404. Limits: 4 KB bodies, 500-character messages, 20 turns per conversation,
25 live conversations, 45-minute idle expiry, 8 new conversations and 40 messages per visitor per
10 minutes, one model call at a time with a queue of 6. Security headers include a strict
Content-Security-Policy. No credentials exist in this deployment.

## Limits of this hosting

- The URL works only while this computer, Docker, Ollama and the tunnel are running.
- A Quick Tunnel URL is random and changes if the tunnel container restarts.
- The semantic claim verifier sometimes cannot read a true confirmation's time wording and then
  withholds the reply (fail-safe); the page says so explicitly. See `docs/KNOWN_LIMITATIONS.md`.
