# Deployment

## Docker

The image is published to **GHCR** by GitHub Actions on every tag and on `main`:

```
ghcr.io/aetherionflux/scriptorium:<tag>   # e.g. :v0.1.0, :main, :latest
```

### Run

```bash
docker run -d --name scriptorium \
  -p 8787:8787 \
  -v scriptorium-data:/data \
  ghcr.io/aetherionflux/scriptorium:latest
```

- **One port (8787)** serves UI + API.
- **`/data`** holds the SQLite database, the session secret, and (later) uploads —
  back this volume up and you've backed up the whole wiki.
- First boot seeds a default space and a welcome page; the first registered account
  is admin.

### Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | listen port |
| `DATA_DIR` | `/data` | database + secrets location |
| `SESSION_SECRET` | auto-generated into `DATA_DIR` | cookie signing key; set explicitly to keep sessions across container rebuilds |
| `SESSION_MAX_AGE_DAYS` | `30` | cookie lifetime |
| `HOST` | `0.0.0.0` | bind address |

### Compose

```yaml
services:
  scriptorium:
    image: ghcr.io/aetherionflux/scriptorium:latest
    ports: ["8787:8787"]
    volumes: [scriptorium-data:/data]
    restart: unless-stopped
volumes:
  scriptorium-data:
```

## Kubernetes (Helm)

Chart lives in-repo at `charts/scriptorium/`.

```bash
helm install scriptorium ./charts/scriptorium \
  --set image.repository=ghcr.io/aetherionflux/scriptorium \
  --set image.tag=v0.1.0 \
  --set persistence.size=10Gi
```

### Values

| Key | Default | Notes |
|---|---|---|
| `image.repository` | `ghcr.io/aetherionflux/scriptorium` | image |
| `image.tag` | `main` | tag |
| `image.pullPolicy` | `IfNotPresent` | |
| `imagePullSecrets` | `[]` | set for private GHCR (`kubectl create secret docker-registry ...`) |
| `replicaCount` | `1` | keep at 1 (SQLite single writer) |
| `service.type` | `ClusterIP` | |
| `service.port` | `8787` | |
| `persistence.enabled` | `true` | |
| `persistence.size` | `1Gi` | |
| `persistence.storageClass` | `""` (default) | |
| `persistence.accessMode` | `ReadWriteOnce` | |
| `ingress.enabled` | `false` | |
| `ingress.host` | `wiki.example.com` | |
| `ingress.className` | `""` | |
| `ingress.tls` | `[]` | standard cert-manager style |
| `env.SESSION_SECRET` | `""` | **recommended**: set a stable secret so sessions survive pod restarts |
| `resources` | `requests 100m/128Mi` | |

### Notes for operators

- **Single replica.** SQLite is single-writer; run one pod with a `ReadWriteOnce`
  PVC. If you outgrow that, see the scaling story in [architecture.md](architecture.md).
- **Session secret.** Without a stable `SESSION_SECRET`, every pod restart logs
  everyone out (the auto-generated secret is stored in the PVC, so with the default
  PVC this already survives — explicit `SESSION_SECRET` is belt-and-suspenders).
- **Ingress**: set `ingress.enabled=true` + host; TLS via cert-manager annotations.
- **Backup**: `kubectl exec -it <pod> -- tar czf - -C /data . > backup.tar.gz`
  (or mount the PVC to a sidecar that dumps it).

## Bare metal

```bash
npm ci --omit=dev && npm run build
node server/index.js          # or: docker run ... (preferred)
```

## Upgrades

1. `docker pull` / `helm upgrade` to the new tag.
2. SQLite migrations run automatically at boot (versioned, additive-only in v1).
3. Data dir is untouched by the image.