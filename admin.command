#!/bin/bash
# Double-click this file in Finder to launch the d612 admin.
# It will start a local server and open the admin UI in your browser.

cd "$(dirname "$0")"

# Free port if anything is already on 4322
lsof -ti:4322 | xargs kill -9 2>/dev/null

exec npm run admin
