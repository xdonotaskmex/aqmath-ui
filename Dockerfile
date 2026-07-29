# aqmath-ui is a static site (primarily served by GitHub Pages at aqmath.xyz).
# This OPTIONAL Railway deploy serves the exact same static files via Caddy on
# Railway's $PORT — there is no functional change to the site itself, and these
# build files are ignored by GitHub Pages.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /srv
# The caddy base image's default command runs `caddy run` with the Caddyfile above.
