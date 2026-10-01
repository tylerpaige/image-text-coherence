# Deploying to a DigitalOcean droplet with Kamal

Why this over Fly.io: one small droplet runs both the web app and Postgres,
so there's no separate managed-Postgres bill (Fly's Managed Postgres alone
starts at $38/mo). A $6-12/mo droplet covers everything here.

[Kamal](https://kamal-deploy.org) builds the app's Docker image, pushes it
to a registry (we use GitHub Container Registry, `ghcr.io`, since it's free),
and deploys it to the droplet over SSH, alongside a Postgres+pgvector
"accessory" container on the same host. `kamal-proxy` (which Kamal installs
on the droplet) terminates HTTPS and does zero-downtime restarts.

This assumes the config already in the repo: `config/deploy.yml`,
`.kamal/secrets`, `.env.production.example`. You shouldn't need to edit
`config/deploy.yml` beyond the two placeholders called out below.

## 0. One-time local setup

Install Kamal (it's a Ruby gem):

```bash
gem install kamal
kamal version   # confirm it runs
```

## 1. Create the droplet

1. In the DigitalOcean dashboard, create a droplet:
   - **Image**: Ubuntu 24.04 LTS (plain image is fine -- `kamal setup` installs
     Docker itself. If you'd rather skip that step, pick the "Docker on
     Ubuntu" Marketplace image instead).
   - **Plan**: the cheapest "Basic" droplet with **2GB RAM** (1GB is too
     tight once Postgres and the Node process with the CLIP model are both
     running). Around $12/mo at the time of writing.
   - **Authentication**: SSH key (add your local public key).
   - **Region**: whichever is closest to your students.
2. Note the droplet's public IP address.
3. Confirm you can SSH in: `ssh root@<DROPLET_IP>`.

## 2. Point a domain at it

Kamal's automatic HTTPS (via Let's Encrypt) needs a real domain -- it won't
issue a certificate for a bare IP address.

1. In whatever DNS provider you use for a domain you own, add an **A
   record** for a subdomain (e.g. `laion.yourdomain.com`) pointing at the
   droplet's IP.
2. Wait for it to propagate (`dig laion.yourdomain.com` should show the
   droplet's IP -- usually a few minutes).

**No domain available?** You can skip HTTPS entirely: remove the `proxy.ssl`
and `proxy.host` lines from `config/deploy.yml` and access the app at
`http://<DROPLET_IP>`. Not recommended long-term (the shared password would
travel in plaintext) but fine to get things running while you sort out DNS.

## 3. Create a GitHub Container Registry token

Kamal needs to push the built image somewhere the droplet can pull it from.

1. GitHub → Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token.
2. Scopes: `write:packages` (this implies `read:packages`).
3. Copy the token -- you won't see it again.

## 4. Fill in secrets

```bash
cp .env.production.example .env.production
```

Edit `.env.production`:

| Variable                  | Value                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `KAMAL_REGISTRY_PASSWORD` | the GitHub token from step 3                                                             |
| `APP_PASSWORD`            | the shared class password                                                                |
| `SESSION_SECRET`          | `openssl rand -base64 32`                                                                |
| `POSTGRES_PASSWORD`       | `openssl rand -base64 24`                                                                |
| `DATABASE_URL`            | `postgresql://postgres:<the POSTGRES_PASSWORD above>@image-text-coherence-db:5432/laion` |

(`image-text-coherence-db` is not a typo for the droplet's IP -- it's the
accessory container's name on the private Docker network Kamal creates, and
how the app reaches Postgres. Don't use the droplet's public IP here.)

Load these into your shell before any `kamal` command:

```bash
set -a && source .env.production && set +a
```

(Re-run this in any new terminal tab before running `kamal` again.)

## 5. Edit `config/deploy.yml`

Replace the two placeholders:

- `<DROPLET_IP>` (appears twice: under `servers.web.hosts` and
  `accessories.db.host`) → your droplet's IP from step 1.
- `<YOUR_DOMAIN>` → the subdomain from step 2 (skip if you removed the
  `proxy` block per step 2's no-domain fallback).

## 6. First deploy

From the repo root, with the secrets loaded (step 4):

```bash
kamal setup
```

This installs Docker on the droplet if needed, boots `kamal-proxy`, boots
the Postgres accessory (auto-applying `db/schema.sql` on first boot, same
as `docker-compose.yml` does locally), builds and pushes the image, and
deploys the app. It'll request a Let's Encrypt certificate for your domain
automatically if `proxy.ssl` is set.

Visit your domain (or `http://<DROPLET_IP>`) -- you should hit the login
page.

## 7. Seed the remote database

The droplet's Postgres is bound to `127.0.0.1` only (not exposed publicly),
so reach it via an SSH tunnel:

```bash
ssh -N -L 5433:localhost:5432 root@<DROPLET_IP> &
```

Then, same as the existing local → remote push, but targeting the tunnel:

```bash
LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/laion \
REMOTE_DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5433/laion \
./db/push_to_remote.sh
```

Wait -- both point at `localhost:5433`? Yes: the tunnel makes the droplet's
Postgres appear as `localhost:5433` to your machine, so use your own local
seeded Postgres as `LOCAL_DATABASE_URL` (per the main README) and the
tunnel as `REMOTE_DATABASE_URL`. Kill the tunnel (`kill %1`, or `fg` then
Ctrl-C) when done.

## Ongoing deploys

After the first `kamal setup`, subsequent deploys (e.g. after pushing code
changes) are just:

```bash
set -a && source .env.production && set +a
kamal deploy
```

This rebuilds the image, pushes it, and does a zero-downtime restart on the
droplet. Useful commands:

```bash
kamal app logs -f          # tail the app's logs
kamal app exec --interactive "sh"   # shell into the running container
kamal accessory logs db    # tail Postgres's logs
kamal rollback             # roll back to the previous deployed version
```

## Known quirks

- `web/app/up/route.ts` exists specifically for Kamal: `kamal-proxy` polls
  `/up` during every deploy to know when the new container is healthy, and
  that route is deliberately excluded from the password gate in
  `web/proxy.ts`'s matcher. If you ever change the auth matcher, keep `up`
  excluded or deploys will hang waiting for a health check that never
  passes.
- The droplet needs at least 2GB RAM. With 1GB, Postgres and the Node
  process (which loads the CLIP ONNX model into memory per request) can
  both get OOM-killed under load.
- `kamal setup` only needs to run once. Running it again is safe but
  redundant -- use `kamal deploy` for everything after the first time.
