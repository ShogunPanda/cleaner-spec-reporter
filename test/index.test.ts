import { deepEqual, deepStrictEqual, match } from 'node:assert'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import split2 from 'split2'
import { TestReporter, formatDuration, niceJoin } from '../src/index.ts'

const platform = process.platform === 'win32' ? 'windows' : 'unix'

function parseError(raw: any): Error {
  const { message, cause, stack, ...rest } = raw

  const error = new Error(message)
  Object.assign(error, rest)
  error.stack = stack

  if (cause) {
    error.cause = typeof cause === 'string' ? cause : parseError(cause)
  }

  return error
}

async function loadExpectedOutput(name: string): Promise<string> {
  const expected = await readFile(
    resolve(import.meta.dirname, `./fixtures/configurations/${name}/expected-${platform}.txt`),
    'utf-8'
  )

  return expected
    .replaceAll(/:\d+:\d+\)/g, ':0:0)')
    .replaceAll(/:\d+\)/g, ':0)')
    .replaceAll(/\(\d+\.\d+ms\)/g, '(1ms)')
    .replaceAll(/\d+\.\d+ seconds/g, '1 second')
}

async function run(name: string, color: boolean = false): Promise<string> {
  const originalNoColor = process.env.NO_COLOR
  const originalForceColor = process.env.FORCE_COLOR

  process.env.NO_COLOR = !color ? 'true' : 'false'
  process.env.FORCE_COLOR = color ? 'true' : 'false'

  const reporter = new TestReporter()

  process.env.NO_COLOR = originalNoColor
  process.env.FORCE_COLOR = originalForceColor

  const stream = createReadStream(resolve(import.meta.dirname, `./fixtures/configurations/${name}/raw-${platform}.txt`))
    .pipe(
      split2(function (raw: string) {
        const parsed = JSON.parse(raw)

        if (parsed.data?.details?.error) {
          parsed.data.details.error = parseError(parsed.data.details.error)
        }

        return parsed
      })
    )
    .pipe(reporter)

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString()
}

process.env.TEST_ROOT = '/cleaner-spec-reporter'

test('formatDuration function should handle different time units correctly', () => {
  deepStrictEqual(formatDuration(2 * 3600 * 1000 + 30 * 60 * 1000 + 15 * 1000), '2 hours, 30 minutes and 15 seconds')
  deepStrictEqual(formatDuration(3 * 60 * 1000 + 15 * 1000), '3 minutes and 15 seconds')
  deepStrictEqual(formatDuration(5 * 1000), '5 seconds')
  deepStrictEqual(formatDuration(3661 * 1000), '1 hour, 1 minute and 1 second')
  deepStrictEqual(formatDuration(61 * 1000), '1 minute and 1 second')
  match(formatDuration(1.2345678 * 1000), /^1\.23\d seconds$/)
})

test('niceJoin function should join arrays correctly', () => {
  // Test empty array
  deepStrictEqual(niceJoin([]), '')

  // Test single item
  deepStrictEqual(niceJoin(['one']), 'one')

  // Test two items
  deepStrictEqual(niceJoin(['one', 'two']), 'one and two')

  // Test three or more items
  deepStrictEqual(niceJoin(['one', 'two', 'three']), 'one, two and three')
  deepStrictEqual(niceJoin(['one', 'two', 'three', 'four']), 'one, two, three and four')

  // Test with custom separators
  deepStrictEqual(niceJoin(['one', 'two', 'three'], ' or '), 'one, two or three')
  deepStrictEqual(niceJoin(['one', 'two', 'three'], ' or ', '; '), 'one; two or three')
})

test('should show correct output - combined', async () => {
  const actual = await run('combined')
  const expected = await loadExpectedOutput('combined')

  deepEqual(actual, expected)
})

test('should show correct output - all-skipped', async () => {
  const actual = await run('all-skipped', true)

  const expected = await loadExpectedOutput('all-skipped')

  deepEqual(actual, expected)
})

test('should show correct output - no-files', async () => {
  const actual = await run('no-files')
  const expected = await loadExpectedOutput('no-files')

  deepEqual(actual, expected)
})

test('should show correct output - 1pass', async () => {
  const actual = await run('1pass')
  const expected = await loadExpectedOutput('1pass')

  deepEqual(actual, expected)
})
