import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const platform = process.platform === 'win32' ? 'windows' : 'unix'

const node = platform === 'windows' ? 'node' : process.argv[0]

const specs: Record<string, boolean> = {
  '1pass': false,
  'all-skipped': true,
  combined: false,
  'no-files': false
}

for (const spec of Object.keys(specs)) {
  let raw
  let expected

  const color = specs[spec]
  const env = color ? { FORCE_COLOR: 'true' } : { NO_COLOR: 'true' }

  try {
    raw = execSync(
      `${node} --test --test-reporter=./test/fixtures/raw-reporter.ts --test-timeout=500 test/fixtures/configurations/${spec}/*.test.js`,
      { env }
    ).toString()
  } catch (e: any) {
    raw = e.stdout.toString()
  }

  try {
    expected = execSync(
      `${node} --test --test-reporter=./src/index.ts --test-timeout=500 test/fixtures/configurations/${spec}/*.test.js`,
      { env }
    ).toString()
  } catch (e: any) {
    expected = e.stdout.toString()
  }

  raw = raw.replaceAll(process.cwd(), '/cleaner-spec-reporter')
  expected = expected.replaceAll(process.cwd(), '/cleaner-spec-reporter')

  writeFileSync(`test/fixtures/configurations/${spec}/raw-${platform}.txt`, raw)
  writeFileSync(`test/fixtures/configurations/${spec}/expected-${platform}.txt`, expected)
}
