# Your own search engine for Researcher: SearXNG (no Docker)

Agent Office searches the web in this order: **DuckDuckGo → your SearXNG → Tavily/Brave key** (Settings → Integrations → Web search).
- DuckDuckGo needs nothing, but it is unofficial: when it is used a lot it may ask for a CAPTCHA.
- SearXNG is the backup with **no limit and no key**. It is an open-source search engine you run yourself; it asks Google, Bing, DuckDuckGo and others for you and answers in JSON.

It runs on **Linux**. Use one of these:
- **MINTserver** (or any Linux machine on your network). Recommended: it is always on.
- **WSL** on this Windows PC: `wsl --install -d Ubuntu`, then follow the same steps inside Ubuntu. WSL is not Docker.

The steps follow the official guide (docs.searxng.org → Installation → Step by step), shortened for personal use.

## 1. Install
```sh
sudo -H apt-get install -y python3-dev python3-babel python3-venv python-is-python3 git build-essential libxslt-dev zlib1g-dev libffi-dev libssl-dev

sudo -H useradd --shell /bin/bash --system --home-dir /usr/local/searxng --comment 'SearXNG' searxng
sudo -H mkdir /usr/local/searxng && sudo -H chown -R searxng:searxng /usr/local/searxng

sudo -H -u searxng -i            # now you are the searxng user
git clone https://github.com/searxng/searxng /usr/local/searxng/searxng-src
python3 -m venv /usr/local/searxng/searx-pyenv
echo ". /usr/local/searxng/searx-pyenv/bin/activate" >> /usr/local/searxng/.profile
exit
sudo -H -u searxng -i            # log in again so the venv is active
pip install -U pip setuptools wheel pyyaml msgspec typing-extensions pybind11
cd /usr/local/searxng/searxng-src && pip install --use-pep517 --no-build-isolation -e .
exit
```

## 2. Settings
```sh
sudo -H mkdir -p /etc/searxng
sudo -H cp /usr/local/searxng/searxng-src/utils/templates/etc/searxng/settings.yml /etc/searxng/settings.yml
sudo -H sed -i -e "s/ultrasecretkey/$(openssl rand -hex 16)/g" /etc/searxng/settings.yml
sudo -H nano /etc/searxng/settings.yml
```

Make sure these values are set:
```yaml
server:
  bind_address: "0.0.0.0"   # so the hub PC can reach it on your network
  port: 8888
  limiter: false            # only you use it
search:
  formats:
    - html
    - json                  # REQUIRED: Agent Office asks for JSON
```

## 3. Run it now, and at every boot
Test it first:
```sh
sudo -H -u searxng -i
cd /usr/local/searxng/searxng-src
SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml python -m searx.webapp
# in another terminal:
curl "http://127.0.0.1:8888/search?q=sewa+kamera&format=json" | head -c 300
```

Then make it a service. Create `/etc/systemd/system/searxng.service`:
```ini
[Unit]
Description=SearXNG
After=network-online.target

[Service]
User=searxng
WorkingDirectory=/usr/local/searxng/searxng-src
Environment=SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml
ExecStart=/usr/local/searxng/searx-pyenv/bin/python -m searx.webapp
Restart=always

[Install]
WantedBy=multi-user.target
```
```sh
sudo systemctl daemon-reload && sudo systemctl enable --now searxng
```

## 4. Connect it to Agent Office
1. Open Settings → Integrations → **Web search** → **SearXNG address**: `http://<server IP>:8888`.
2. Keep "Try first" on **DuckDuckGo**, or pick **SearXNG** to use it first. Then **Save** and **Test search**.

The status line shows the order, e.g. `DuckDuckGo → SearXNG`.

## Notes
- The port is only for your home network: do not forward it on the router.
- If results stop coming, check `journalctl -u searxng -f`. The engines SearXNG asks can also rate-limit it, but it switches between many of them.
- Update later: `sudo -H -u searxng -i`, `cd searxng-src && git pull && pip install --use-pep517 --no-build-isolation -e .`, then `sudo systemctl restart searxng`.
