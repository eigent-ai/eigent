#!/bin/bash

set -o errexit
set -o nounset

rm -f './celerybeat.pid'
celery -A app.core.celery beat -l info