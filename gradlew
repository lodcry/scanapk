#!/bin/sh
DIRNAME="$(dirname "$0")"
exec "$DIRNAME/gradle/wrapper/gradle-wrapper.jar" "$@"
