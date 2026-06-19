#!/bin/bash
# Double-click this file in Finder to start the dev server
# and open the site in your default browser.

cd "$(dirname "$0")"

# If port 4321 is already in use, free it
lsof -ti:4321 | xargs kill -9 2>/dev/null

# Open browser after server has had a moment to boot
(sleep 3 && open "http://localhost:4321") &

# Run dev server in this terminal — close window to stop
exec npm run dev
