#!/bin/bash

set -e

node --test --test-reporter=./test/fixtures/raw-reporter.ts --test-timeout=500 test/fixtures/configurations/$1/*.test.js > test/fixtures/configurations/$1/raw.txt | true
node --test --test-reporter=./src/index.ts --test-timeout=500 test/fixtures/configurations/$1/*.test.js > test/fixtures/configurations/$1/expected.txt | true
sd "${PWD}" "/cleaner-spec-reporter" test/fixtures/configurations/$1/expected.txt