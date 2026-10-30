#!/usr/bin/env bash
# Server neu starten
DIR="$(dirname "$0")"
"$DIR/stop.sh"
"$DIR/start.sh"
